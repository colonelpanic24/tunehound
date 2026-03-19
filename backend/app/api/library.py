import asyncio
import json
import os

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import Artist, DownloadSettings, ReleaseGroup, Track
from app.schemas import ArtistOut, ImportRequest
from app.services import artwork as artwork_svc
from app.services import musicbrainz as mb
from app.services import scanner
from app.services.coverart import get_cover_art_url
from app.services.image_cache import cache_image
from app.services.scan_job import scan_job_manager
from app.services.tag_reader import read_tags
from app.services.tagger import compute_art_hash_from_cover_file

router = APIRouter(prefix="/library", tags=["library"])

_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


# ── Backend-driven scan job endpoints ──────────────────────────────────────────


@router.post("/scan-job", status_code=202)
async def start_scan_job():
    """Start a background scan+import job.  Idempotent if already running."""
    await scan_job_manager.start()
    return {"started": True}


@router.get("/scan-job")
async def get_scan_job():
    """Return the current scan job state (for page-load hydration)."""
    return scan_job_manager.get_state()


@router.delete("/scan-job", status_code=204)
async def cancel_scan_job():
    """Cancel a running scan job."""
    await scan_job_manager.cancel()


@router.delete("/scan-job/review-item", status_code=204)
async def remove_review_item(folder: str):
    """Remove a needs-review item from the scan job state (after import or skip)."""
    scan_job_manager.remove_review_item(folder)


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


@router.get("/scan")
async def scan_library(db: AsyncSession = Depends(get_db)):
    """Stream SSE progress events as we scan folders and search MusicBrainz."""
    result = await db.execute(select(Artist.name))
    known_names = {row[0] for row in result.all()}

    async def event_stream():
        async for event in scanner.scan_music_directory_stream(
            settings.music_library_path, known_names
        ):
            yield _sse(event)

    return StreamingResponse(
        event_stream(), media_type="text/event-stream", headers=_SSE_HEADERS
    )


