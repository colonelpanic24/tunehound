from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Artist, DownloadJob, ReleaseGroup, Track

router = APIRouter(prefix="/stats", tags=["stats"])


class StatsOut(BaseModel):
    artists: int
    albums: int
    tracks: int
    files_linked: int
    active_downloads: int
    download_tracks_completed: int
    download_tracks_total: int


@router.get("", response_model=StatsOut)
async def get_stats(db: AsyncSession = Depends(get_db)):
    artists = (await db.execute(select(func.count()).select_from(Artist))).scalar_one()
    albums = (await db.execute(select(func.count()).select_from(ReleaseGroup))).scalar_one()
    tracks = (await db.execute(select(func.count()).select_from(Track))).scalar_one()
    files_linked = (
        await db.execute(select(func.count()).select_from(Track).where(Track.file_path.is_not(None)))
    ).scalar_one()
    active_jobs_row = (
        await db.execute(
            select(
                func.count().label("count"),
                func.coalesce(func.sum(DownloadJob.completed_tracks), 0).label("completed"),
                func.coalesce(func.sum(DownloadJob.total_tracks), 0).label("total"),
            ).select_from(DownloadJob).where(
                DownloadJob.status.in_(["queued", "running"])
            )
        )
    ).one()
    return StatsOut(
        artists=artists,
        albums=albums,
        tracks=tracks,
        files_linked=files_linked,
        active_downloads=active_jobs_row.count,
        download_tracks_completed=active_jobs_row.completed,
        download_tracks_total=active_jobs_row.total,
    )
