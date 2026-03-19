import asyncio
import os
import re
from difflib import SequenceMatcher

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.ws import manager as ws_manager
from app.config import settings
from app.database import get_db
from app.models import Artist, DownloadSettings, ReleaseGroup, Track
from app.schemas import (
    ArtistCreate,
    ArtistDiskStatus,
    ArtistOut,
    ArtistRematch,
    ArtworkOption,
    DiskFolder,
    MatchedAlbum,
    MBArtistCandidate,
    ReleaseGroupOut,
)
from app.services import artwork as artwork_svc
from app.services import musicbrainz as mb
from app.services import scanner
from app.services.coverart import get_cover_art_url
from app.services.image_cache import cache_image, get_cached_url

router = APIRouter(prefix="/artists", tags=["artists"])


def _normalize_folder(s: str) -> str:
    s = s.lower()
    s = re.sub(r'\s*[\(\[]\d{4}[\)\]]\s*', ' ', s)  # strip year like (2020)
    s = re.sub(r'\b(disc|disk|vol|volume)\s*\d*\b', '', s, flags=re.IGNORECASE)
    s = re.sub(r"[^\w\s]", ' ', s)
    s = re.sub(r'\bthe\b', '', s)
    return ' '.join(s.split())


def _match_score(folder_name: str, rg_title: str) -> float:
    a, b = _normalize_folder(folder_name), _normalize_folder(rg_title)
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def _find_artist_folder(artist_name: str) -> str | None:
    """Return the name of an existing library subdirectory that matches the artist, or None."""
    lib_path = settings.music_library_path
    if not lib_path or not os.path.isdir(lib_path):
        return None

    def _norm(s: str) -> str:
        s = s.lower()
        s = re.sub(r"[^\w\s]", " ", s)
        s = re.sub(r"\bthe\b", "", s)
        return " ".join(s.split())

    norm_name = _norm(artist_name)
    best_folder, best_score = None, 0.0
    try:
        for entry in os.scandir(lib_path):
            if not entry.is_dir():
                continue
            score = SequenceMatcher(None, _norm(entry.name), norm_name).ratio()
            if score > best_score:
                best_score = score
                best_folder = entry.name
    except OSError:
        return None

    return best_folder if best_score >= 0.85 else None


@router.get("/search", response_model=list[MBArtistCandidate])
async def search_artists(q: str):
    """Search MusicBrainz for artists matching the query string."""
    if not q or len(q) < 2:
        return []
    return await mb.search_artists(q)


@router.get("/thumb/{mbid}")
async def get_artist_thumb(mbid: str):
    """Return a cached thumbnail URL for an artist MBID (used in search previews)."""
    import httpx

    # Return immediately if already cached locally
    cached = get_cached_url("artists", mbid)
    if cached:
        return {"image_url": cached}

    headers = {
        "User-Agent": (
            f"{settings.musicbrainz_app_name}/{settings.musicbrainz_app_version}"
            f" ({settings.musicbrainz_contact})"
        )
    }
    try:
        async with httpx.AsyncClient(timeout=5, headers=headers) as client:
            resp = await client.get(
                "https://www.theaudiodb.com/api/v1/json/2/artist-mb.php",
                params={"i": mbid},
            )
            if resp.status_code == 200:
                artists = resp.json().get("artists") or []
                if artists and artists[0].get("strArtistThumb"):
                    local_url = await cache_image("artists", mbid, artists[0]["strArtistThumb"])
                    return {"image_url": local_url}
    except Exception:
        pass

    return {"image_url": None}


@router.get("", response_model=list[ArtistOut])
async def list_artists(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Artist).order_by(Artist.sort_name))
    return result.scalars().all()


@router.get("/{artist_id}", response_model=ArtistOut)
async def get_artist(artist_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Artist).where(Artist.id == artist_id))
    artist = result.scalar_one_or_none()
    if not artist:
        raise HTTPException(404, "Artist not found")
    if artist.bio is None and artist.mbid:
        bio = await mb.get_artist_bio(artist.mbid)
        if bio:
            artist.bio = bio
            await db.commit()
    return artist


@router.post("", response_model=ArtistOut, status_code=201)
async def subscribe_artist(body: ArtistCreate, db: AsyncSession = Depends(get_db)):
    """
    Subscribe to an artist. Returns immediately with a minimal record; full
    enrichment (MusicBrainz data, image, release groups) runs in the background
    and broadcasts an ``artist_ready`` WebSocket message when complete.
    """
    existing = await db.execute(select(Artist).where(Artist.mbid == body.mbid))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Artist already subscribed")

    artist = Artist(mbid=body.mbid, name=body.name)
    db.add(artist)
    await db.flush()

    # Check if a matching folder already exists in the library
    existing_folder = _find_artist_folder(artist.name)
    if existing_folder:
        artist.folder_name = existing_folder

    await db.commit()
    await db.refresh(artist)

    asyncio.create_task(_enrich_artist(artist.id))

    return artist