@router.post("/import")
async def import_library(body: ImportRequest):
    """Stream SSE progress events as we import artists and link existing files."""

    async def event_stream():
        from app.database import AsyncSessionLocal

        imported: list[ArtistOut] = []
        skipped: list[str] = []
        errors: list[dict] = []
        files_linked = 0
        total = len(body.artists)

        yield _sse({"type": "start", "total": total})

        async with AsyncSessionLocal() as db:
            # Resolve language filter once for the whole import batch
            lang_result = await db.execute(select(DownloadSettings).where(DownloadSettings.id == 1))
            dl_settings = lang_result.scalar_one_or_none()
            _lang_codes = [c.strip() for c in (dl_settings.album_languages if dl_settings else "eng").split(",") if c.strip()]
            _lang_filter = _lang_codes or None

            for i, item in enumerate(body.artists):
                mbid = item.mbid
                folder_name = item.folder
                done = i + 1
                remaining = total - done
                eta = round(remaining * 1.1, 1)

                existing = await db.execute(select(Artist).where(Artist.mbid == mbid))
                existing_artist = existing.scalar_one_or_none()
                if existing_artist:
                    if not existing_artist.folder_name and folder_name:
                        existing_artist.folder_name = folder_name
                        await db.commit()
                    skipped.append(mbid)
                    yield _sse(
                        {"type": "skipped", "mbid": mbid, "done": done, "total": total, "eta_seconds": eta}
                    )
                    continue

                try:
                    # 1a. Fetch artist info + image from MusicBrainz / TheAudioDB
                    yield _sse({"type": "step", "step": "artist_info", "name": folder_name or mbid, "done": done, "total": total})

                    mb_artist = await mb.get_artist(mbid)
                    artist_name = mb_artist.get("name", folder_name or mbid)

                    image_url = None
                    # Prefer local folder image over network fetch
                    if folder_name:
                        artist_path_check = os.path.join(settings.music_library_path, folder_name)
                        local_img = artwork_svc.find_local_artist_image(artist_path_check)
                        if local_img:
                            import shutil as _shutil
                            ext = os.path.splitext(local_img)[1].lstrip(".") or "jpg"
                            dest_dir = os.path.join(settings.data_dir, "images", "artists")
                            os.makedirs(dest_dir, exist_ok=True)
                            dest = os.path.join(dest_dir, f"{mbid}.{ext}")
                            try:
                                _shutil.copy2(local_img, dest)
                                image_url = f"/images/artists/{mbid}.{ext}"
                            except Exception:
                                pass
                    if image_url is None:
                        remote_image_url = await mb.get_artist_image_url(mb_artist)
                        if remote_image_url:
                            image_url = await cache_image("artists", mbid, remote_image_url)

                    wikidata_id = None
                    for rel in mb_artist.get("url-relation-list", []):
                        if "wikidata.org/wiki/Q" in rel.get("target", ""):
                            wikidata_id = rel["target"].split("/")[-1]
                            break

                    artist = Artist(
                        mbid=mbid,
                        name=artist_name,
                        sort_name=mb_artist.get("sort-name"),
                        disambiguation=mb_artist.get("disambiguation"),
                        image_url=image_url,
                        wikidata_id=wikidata_id,
                        folder_name=folder_name,
                    )
                    db.add(artist)
                    await db.flush()

                    # 1b. Fetch release groups from MusicBrainz
                    yield _sse({"type": "step", "step": "albums", "name": artist_name, "done": done, "total": total})

                    _EXCLUDED_SECONDARY = {"Live", "Compilation", "Remix", "DJ-mix", "Mixtape/Street", "Demo", "Interview", "Spokenword", "Audiobook", "Audio drama"}
                    mb_groups = await mb.get_release_groups(mbid, languages=_lang_filter)
                    mb_groups = [
                        g for g in mb_groups
                        if not any(t in _EXCLUDED_SECONDARY for t in g.get("secondary-type-list", []))
                    ]
                    release_groups = []
                    for mg in mb_groups:
                        secondary = mg.get("secondary-type-list", [])
                        rg = ReleaseGroup(
                            mbid=mg["id"],
                            artist_id=artist.id,
                            title=mg["title"],
                            primary_type=mg.get("primary-type"),
                            secondary_types=",".join(secondary) if secondary else None,
                            first_release_date=mg.get("first-release-date"),
                        )
                        db.add(rg)
                        release_groups.append(rg)

                    await db.commit()

                    # 2. Fetch + cache cover art for all albums in parallel.
                    #    Cover Art Archive is a separate service from MusicBrainz and
                    #    handles concurrent requests fine.
                    album_count = len(release_groups)
                    yield _sse({"type": "step", "step": "cover_art", "name": artist.name, "album_count": album_count, "done": done, "total": total})

                    async def _fetch_cover(rg: ReleaseGroup) -> None:
                        try:
                            # Check for local folder image first
                            if folder_name:
                                _artist_path = os.path.join(settings.music_library_path, folder_name)
                                # Try to find a subfolder matching the album title
                                if os.path.isdir(_artist_path):
                                    for entry in os.scandir(_artist_path):
                                        if entry.is_dir():
                                            local_cover = artwork_svc.find_local_folder_image(entry.path)
                                            if local_cover:
                                                from difflib import SequenceMatcher
                                                score = SequenceMatcher(None, entry.name.lower(), rg.title.lower()).ratio()
                                                if score >= 0.6:
                                                    import shutil as _shutil
                                                    ext = os.path.splitext(local_cover)[1].lstrip(".") or "jpg"
                                                    dest_dir = os.path.join(settings.data_dir, "images", "covers")
                                                    os.makedirs(dest_dir, exist_ok=True)
                                                    dest = os.path.join(dest_dir, f"{rg.mbid}.{ext}")
                                                    try:
                                                        _shutil.copy2(local_cover, dest)
                                                        rg.cover_art_url = f"/images/covers/{rg.mbid}.{ext}"
                                                        rg.cover_art_hash = compute_art_hash_from_cover_file(rg.cover_art_url)
                                                    except Exception:
                                                        pass
                                                    return
                            remote_url = await get_cover_art_url(rg.mbid)
                            if remote_url:
                                rg.cover_art_url = await cache_image("covers", rg.mbid, remote_url)
                                if rg.cover_art_url:
                                    rg.cover_art_hash = compute_art_hash_from_cover_file(rg.cover_art_url)
                        except Exception:
                            pass

                    await asyncio.gather(*[_fetch_cover(rg) for rg in release_groups])
                    await db.commit()

                    # 3. Fetch tracks from MusicBrainz so that file linking can match them.
                    #    musicbrainzngs enforces its own 1 req/s rate limit internally.
                    yield _sse({"type": "step", "step": "tracks", "name": artist.name, "done": done, "total": total})
                    for rg in release_groups:
                        if rg.tracks_fetched:
                            continue
                        try:
                            mb_tracks = await mb.get_tracks_for_release_group(rg.mbid)
                            for t in mb_tracks:
                                db.add(Track(
                                    mbid=t["mbid"],
                                    release_group_id=rg.id,
                                    title=t["title"],
                                    track_number=t["track_number"],
                                    disc_number=t["disc_number"],
                                    duration_ms=t.get("duration_ms"),
                                ))
                            rg.tracks_fetched = True
                        except Exception:
                            pass
                    await db.commit()

                    # 4. Link files on disk that belong to this artist; then scan tags
                    if folder_name:
                        artist_path = os.path.join(settings.music_library_path, folder_name)
                        files_linked += await scanner.link_existing_files(artist_path, db)
                        # Scan tags for newly linked tracks
                        await _scan_tags_for_artist(artist_path, db)

                    await db.refresh(artist)
                    artist_out = ArtistOut.model_validate(artist)
                    imported.append(artist_out)
                    yield _sse(
                        {"type": "imported", "name": artist.name, "album_count": album_count, "done": done, "total": total, "eta_seconds": eta}
                    )

                except Exception as e:
                    await db.rollback()
                    errors.append({"mbid": mbid, "error": str(e)})
                    yield _sse(
                        {"type": "error", "mbid": mbid, "error": str(e), "done": done, "total": total, "eta_seconds": eta}
                    )

                if i < total - 1:
                    await asyncio.sleep(1.1)

        yield _sse(
            {
                "type": "done",
                "result": {
                    "imported": [a.model_dump(mode="json") for a in imported],
                    "skipped": skipped,
                    "errors": errors,
                    "files_linked": files_linked,
                },
            }
        )

    return StreamingResponse(
        event_stream(), media_type="text/event-stream", headers=_SSE_HEADERS
    )



