import os

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer, selectinload

from app.config import settings
from app.database import get_db
from app.models import Artist, ReleaseGroup, Track
from app.schemas import (
    AlbumTagStatusOut,
    ArtworkOption,
    ReleaseGroupOut,
    ReleaseGroupUpdate,
    TagFieldStatus,
    TrackOut,
    TrackTagStatus,
)
from app.services import artwork as artwork_svc
from app.services import musicbrainz as mb
from app.services import scanner
from app.services.tag_reader import read_tags
from app.services.tagger import compute_art_hash_from_cover_file

router = APIRouter(prefix="/albums", tags=["albums"])


@router.get("")
async def list_albums(
    offset: int = 0,
    limit: int = 96,
    sort: str = "date",
    dir: str = "desc",
    avail: str = "all",
    search: str = "",
    watched_only: bool = False,
    grouped: bool = False,
    db: AsyncSession = Depends(get_db),
):
    from collections import defaultdict

    from sqlalchemy import and_, case, distinct, func

    from app.models import Artist
    from app.schemas import AlbumCounts, AlbumGroup, AlbumGroupsPage, AlbumsPage

    limit = min(limit, 200)

    # ── Filter conditions ──────────────────────────────────────────────────────
    base_conds = []
    if search:
        base_conds.append(ReleaseGroup.title.ilike(f"%{search}%"))
    if watched_only:
        base_conds.append(ReleaseGroup.watched.is_(True))

    avail_conds = list(base_conds)
    if avail == "on-disk":
        avail_conds.append(ReleaseGroup.folder_path.isnot(None))
    elif avail == "missing":
        avail_conds.append(ReleaseGroup.folder_path.is_(None))

    # ── Tab counts (base filters only, not avail) ──────────────────────────────
    counts_q = select(
        func.count(ReleaseGroup.id).label("total"),
        func.count(ReleaseGroup.folder_path).label("on_disk"),
    )
    if base_conds:
        counts_q = counts_q.where(and_(*base_conds))
    counts_row = (await db.execute(counts_q)).one()
    counts = AlbumCounts(
        all=counts_row.total,
        on_disk=counts_row.on_disk,
        missing=counts_row.total - counts_row.on_disk,
    )

    if not grouped:
        # ── Flat paginated albums ──────────────────────────────────────────────
        total_q = select(func.count(ReleaseGroup.id))
        if avail_conds:
            total_q = total_q.where(and_(*avail_conds))
        total = (await db.execute(total_q)).scalar_one()

        avail_expr = case((ReleaseGroup.folder_path.isnot(None), 1), else_=0)
        sort_map: dict[str, list] = {
            "date_asc":   [ReleaseGroup.first_release_date.asc().nulls_last(),  ReleaseGroup.title.asc()],
            "date_desc":  [ReleaseGroup.first_release_date.desc().nulls_last(), ReleaseGroup.title.asc()],
            "title_asc":  [ReleaseGroup.title.asc()],
            "title_desc": [ReleaseGroup.title.desc()],
            "avail_asc":  [avail_expr.asc(),  ReleaseGroup.first_release_date.desc().nulls_last()],
            "avail_desc": [avail_expr.desc(), ReleaseGroup.first_release_date.desc().nulls_last()],
        }
        orders = sort_map.get(f"{sort}_{dir}", sort_map["date_desc"])

        q = select(ReleaseGroup).options(defer(ReleaseGroup.description))
        if avail_conds:
            q = q.where(and_(*avail_conds))
        q = q.order_by(*orders).offset(offset).limit(limit)
        items = (await db.execute(q)).scalars().all()

        return AlbumsPage(items=items, total=total, counts=counts)

    else:
        # ── Grouped by artist (paginate by artist) ─────────────────────────────
        total_q = select(func.count(distinct(ReleaseGroup.artist_id)))
        if avail_conds:
            total_q = total_q.where(and_(*avail_conds))
        total = (await db.execute(total_q)).scalar_one()

        sort_key = func.coalesce(Artist.sort_name, Artist.name)
        artist_ids_q = (
            select(ReleaseGroup.artist_id)
            .join(Artist, Artist.id == ReleaseGroup.artist_id)
            .group_by(ReleaseGroup.artist_id)
            .order_by(sort_key.asc() if dir == "asc" else sort_key.desc())
            .offset(offset)
            .limit(limit)
        )
        if avail_conds:
            artist_ids_q = artist_ids_q.where(and_(*avail_conds))
        artist_id_rows = (await db.execute(artist_ids_q)).all()
        artist_ids_ordered = [r[0] for r in artist_id_rows]

        if not artist_ids_ordered:
            return AlbumGroupsPage(items=[], total=total, counts=counts)

        artists_result = await db.execute(
            select(Artist).where(Artist.id.in_(artist_ids_ordered))
        )
        artists_by_id: dict[int, Artist] = {a.id: a for a in artists_result.scalars().all()}

        albums_q = (
            select(ReleaseGroup)
            .options(defer(ReleaseGroup.description))
            .where(ReleaseGroup.artist_id.in_(artist_ids_ordered))
            .order_by(ReleaseGroup.first_release_date.desc().nulls_last())
        )
        if avail_conds:
            albums_q = albums_q.where(and_(*avail_conds))
        all_albums = (await db.execute(albums_q)).scalars().all()

        albums_by_artist: dict[int, list] = defaultdict(list)
        for album in all_albums:
            albums_by_artist[album.artist_id].append(album)

        groups = [
            AlbumGroup(
                artist_id=aid,
                artist_name=artists_by_id[aid].name,
                artist_sort_name=artists_by_id[aid].sort_name,
                artist_image_url=artists_by_id[aid].image_url,
                albums=[ReleaseGroupOut.model_validate(a) for a in albums_by_artist[aid]],
            )
            for aid in artist_ids_ordered
            if aid in artists_by_id and albums_by_artist[aid]
        ]
        return AlbumGroupsPage(items=groups, total=total, counts=counts)