async def _enrich_artist(artist_id: int) -> None:
    """Background task: fetch full MusicBrainz data, image, bio and release groups."""
    from app.database import AsyncSessionLocal
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Artist).where(Artist.id == artist_id))
        artist = result.scalar_one_or_none()
        if not artist:
            return

        try:
            mb_artist = await mb.get_artist(artist.mbid)
        except Exception:
            mb_artist = {}

        artist.name = mb_artist.get("name", artist.name)
        artist.sort_name = mb_artist.get("sort-name")
        artist.disambiguation = mb_artist.get("disambiguation")

        for rel in mb_artist.get("url-relation-list", []):
            if "wikidata.org/wiki/Q" in rel.get("target", ""):
                artist.wikidata_id = rel["target"].split("/")[-1]
                break

        try:
            remote_image_url = await mb.get_artist_image_url(mb_artist)
            if remote_image_url:
                artist.image_url = await cache_image("artists", artist.mbid, remote_image_url)
        except Exception:
            pass

        try:
            artist.bio = await mb.get_artist_bio(artist.mbid)
        except Exception:
            pass

        # Fetch language / release-type settings
        lang_result = await session.execute(select(DownloadSettings).where(DownloadSettings.id == 1))
        dl_settings = lang_result.scalar_one_or_none()
        lang_codes = [c.strip() for c in (dl_settings.album_languages if dl_settings else "eng").split(",") if c.strip()]
        rel_types = [c.strip() for c in (dl_settings.release_types if dl_settings else "album,ep").split(",") if c.strip()]

        try:
            mb_groups = await mb.get_release_groups(artist.mbid, languages=lang_codes or None, release_types=rel_types or None)
        except Exception:
            mb_groups = []

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
            session.add(rg)

        await session.commit()
        await session.refresh(artist)

        artist_out = ArtistOut.model_validate(artist)
        await ws_manager.broadcast({"type": "artist_ready", "payload": artist_out.model_dump(mode="json")})

    asyncio.create_task(_fetch_cover_art_for_artist(artist_id))


async def _fetch_cover_art_for_artist(artist_id: int) -> None:
    """Asynchronously fetch cover art URLs and descriptions for all release groups."""
    from app.database import AsyncSessionLocal
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(ReleaseGroup).where(ReleaseGroup.artist_id == artist_id)
        )
        groups = result.scalars().all()
        for rg in groups:
            try:
                remote_url = await get_cover_art_url(rg.mbid)
                if remote_url:
                    local_url = await cache_image("covers", rg.mbid, remote_url)
                    rg.cover_art_url = local_url
            except Exception:
                pass
            try:
                if not rg.description:
                    desc = await mb.get_release_group_description(rg.mbid)
                    if desc:
                        rg.description = desc
            except Exception:
                pass
        await session.commit()


@router.delete("/{artist_id}", status_code=204)
async def unsubscribe_artist(
    artist_id: int,
    delete_files: bool = False,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Artist).where(Artist.id == artist_id))
    artist = result.scalar_one_or_none()
    if not artist:
        raise HTTPException(404, "Artist not found")

    if delete_files and artist.folder_name:
        import shutil

        artist_path = os.path.join(settings.music_library_path, artist.folder_name)
        real_library = os.path.realpath(settings.music_library_path)
        real_artist = os.path.realpath(artist_path)
        # Safety: only delete if path is strictly inside the music library
        if real_artist.startswith(real_library + os.sep) and os.path.isdir(real_artist):
            shutil.rmtree(real_artist)

    await db.delete(artist)
    await db.commit()


@router.get("/{artist_id}/albums", response_model=list[ReleaseGroupOut])
async def get_artist_albums(artist_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ReleaseGroup, func.count(Track.id).label("tc"))
        .outerjoin(Track, Track.release_group_id == ReleaseGroup.id)
        .where(ReleaseGroup.artist_id == artist_id)
        .group_by(ReleaseGroup.id)
        .order_by(ReleaseGroup.first_release_date)
    )
    out = []
    for rg, tc in result.all():
        d = ReleaseGroupOut.model_validate(rg)
        d.track_count = tc or 0
        out.append(d)
    return out