@router.get("/stats")
async def get_library_stats():
    """Walk the music directory and return stats for all audio files on disk."""
    from app.services.library_watcher import AUDIO_EXTS

    total_tracks = 0
    total_size = 0
    by_format: dict[str, int] = {}

    if os.path.isdir(settings.music_library_path):
        for root, _, files in os.walk(settings.music_library_path):
            for filename in files:
                ext = os.path.splitext(filename)[1].lower()
                if ext not in AUDIO_EXTS:
                    continue
                total_tracks += 1
                fmt = ext.lstrip(".")
                by_format[fmt] = by_format.get(fmt, 0) + 1
                try:
                    total_size += os.path.getsize(os.path.join(root, filename))
                except OSError:
                    pass

    return {
        "total_tracks": total_tracks,
        "total_size_bytes": total_size,
        "by_format": by_format,
    }


@router.get("/missing/count")
async def get_missing_album_count(db: AsyncSession = Depends(get_db)):
    """Fast count of release groups with no linked files on disk."""
    from app.models import Track
    # Subquery: release group IDs that have at least one file_path set
    has_file_sq = (
        select(Track.release_group_id)
        .where(Track.file_path.isnot(None))
        .distinct()
        .scalar_subquery()
    )
    result = await db.execute(
        select(func.count(ReleaseGroup.id)).where(ReleaseGroup.id.not_in(has_file_sq))
    )
    return {"count": result.scalar_one()}