@router.get("/{album_id}", response_model=ReleaseGroupOut)
async def get_album(album_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ReleaseGroup)
        .where(ReleaseGroup.id == album_id)
        .options(selectinload(ReleaseGroup.tracks))
    )
    rg = result.scalar_one_or_none()
    if not rg:
        raise HTTPException(404, "Album not found")
    if rg.description is None:
        desc = await mb.get_release_group_description(rg.mbid)
        if desc:
            rg.description = desc
            await db.commit()
    d = ReleaseGroupOut.model_validate(rg)
    d.track_count = len(rg.tracks)
    return d


@router.patch("/{album_id}", response_model=ReleaseGroupOut)
async def update_album(
    album_id: int,
    body: ReleaseGroupUpdate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ReleaseGroup)
        .where(ReleaseGroup.id == album_id)
        .options(selectinload(ReleaseGroup.tracks))
    )
    rg = result.scalar_one_or_none()
    if not rg:
        raise HTTPException(404, "Album not found")

    if body.watched is not None:
        rg.watched = body.watched

    await db.commit()
    await db.refresh(rg)
    d = ReleaseGroupOut.model_validate(rg)
    d.track_count = len(rg.tracks)
    return d


@router.get("/{album_id}/tracks", response_model=list[TrackOut])
async def get_album_tracks(album_id: int, db: AsyncSession = Depends(get_db)):
    """
    Return tracks for an album. Fetches from MusicBrainz on first call
    and caches them in the DB.
    """
    result = await db.execute(
        select(ReleaseGroup).where(ReleaseGroup.id == album_id)
    )
    rg = result.scalar_one_or_none()
    if not rg:
        raise HTTPException(404, "Album not found")

    if not rg.tracks_fetched:
        await _populate_tracks(db, rg)

    # Link any on-disk files to track records (runs every time so new downloads are reflected)
    artist_result = await db.execute(select(Artist).where(Artist.id == rg.artist_id))
    artist = artist_result.scalar_one_or_none()
    if artist and artist.folder_name:
        artist_path = os.path.join(settings.music_library_path, artist.folder_name)
        await scanner.link_existing_files(artist_path, db)

    track_result = await db.execute(
        select(Track)
        .where(Track.release_group_id == album_id)
        .order_by(Track.disc_number, Track.track_number)
    )
    return track_result.scalars().all()


