"""
Retag job API — create, query, and monitor background tag-writing jobs.
"""
import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import ReleaseGroup, RetagJob, RetagTrackJob
from app.schemas import RetagJobIn, RetagJobOut

router = APIRouter(prefix="/retag-jobs", tags=["retag"])


@router.post("", response_model=RetagJobOut, status_code=201)
async def create_retag_job(body: RetagJobIn, db: AsyncSession = Depends(get_db)):
    """Create a retag job and start it in the background."""
    # Verify release group exists
    rg_result = await db.execute(
        select(ReleaseGroup).where(ReleaseGroup.id == body.release_group_id)
    )
    rg = rg_result.scalar_one_or_none()
    if not rg:
        raise HTTPException(404, "Release group not found")

    job = RetagJob(
        release_group_id=body.release_group_id,
        status="queued",
        total_tracks=len(body.track_jobs),
        completed_tracks=0,
    )
    db.add(job)
    await db.flush()  # get job.id

    for tj in body.track_jobs:
        track_job = RetagTrackJob(
            job_id=job.id,
            track_id=tj.track_id,
            fields=json.dumps(tj.fields),
            status="queued",
        )
        db.add(track_job)

    await db.commit()
    await db.refresh(job)

    # Reload with track_jobs
    result = await db.execute(
        select(RetagJob)
        .where(RetagJob.id == job.id)
        .options(selectinload(RetagJob.track_jobs))
    )
    job = result.scalar_one()

    # Start background task
    from app.services.retagger import run_retag_job
    asyncio.create_task(run_retag_job(job.id))

    return _to_out(job)


@router.get("/album/{release_group_id}", response_model=RetagJobOut | None)
async def get_latest_retag_job(release_group_id: int, db: AsyncSession = Depends(get_db)):
    """Get the most recent retag job for an album."""
    result = await db.execute(
        select(RetagJob)
        .where(RetagJob.release_group_id == release_group_id)
        .options(selectinload(RetagJob.track_jobs))
        .order_by(RetagJob.id.desc())
        .limit(1)
    )
    job = result.scalar_one_or_none()
    if not job:
        return None
    return _to_out(job)


@router.get("/{job_id}", response_model=RetagJobOut)
async def get_retag_job(job_id: int, db: AsyncSession = Depends(get_db)):
    """Get a retag job by ID."""
    result = await db.execute(
        select(RetagJob)
        .where(RetagJob.id == job_id)
        .options(selectinload(RetagJob.track_jobs))
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(404, "Retag job not found")
    return _to_out(job)


def _to_out(job: RetagJob) -> RetagJobOut:
    """Convert a RetagJob ORM object to RetagJobOut, decoding JSON fields on track_jobs."""
    from app.schemas import RetagTrackJobOut
    track_jobs_out = []
    for tj in job.track_jobs:
        try:
            fields = json.loads(tj.fields)
        except Exception:
            fields = []
        track_jobs_out.append(RetagTrackJobOut(
            id=tj.id,
            track_id=tj.track_id,
            fields=fields,
            status=tj.status,
            error_message=tj.error_message,
        ))
    return RetagJobOut(
        id=job.id,
        release_group_id=job.release_group_id,
        status=job.status,
        total_tracks=job.total_tracks,
        completed_tracks=job.completed_tracks,
        error_message=job.error_message,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        track_jobs=track_jobs_out,
    )