@router.get("/{artist_id}/disk-status", response_model=ArtistDiskStatus)
async def get_artist_disk_status(artist_id: int, db: AsyncSession = Depends(get_db)):
    """Return which release groups are on disk, missing, or unmatched folders."""
    artist_result = await db.execute(select(Artist).where(Artist.id == artist_id))
    artist = artist_result.scalar_one_or_none()
    if not artist:
        raise HTTPException(404, "Artist not found")

    # Single JOIN query for release groups + track counts (no per-RG subqueries)
    rg_result = await db.execute(
        select(ReleaseGroup, func.count(Track.id).label("tc"))
        .outerjoin(Track, Track.release_group_id == ReleaseGroup.id)
        .where(ReleaseGroup.artist_id == artist_id)
        .group_by(ReleaseGroup.id)
        .order_by(ReleaseGroup.first_release_date)
    )
    rows = rg_result.all()

    # One top-level scandir — just lists subdirectory names, no recursive file counting
    disk_subdirs: list[dict] = []
    if artist.folder_name:
        artist_path = os.path.join(settings.music_library_path, artist.folder_name)
        if os.path.isdir(artist_path):
            try:
                for entry in sorted(os.scandir(artist_path), key=lambda e: e.name):
                    if entry.is_dir():
                        disk_subdirs.append({"folder_name": entry.name, "folder_path": entry.path})
            except OSError:
                pass

    all_disk_paths = {f["folder_path"] for f in disk_subdirs}

    # Clear stale folder_path values (folder was deleted/moved)
    changed = False
    for rg, _ in rows:
        if rg.folder_path and rg.folder_path not in all_disk_paths:
            rg.folder_path = None
            rg.file_count = None
            changed = True

    # Fuzzy-match only release groups that still have no folder_path
    THRESHOLD = 0.65
    known_paths = {rg.folder_path for rg, _ in rows if rg.folder_path}
    unmatched_subdirs = [f for f in disk_subdirs if f["folder_path"] not in known_paths]

    for rg, _ in rows:
        if rg.folder_path or not unmatched_subdirs:
            continue
        best, best_score = None, 0.0
        for folder in unmatched_subdirs:
            s = _match_score(folder["folder_name"], rg.title)
            if s > best_score:
                best_score = s
                best = folder
        if best and best_score >= THRESHOLD:
            unmatched_subdirs.remove(best)
            try:
                fc = sum(1 for f in os.scandir(best["folder_path"]) if not f.is_dir())
            except OSError:
                fc = 0
            rg.folder_path = best["folder_path"]
            rg.file_count = fc
            known_paths.add(best["folder_path"])
            changed = True

    if changed:
        await db.commit()

    # Build response from stored DB values — no more disk I/O beyond what's done above
    used_folder_paths: set[str] = set()
    matched: list[MatchedAlbum] = []
    missing: list[ReleaseGroupOut] = []

    for rg, tc in rows:
        rg_out = ReleaseGroupOut.model_validate(rg)
        rg_out.track_count = tc or 0
        if rg.folder_path and rg.folder_path in all_disk_paths:
            used_folder_paths.add(rg.folder_path)
            matched.append(MatchedAlbum(
                release_group=rg_out,
                folder_path=rg.folder_path,
                file_count=rg.file_count or 0,
            ))
        else:
            missing.append(rg_out)

    # Count files only for unmatched folders (typically zero or one)
    unmatched: list[DiskFolder] = []
    for f in disk_subdirs:
        if f["folder_path"] not in used_folder_paths:
            try:
                fc = sum(1 for e in os.scandir(f["folder_path"]) if not e.is_dir())
            except OSError:
                fc = 0
            unmatched.append(DiskFolder(folder_name=f["folder_name"], folder_path=f["folder_path"], file_count=fc))

    return ArtistDiskStatus(matched=matched, missing=missing, unmatched_folders=unmatched)


@router.post("/{artist_id}/relink")
async def relink_artist(artist_id: int, db: AsyncSession = Depends(get_db)):
    """Re-scan this artist's folder and link audio files to track records."""
    result = await db.execute(select(Artist).where(Artist.id == artist_id))
    artist = result.scalar_one_or_none()
    if not artist:
        raise HTTPException(404, "Artist not found")
    if not artist.folder_name:
        raise HTTPException(400, "Artist has no folder configured")

    artist_path = os.path.join(settings.music_library_path, artist.folder_name)
    count = await scanner.link_existing_files(artist_path, db)
    rg_result = await db.execute(select(ReleaseGroup).where(ReleaseGroup.artist_id == artist_id))
    await scanner.link_album_folders(artist_path, rg_result.scalars().all(), db)
    return {"files_linked": count}


