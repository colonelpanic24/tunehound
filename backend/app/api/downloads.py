from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import delete as sql_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.albums import _populate_tracks
from app.database import get_db
from app.models import DownloadJob, DownloadSettings, DownloadTrackJob, ReleaseGroup, Track
from app.schemas import (
    DownloadJobCreate,
    DownloadJobOut,
    DownloadSettingsOut,
    DownloadSettingsUpdate,
    DownloadTrackJobCreate,
)

router = APIRouter(prefix="/downloads", tags=["downloads"])

# Injected by main.py at startup
_download_queue = None
_signal_cancel_fn = None


def set_queue(q):
    global _download_queue
    _download_queue = q


def set_cancel_fn(fn):
    global _signal_cancel_fn
    _signal_cancel_fn = fn


@router.post("/jobs", response_model=DownloadJobOut, status_code=201)
async def create_download_job(
    body: DownloadJobCreate,
    db: AsyncSession = Depends(get_db),
):
    # Verify release group exists and has tracks
    rg_result = await db.execute(
        select(ReleaseGroup)
        .where(ReleaseGroup.id == body.release_group_id)
        .options(selectinload(ReleaseGroup.tracks))
    )
    rg = rg_result.scalar_one_or_none()
    if not rg:
        raise HTTPException(404, "Release group not found")

    if not rg.tracks_fetched:
        await _populate_tracks(db, rg)
        # Reload with freshly created tracks
        rg_result = await db.execute(
            select(ReleaseGroup)
            .where(ReleaseGroup.id == body.release_group_id)
            .options(selectinload(ReleaseGroup.tracks))
        )
        rg = rg_result.scalar_one()

    tracks: list[Track] = [t for t in rg.tracks if not t.file_path]
    if not tracks:
        raise HTTPException(400, "All tracks already downloaded")

    job = DownloadJob(
        release_group_id=rg.id,
        total_tracks=len(tracks),
    )
    db.add(job)
    await db.flush()

    for track in sorted(tracks, key=lambda t: (t.disc_number, t.track_number or 0)):
        db.add(DownloadTrackJob(job_id=job.id, track_id=track.id))

    await db.commit()

    # Load with relations for the response
    result = await db.execute(
        select(DownloadJob)
        .where(DownloadJob.id == job.id)
        .options(selectinload(DownloadJob.track_jobs))
    )
    job = result.scalar_one()

    if _download_queue is not None:
        await _download_queue.put(job.id)

    return job


@router.post("/track-jobs", response_model=DownloadJobOut, status_code=201)
async def create_track_download_job(
    body: DownloadTrackJobCreate,
    db: AsyncSession = Depends(get_db),
):
    track = await db.get(Track, body.track_id)
    if not track:
        raise HTTPException(404, "Track not found")
    if track.file_path:
        raise HTTPException(400, "Track already on disk")

    job = DownloadJob(release_group_id=track.release_group_id, total_tracks=1)
    db.add(job)
    await db.flush()
    db.add(DownloadTrackJob(job_id=job.id, track_id=track.id))
    await db.commit()

    result = await db.execute(
        select(DownloadJob)
        .where(DownloadJob.id == job.id)
        .options(selectinload(DownloadJob.track_jobs))
    )
    job = result.scalar_one()
    if _download_queue is not None:
        await _download_queue.put(job.id)
    return job


@router.get("/jobs", response_model=list[DownloadJobOut])
async def list_jobs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DownloadJob)
        .options(selectinload(DownloadJob.track_jobs))
        .order_by(DownloadJob.created_at.desc())
        .limit(50)
    )
    return result.scalars().all()


@router.get("/jobs/{job_id}", response_model=DownloadJobOut)
async def get_job(job_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DownloadJob)
        .where(DownloadJob.id == job_id)
        .options(selectinload(DownloadJob.track_jobs))
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@router.post("/jobs/{job_id}/stop", status_code=204)
async def stop_job(job_id: int, db: AsyncSession = Depends(get_db)):
    """Signal cancellation for a running job. It will stop after the current track."""
    result = await db.execute(select(DownloadJob).where(DownloadJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(404, "Job not found")
    if job.status != "running":
        raise HTTPException(400, "Job is not running")
    if _signal_cancel_fn:
        _signal_cancel_fn(job_id)
    return Response(status_code=204)


@router.delete("/jobs/{job_id}", status_code=204)
async def delete_job(job_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a job record. Running jobs must be stopped first."""
    result = await db.execute(select(DownloadJob).where(DownloadJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(404, "Job not found")
    if job.status == "running":
        raise HTTPException(400, "Stop the job before deleting it")
    await db.delete(job)
    await db.commit()
    return Response(status_code=204)


@router.delete("/jobs", status_code=204)
async def clear_all_jobs(db: AsyncSession = Depends(get_db)):
    """Stop any running job and delete all job records."""
    running_result = await db.execute(
        select(DownloadJob).where(DownloadJob.status == "running")
    )
    for job in running_result.scalars().all():
        if _signal_cancel_fn:
            _signal_cancel_fn(job.id)

    await db.execute(sql_delete(DownloadJob))
    await db.commit()
    return Response(status_code=204)


# ── Settings ───────────────────────────────────────────────────────────────────

@router.get("/settings", response_model=DownloadSettingsOut)
async def get_settings(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DownloadSettings).where(DownloadSettings.id == 1))
    row = result.scalar_one_or_none()
    if not row:
        from app.config import settings as app_settings
        row = DownloadSettings(
            id=1,
            audio_format=app_settings.default_download_format,
            delay_min=app_settings.default_download_delay_min,
            delay_max=app_settings.default_download_delay_max,
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return row


@router.patch("/settings", response_model=DownloadSettingsOut)
async def update_settings(
    body: DownloadSettingsUpdate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(DownloadSettings).where(DownloadSettings.id == 1))
    row = result.scalar_one_or_none()
    if not row:
        from app.config import settings as app_settings
        row = DownloadSettings(
            id=1,
            audio_format=app_settings.default_download_format,
            delay_min=app_settings.default_download_delay_min,
            delay_max=app_settings.default_download_delay_max,
        )
        db.add(row)

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(row, field, value)

    await db.commit()
    await db.refresh(row)
    return row
