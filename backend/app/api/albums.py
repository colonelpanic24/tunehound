import os

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

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


@router.get("", response_model=list[ReleaseGroupOut])
async def list_albums(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ReleaseGroup).order_by(
            ReleaseGroup.first_release_date.desc().nulls_last(),
            ReleaseGroup.title,
        )
    )
    return result.scalars().all()


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