@router.post("/{artist_id}/rematch", response_model=ArtistOut)
async def rematch_artist(
    artist_id: int,
    body: ArtistRematch,
    db: AsyncSession = Depends(get_db),
):
    """Reassign an artist to a different MusicBrainz entry."""
    result = await db.execute(select(Artist).where(Artist.id == artist_id))
    artist = result.scalar_one_or_none()
    if not artist:
        raise HTTPException(404, "Artist not found")

    if body.mbid != artist.mbid:
        conflict = await db.execute(select(Artist).where(Artist.mbid == body.mbid))
        if conflict.scalar_one_or_none():
            raise HTTPException(409, "An artist with that MusicBrainz ID already exists")

    mb_artist = await mb.get_artist(body.mbid)
    remote_image_url = await mb.get_artist_image_url(mb_artist)
    image_url = None
    if remote_image_url:
        image_url = await cache_image("artists", body.mbid, remote_image_url)

    wikidata_id = None
    for rel in mb_artist.get("url-relation-list", []):
        if "wikidata.org/wiki/Q" in rel.get("target", ""):
            wikidata_id = rel["target"].split("/")[-1]
            break

    bio = await mb.get_artist_bio(body.mbid)

    artist.mbid = body.mbid
    artist.name = mb_artist.get("name", artist.name)
    artist.sort_name = mb_artist.get("sort-name")
    artist.disambiguation = mb_artist.get("disambiguation")
    artist.image_url = image_url
    artist.wikidata_id = wikidata_id
    artist.bio = bio

    await db.execute(delete(ReleaseGroup).where(ReleaseGroup.artist_id == artist_id))

    lang_result = await db.execute(select(DownloadSettings).where(DownloadSettings.id == 1))
    dl_settings = lang_result.scalar_one_or_none()
    lang_codes = [c.strip() for c in (dl_settings.album_languages if dl_settings else "eng").split(",") if c.strip()]
    rel_types = [c.strip() for c in (dl_settings.release_types if dl_settings else "album,ep").split(",") if c.strip()]

    _EXCLUDED_SECONDARY = {"Live", "Compilation", "Remix", "DJ-mix", "Mixtape/Street", "Demo", "Interview", "Spokenword", "Audiobook", "Audio drama"}
    mb_groups = await mb.get_release_groups(body.mbid, languages=lang_codes or None, release_types=rel_types or None)
    mb_groups = [g for g in mb_groups if not any(t in _EXCLUDED_SECONDARY for t in g.get("secondary-type-list", []))]

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
    await db.refresh(artist)

    asyncio.create_task(_fetch_cover_art_for_artist(artist.id))

    return artist


@router.get("/{artist_id}/artwork-options", response_model=list[ArtworkOption])
async def get_artist_artwork_options(artist_id: int, db: AsyncSession = Depends(get_db)):
    """Return artwork candidates from TheAudioDB and Wikidata for this artist."""
    result = await db.execute(select(Artist).where(Artist.id == artist_id))
    artist = result.scalar_one_or_none()
    if not artist:
        raise HTTPException(404, "Artist not found")

    headers = {
        "User-Agent": (
            f"{settings.musicbrainz_app_name}/{settings.musicbrainz_app_version}"
            f" ({settings.musicbrainz_contact})"
        )
    }
    options = await artwork_svc.fetch_artist_artwork_options(artist.mbid, headers)
    return options


@router.post("/{artist_id}/artwork", response_model=ArtistOut)
async def update_artist_artwork_url(
    artist_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """Update artist artwork from a remote URL."""
    result = await db.execute(select(Artist).where(Artist.id == artist_id))
    artist = result.scalar_one_or_none()
    if not artist:
        raise HTTPException(404, "Artist not found")

    url = body.get("url")
    if not url:
        raise HTTPException(422, "url is required")
    write_to_folder = bool(body.get("write_to_folder", True))

    new_url = await artwork_svc.overwrite_cached_image("artists", artist.mbid, url)
    if not new_url:
        raise HTTPException(502, "Failed to download image")

    artist.image_url = new_url

    if write_to_folder and artist.folder_name:
        import os as _os
        artist_path = _os.path.join(settings.music_library_path, artist.folder_name)
        if _os.path.isdir(artist_path):
            artwork_svc.write_artist_image(artist_path, new_url)

    await db.commit()
    await db.refresh(artist)
    return artist


@router.post("/{artist_id}/artwork/upload", response_model=ArtistOut)
async def upload_artist_artwork(
    artist_id: int,
    file: UploadFile = File(...),
    write_to_folder: str = Form("1"),
    db: AsyncSession = Depends(get_db),
):
    """Update artist artwork via file upload."""
    result = await db.execute(select(Artist).where(Artist.id == artist_id))
    artist = result.scalar_one_or_none()
    if not artist:
        raise HTTPException(404, "Artist not found")

    data = await file.read()
    content_type = file.content_type or "image/jpeg"
    new_url = await artwork_svc.save_uploaded_image("artists", artist.mbid, data, content_type)
    if not new_url:
        raise HTTPException(500, "Failed to save uploaded image")

    artist.image_url = new_url

    if write_to_folder not in ("0", "false") and artist.folder_name:
        import os as _os
        artist_path = _os.path.join(settings.music_library_path, artist.folder_name)
        if _os.path.isdir(artist_path):
            artwork_svc.write_artist_image(artist_path, new_url)

    await db.commit()
    await db.refresh(artist)
    return artist