@router.get("/{album_id}/artwork-options", response_model=list[ArtworkOption])
async def get_album_artwork_options(album_id: int, db: AsyncSession = Depends(get_db)):
    """Return artwork candidates from Cover Art Archive for this album."""
    result = await db.execute(select(ReleaseGroup).where(ReleaseGroup.id == album_id))
    rg = result.scalar_one_or_none()
    if not rg:
        raise HTTPException(404, "Album not found")
    options = await artwork_svc.fetch_album_artwork_options(rg.mbid)
    return options


@router.post("/{album_id}/artwork", response_model=ReleaseGroupOut)
async def update_album_artwork_url(
    album_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """Update album artwork from a URL."""
    result = await db.execute(
        select(ReleaseGroup)
        .where(ReleaseGroup.id == album_id)
        .options(selectinload(ReleaseGroup.tracks))
    )
    rg = result.scalar_one_or_none()
    if not rg:
        raise HTTPException(404, "Album not found")

    url = body.get("url")
    if not url:
        raise HTTPException(422, "url is required")

    new_url = await artwork_svc.overwrite_cached_image("covers", rg.mbid, url)
    if not new_url:
        raise HTTPException(502, "Failed to download image")

    rg.cover_art_url = new_url
    rg.cover_art_hash = compute_art_hash_from_cover_file(new_url)

    # Write cover.jpg to folder if folder_path is set
    if rg.folder_path and os.path.isdir(rg.folder_path):
        artwork_svc.write_folder_image(rg.folder_path, new_url)

    await db.commit()
    await db.refresh(rg)
    d = ReleaseGroupOut.model_validate(rg)
    d.track_count = len(rg.tracks)
    return d


@router.post("/{album_id}/artwork/upload", response_model=ReleaseGroupOut)
async def upload_album_artwork(
    album_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Update album artwork via file upload."""
    result = await db.execute(
        select(ReleaseGroup)
        .where(ReleaseGroup.id == album_id)
        .options(selectinload(ReleaseGroup.tracks))
    )
    rg = result.scalar_one_or_none()
    if not rg:
        raise HTTPException(404, "Album not found")

    data = await file.read()
    content_type = file.content_type or "image/jpeg"
    new_url = await artwork_svc.save_uploaded_image("covers", rg.mbid, data, content_type)
    if not new_url:
        raise HTTPException(500, "Failed to save uploaded image")

    rg.cover_art_url = new_url
    rg.cover_art_hash = compute_art_hash_from_cover_file(new_url)

    if rg.folder_path and os.path.isdir(rg.folder_path):
        artwork_svc.write_folder_image(rg.folder_path, new_url)

    await db.commit()
    await db.refresh(rg)
    d = ReleaseGroupOut.model_validate(rg)
    d.track_count = len(rg.tracks)
    return d


@router.get("/{album_id}/tag-status", response_model=AlbumTagStatusOut)
async def get_album_tag_status(album_id: int, db: AsyncSession = Depends(get_db)):
    """Return per-track tag comparison against DB snapshot."""
    result = await db.execute(
        select(ReleaseGroup)
        .where(ReleaseGroup.id == album_id)
        .options(
            selectinload(ReleaseGroup.tracks),
            selectinload(ReleaseGroup.artist),
        )
    )
    rg = result.scalar_one_or_none()
    if not rg:
        raise HTTPException(404, "Album not found")

    artist_name = rg.artist.name if rg.artist else None

    track_statuses = []
    for track in sorted(rg.tracks, key=lambda t: (t.disc_number or 1, t.track_number or 0)):
        if not track.file_path:
            continue

        issues: list[TagFieldStatus] = []

        def _norm(v: str | None) -> str:
            return (v or "").strip()

        def _norm_tracknum(v: str | None) -> str:
            """Normalise '3/12' -> '3', '03' -> '3'."""
            if not v:
                return ""
            v = v.strip().split("/")[0].lstrip("0") or "0"
            return v

        # Compare title
        expected_title = _norm(track.title)
        actual_title = _norm(track.tag_title)
        if expected_title and actual_title and expected_title != actual_title:
            issues.append(TagFieldStatus(field="title", expected=expected_title, actual=actual_title or None))

        # Compare artist
        if artist_name:
            expected_artist = _norm(artist_name)
            actual_artist = _norm(track.tag_artist)
            if expected_artist and actual_artist and expected_artist != actual_artist:
                issues.append(TagFieldStatus(field="artist", expected=expected_artist, actual=actual_artist or None))

        # Compare album
        expected_album = _norm(rg.title)
        actual_album = _norm(track.tag_album)
        if expected_album and actual_album and expected_album != actual_album:
            issues.append(TagFieldStatus(field="album", expected=expected_album, actual=actual_album or None))

        # Compare track number
        if track.track_number is not None and track.tag_track_number:
            expected_tn = str(track.track_number)
            actual_tn = _norm_tracknum(track.tag_track_number)
            if expected_tn != actual_tn:
                issues.append(TagFieldStatus(
                    field="track_number",
                    expected=expected_tn,
                    actual=track.tag_track_number,
                ))

        # Compare cover art hash
        if rg.cover_art_hash:
            if not track.tag_art_hash:
                issues.append(TagFieldStatus(field="cover_art", expected=rg.cover_art_hash, actual=None))
            elif track.tag_art_hash != rg.cover_art_hash:
                issues.append(TagFieldStatus(field="cover_art", expected=rg.cover_art_hash, actual=track.tag_art_hash))

        track_statuses.append(TrackTagStatus(
            track_id=track.id,
            file_path=track.file_path,
            tags_scanned_at=track.tags_scanned_at,
            in_sync=len(issues) == 0,
            issues=issues,
        ))

    return AlbumTagStatusOut(release_group_id=album_id, tracks=track_statuses)


@router.post("/{album_id}/scan-tags", response_model=AlbumTagStatusOut)
async def scan_album_tags(album_id: int, db: AsyncSession = Depends(get_db)):
    """Re-read all track tags from disk and update snapshots."""
    result = await db.execute(
        select(ReleaseGroup)
        .where(ReleaseGroup.id == album_id)
        .options(
            selectinload(ReleaseGroup.tracks),
            selectinload(ReleaseGroup.artist),
        )
    )
    rg = result.scalar_one_or_none()
    if not rg:
        raise HTTPException(404, "Album not found")

    for track in rg.tracks:
        if not track.file_path or not os.path.isfile(track.file_path):
            continue
        snap = read_tags(track.file_path)
        if snap:
            track.tag_title = snap.title
            track.tag_artist = snap.artist
            track.tag_album = snap.album
            track.tag_track_number = snap.track_number
            track.tag_art_hash = snap.art_hash
            track.tags_scanned_at = snap.scanned_at

    await db.commit()

    # Delegate to tag-status endpoint logic (re-fetch for freshness)
    return await get_album_tag_status(album_id, db)


async def _populate_tracks(db: AsyncSession, rg: ReleaseGroup) -> None:
    try:
        mb_tracks = await mb.get_tracks_for_release_group(rg.mbid)
        for t in mb_tracks:
            track = Track(
                mbid=t["mbid"],
                release_group_id=rg.id,
                title=t["title"],
                track_number=t["track_number"],
                disc_number=t["disc_number"],
                duration_ms=t["duration_ms"],
            )
            db.add(track)
        rg.tracks_fetched = True
        await db.commit()
    except Exception as exc:
        # Don't crash the request if MB is unavailable
        await db.rollback()
        raise HTTPException(502, f"MusicBrainz error: {exc}")