@router.get("/missing")
async def get_missing_albums(db: AsyncSession = Depends(get_db)):
    from sqlalchemy.orm import selectinload

    from app.schemas import ReleaseGroupOut

    result = await db.execute(
        select(ReleaseGroup)
        .options(
            selectinload(ReleaseGroup.artist),
            selectinload(ReleaseGroup.tracks),
        )
        .order_by(ReleaseGroup.artist_id, ReleaseGroup.first_release_date)
    )
    rgs = result.scalars().all()

    missing = []
    for rg in rgs:
        if rg.tracks_fetched and any(t.file_path for t in rg.tracks):
            continue
        rg_out = ReleaseGroupOut.model_validate(rg)
        rg_out.track_count = len(rg.tracks) if rg.tracks_fetched else 0
        missing.append({
            "release_group": rg_out.model_dump(mode="json"),
            "artist_name": rg.artist.name,
            "artist_id": rg.artist_id,
            "tracks_fetched": rg.tracks_fetched,
        })

    return missing


@router.get("/orphaned")
async def get_orphaned_files(
    db: AsyncSession = Depends(get_db),
    offset: int = 0,
    limit: int = 250,
):
    from app.models import Track
    from app.services.library_watcher import AUDIO_EXTS

    result = await db.execute(select(Track.file_path).where(Track.file_path.is_not(None)))
    known_paths = {row[0] for row in result.all()}

    # Collect all orphaned paths first (no stat calls yet — just metadata)
    all_orphaned: list[str] = []
    if os.path.isdir(settings.music_library_path):
        for root, _, files in os.walk(settings.music_library_path):
            for filename in files:
                ext = os.path.splitext(filename)[1].lower()
                if ext not in AUDIO_EXTS:
                    continue
                path = os.path.join(root, filename)
                if path not in known_paths:
                    all_orphaned.append(path)

    total = len(all_orphaned)
    page_paths = all_orphaned[offset : offset + limit]

    items = []
    for path in page_paths:
        try:
            size = os.path.getsize(path)
        except OSError:
            size = 0
        items.append({
            "path": path,
            "filename": os.path.basename(path),
            "relative_path": os.path.relpath(path, settings.music_library_path),
            "size_bytes": size,
        })

    return {"items": items, "total": total, "offset": offset, "has_more": offset + limit < total}


@router.delete("/artists", status_code=204)
async def clear_all_artists(db: AsyncSession = Depends(get_db)):
    """Delete everything library-related: artists, albums, tracks, download jobs, retag jobs."""
    from app.models import DownloadJob, DownloadTrackJob, RetagJob, RetagTrackJob

    # Delete leaf rows first to avoid FK constraint issues, then parents
    await db.execute(delete(RetagTrackJob))
    await db.execute(delete(RetagJob))
    await db.execute(delete(DownloadTrackJob))
    await db.execute(delete(DownloadJob))
    await db.execute(delete(Track))
    await db.execute(delete(ReleaseGroup))
    await db.execute(delete(Artist))
    await db.commit()


async def _scan_tags_for_artist(artist_path: str, db) -> None:
    """After linking, scan tags for all tracks under artist_path that have file_path set."""
    try:
        result = await db.execute(
            select(Track).where(Track.file_path.isnot(None))
        )
        tracks = result.scalars().all()
        updated = 0
        for track in tracks:
            if not track.file_path or not track.file_path.startswith(artist_path):
                continue
            if not os.path.isfile(track.file_path):
                continue
            snap = read_tags(track.file_path)
            if snap:
                track.tag_title = snap.title
                track.tag_artist = snap.artist
                track.tag_album = snap.album
                track.tag_track_number = snap.track_number
                track.tag_art_hash = snap.art_hash
                track.tags_scanned_at = snap.scanned_at
                updated += 1
        if updated:
            await db.commit()
    except Exception:
        pass
