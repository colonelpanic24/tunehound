"""
Background retag worker. Processes RetagJob records.
"""
import asyncio
import json
import os
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import AsyncSessionLocal
from app.models import ReleaseGroup, RetagJob, RetagTrackJob, Track


async def run_retag_job(job_id: int) -> None:
    """Run a retag job to completion."""
    from app.services.image_cache import _IMAGES_DIR
    from app.services.tag_reader import read_tags

    async with AsyncSessionLocal() as db:
        # Load job with track_jobs eagerly
        result = await db.execute(
            select(RetagJob)
            .where(RetagJob.id == job_id)
            .options(
                selectinload(RetagJob.track_jobs).selectinload(RetagTrackJob.track)
            )
        )
        job = result.scalar_one_or_none()
        if not job:
            return

        job.status = "running"
        job.started_at = datetime.utcnow()
        await db.commit()

        # Load release group for album/artist context
        rg_result = await db.execute(
            select(ReleaseGroup)
            .where(ReleaseGroup.id == job.release_group_id)
            .options(selectinload(ReleaseGroup.artist))
        )
        rg = rg_result.scalar_one_or_none()
        if not rg:
            job.status = "failed"
            job.error_message = "Release group not found"
            await db.commit()
            return

        # Resolve cover art path
        cover_path = None
        if rg.cover_art_url:
            rel = rg.cover_art_url.lstrip("/")
            cover_path = os.path.join(os.path.dirname(_IMAGES_DIR), rel)
            if not os.path.isfile(cover_path):
                # Try alternate resolution
                sub = rel.replace("images/", "", 1)
                cover_path = os.path.join(_IMAGES_DIR, sub)
                if not os.path.isfile(cover_path):
                    cover_path = None

        try:
            for track_job in job.track_jobs:
                if track_job.status != "queued":
                    continue
                track = track_job.track
                if not track or not track.file_path or not os.path.isfile(track.file_path):
                    track_job.status = "failed"
                    track_job.error_message = "File not found"
                    job.completed_tracks += 1
                    await db.commit()
                    _broadcast_progress(job)
                    continue

                fields = json.loads(track_job.fields)
                track_job.status = "running"
                await db.commit()

                try:
                    # Build the metadata dict for this track
                    meta = {}
                    if "title" in fields:
                        meta["title"] = track.title
                    if "artist" in fields:
                        meta["artist"] = rg.artist.name if rg.artist else None
                    if "album" in fields:
                        meta["album"] = rg.title
                    if "track_number" in fields:
                        meta["track_number"] = track.track_number
                    if "cover_art" in fields and cover_path:
                        with open(cover_path, "rb") as f:
                            meta["cover_art"] = f.read()

                    # Write using existing tagger
                    _write_tags(track.file_path, meta, rg, track)

                    # Update tag snapshot
                    snap = read_tags(track.file_path)
                    if snap:
                        track.tag_title = snap.title
                        track.tag_artist = snap.artist
                        track.tag_album = snap.album
                        track.tag_track_number = snap.track_number
                        track.tag_art_hash = snap.art_hash
                        track.tags_scanned_at = snap.scanned_at

                    track_job.status = "completed"
                    job.completed_tracks += 1
                    await db.commit()
                    _broadcast_progress(job)

                except Exception as e:
                    track_job.status = "failed"
                    track_job.error_message = str(e)
                    job.completed_tracks += 1
                    await db.commit()
                    _broadcast_progress(job)

            job.status = "completed"
            job.completed_at = datetime.utcnow()
            await db.commit()

        except Exception as e:
            job.status = "failed"
            job.error_message = str(e)
            await db.commit()

        _broadcast_final(job)


def _write_tags(file_path: str, meta: dict, rg: ReleaseGroup, track: Track) -> None:
    """Write tags to a file using the existing tagger logic."""
    from app.services.tagger import tag_file
    # Determine year from release group's first_release_date
    year = None
    if rg.first_release_date:
        year = rg.first_release_date[:4]

    tag_file(
        file_path=file_path,
        title=meta.get("title") or track.title,
        artist=meta.get("artist") or "",
        album=meta.get("album") or rg.title,
        track_number=meta.get("track_number") if meta.get("track_number") is not None else (track.track_number or 0),
        disc_number=track.disc_number or 1,
        year=year,
        cover_bytes=meta.get("cover_art"),
        recording_mbid=track.mbid,
        release_group_mbid=rg.mbid,
        artist_mbid=rg.artist.mbid if rg.artist else None,
    )


def _broadcast_progress(job: RetagJob) -> None:
    """Send WebSocket progress notification."""
    from app.api.ws import manager as ws_manager
    try:
        asyncio.create_task(ws_manager.broadcast({
            "type": "retag_progress",
            "payload": {
                "job_id": job.id,
                "status": job.status,
                "total": job.total_tracks,
                "completed": job.completed_tracks,
            }
        }))
    except Exception:
        pass


def _broadcast_final(job: RetagJob) -> None:
    from app.api.ws import manager as ws_manager
    try:
        asyncio.create_task(ws_manager.broadcast({
            "type": "retag_complete",
            "payload": {"job_id": job.id, "status": job.status}
        }))
    except Exception:
        pass
