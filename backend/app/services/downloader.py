"""
Download tracks from YouTube Music using yt-dlp.

Runs one track at a time with configurable inter-track delays to avoid
triggering YouTube rate limiting. Progress is emitted via a callback so
the WebSocket layer can broadcast updates to connected clients.
"""

import asyncio
import os
import random
import re
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

import yt_dlp
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings as app_settings
from app.models import DownloadJob, DownloadSettings, DownloadTrackJob, ReleaseGroup, Track
from app.services import tagger
from app.services.coverart import fetch_cover_art_bytes

# ── Path helpers ───────────────────────────────────────────────────────────────

_UNSAFE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')

# yt-dlp codec name → actual file extension (codec name ≠ extension for vorbis)
_CODEC_EXT: dict[str, str] = {
    "vorbis": "ogg",
}


def _safe(name: str) -> str:
    return _UNSAFE.sub("_", name).strip(". ")


def _ext(audio_format: str) -> str:
    return _CODEC_EXT.get(audio_format, audio_format)


def expected_track_path(
    artist_name: str,
    album_title: str,
    first_release_date: str | None,
    track_number: int,
    disc_number: int,
    track_title: str,
    audio_format: str,
    total_discs: int = 1,
) -> str:
    year = (first_release_date or "")[:4] or "Unknown"
    artist_dir = _safe(artist_name)
    album_dir = f"{_safe(album_title)} ({year})"
    ext = _ext(audio_format)
    if total_discs > 1:
        filename = f"{disc_number:02d}-{track_number:02d} - {_safe(track_title)}.{ext}"
    else:
        filename = f"{track_number:02d} - {_safe(track_title)}.{ext}"
    return os.path.join(app_settings.music_library_path, artist_dir, album_dir, filename)


# ── Core download logic ────────────────────────────────────────────────────────

async def run_download_job(
    job_id: int,
    db_session_factory,
    broadcast: Callable[[dict], Awaitable[None]],
    cancel_event: asyncio.Event | None = None,
) -> None:
    """
    Entry point called by the background worker.
    Loads the job from the DB, downloads each track, updates state, and broadcasts
    progress. Does NOT raise — errors are written to the job record.
    """
    async with db_session_factory() as db:
        job = await _load_job(db, job_id)
        if job is None:
            return

        dl_settings = await _load_settings(db)
        release_group = job.release_group
        artist = release_group.artist
        tracks: list[Track] = release_group.tracks

        # Mark job as running
        job.status = "running"
        job.started_at = datetime.now(UTC)
        job.total_tracks = len(job.track_jobs)
        await db.commit()
        await broadcast({"type": "job_update", "payload": _job_dict(job)})

        # Fetch cover art once for the whole album
        cover_bytes = await fetch_cover_art_bytes(release_group.mbid)

        total_discs = max((t.disc_number for t in tracks), default=1)

        for track_job in job.track_jobs:
            if cancel_event and cancel_event.is_set():
                break

            track = next(t for t in tracks if t.id == track_job.track_id)

            output_path = expected_track_path(
                artist_name=artist.name,
                album_title=release_group.title,
                first_release_date=release_group.first_release_date,
                track_number=track.track_number or 0,
                disc_number=track.disc_number,
                track_title=track.title,
                audio_format=dl_settings.audio_format,
                total_discs=total_discs,
            )

            # Update job UI state
            job.current_track_title = track.title
            track_job.status = "downloading"
            track_job.started_at = datetime.now(UTC)
            search_query = dl_settings.search_query_template.format(
                artist=artist.name,
                title=track.title,
                album=release_group.title,
            )
            track_job.yt_search_query = search_query
            await db.commit()
            await broadcast(
                {
                    "type": "track_update",
                    "payload": {
                        "job_id": job.id,
                        "track_job": _track_job_dict(track_job),
                        "job_progress": {
                            "completed": job.completed_tracks,
                            "total": job.total_tracks,
                            "current_track": track.title,
                        },
                    },
                }
            )

            try:
                video_id = await _download_track(
                    search_query=search_query,
                    output_path=output_path,
                    dl_settings=dl_settings,
                )
                # Tag the file
                await asyncio.get_event_loop().run_in_executor(
                    None,
                    tagger.tag_file,
                    output_path,
                    track.title,
                    artist.name,
                    release_group.title,
                    track.track_number or 0,
                    track.disc_number,
                    (release_group.first_release_date or "")[:4] or None,
                    cover_bytes,
                    track.mbid,
                    release_group.mbid,
                    artist.mbid,
                )
                track.file_path = output_path
                track_job.status = "completed"
                track_job.yt_video_id = video_id
            except Exception as exc:
                track_job.status = "failed"
                track_job.error_message = str(exc)

            track_job.completed_at = datetime.now(UTC)
            job.completed_tracks += 1
            await db.commit()
            await broadcast(
                {
                    "type": "track_update",
                    "payload": {
                        "job_id": job.id,
                        "track_job": _track_job_dict(track_job),
                        "job_progress": {
                            "completed": job.completed_tracks,
                            "total": job.total_tracks,
                            "current_track": track.title,
                        },
                    },
                }
            )

            # Inter-track delay — skip if cancelling
            if not (cancel_event and cancel_event.is_set()) and track_job != job.track_jobs[-1]:
                delay = random.uniform(dl_settings.delay_min, dl_settings.delay_max)
                await asyncio.sleep(delay)

        # Finalize job
        job.current_track_title = None
        job.completed_at = datetime.now(UTC)
        if cancel_event and cancel_event.is_set():
            job.status = "cancelled"
            job.error_message = "Stopped by user"
        else:
            failed = sum(1 for tj in job.track_jobs if tj.status == "failed")
            job.status = "completed" if failed == 0 else "failed"
            if failed:
                job.error_message = f"{failed} track(s) failed to download"
        try:
            await db.commit()
            await broadcast({"type": "job_update", "payload": _job_dict(job)})
        except Exception:
            pass  # Job may have been deleted while running (clear-all)


async def _download_track(
    search_query: str,
    output_path: str,
    dl_settings: "DownloadSettings",
) -> str | None:
    """Run yt-dlp in a thread pool. Returns the video ID if found."""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    # Strip extension — yt-dlp adds it after post-processing
    output_template = os.path.splitext(output_path)[0] + ".%(ext)s"

    postprocessors = [
        {
            "key": "FFmpegExtractAudio",
            "preferredcodec": dl_settings.audio_format,
        }
    ]

    sb_categories = [c.strip() for c in (dl_settings.sponsorblock_remove or "").split(",") if c.strip()]
    if sb_categories:
        postprocessors.append({"key": "SponsorBlock", "categories": sb_categories})
        postprocessors.append({"key": "ModifyChapters", "remove_sponsor_segments": sb_categories})

    ydl_opts: dict = {
        "format": dl_settings.yt_format,
        "postprocessors": postprocessors,
        "outtmpl": output_template,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "default_search": "ytsearch",
        "retries": dl_settings.max_retries,
        "concurrent_fragment_downloads": dl_settings.concurrent_fragment_downloads,
        "geo_bypass": dl_settings.geo_bypass,
    }

    if dl_settings.rate_limit_bps:
        ydl_opts["ratelimit"] = dl_settings.rate_limit_bps

    if dl_settings.cookies_file and os.path.exists(dl_settings.cookies_file):
        ydl_opts["cookiefile"] = dl_settings.cookies_file

    if dl_settings.proxy:
        ydl_opts["proxy"] = dl_settings.proxy

    n_results = max(1, dl_settings.yt_search_results)
    video_id: list[str | None] = [None]

    def _run():
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"ytsearch{n_results}:{search_query}", download=True)
            if info and "entries" in info and info["entries"]:
                video_id[0] = info["entries"][0].get("id")
            elif info:
                video_id[0] = info.get("id")

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _run)
    return video_id[0]


# ── DB helpers ─────────────────────────────────────────────────────────────────

async def _load_job(db: AsyncSession, job_id: int) -> DownloadJob | None:
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    result = await db.execute(
        select(DownloadJob)
        .where(DownloadJob.id == job_id)
        .options(
            selectinload(DownloadJob.track_jobs).selectinload(DownloadTrackJob.track),
            selectinload(DownloadJob.release_group)
            .selectinload(ReleaseGroup.tracks),
            selectinload(DownloadJob.release_group)
            .selectinload(ReleaseGroup.artist),
        )
    )
    return result.scalar_one_or_none()


async def _load_settings(db: AsyncSession) -> DownloadSettings:
    from sqlalchemy import select

    result = await db.execute(select(DownloadSettings).where(DownloadSettings.id == 1))
    row = result.scalar_one_or_none()
    if row is None:
        row = DownloadSettings(
            id=1,
            audio_format=app_settings.default_download_format,
            delay_min=app_settings.default_download_delay_min,
            delay_max=app_settings.default_download_delay_max,
        )
        db.add(row)
        await db.commit()
    return row


def _job_dict(job: DownloadJob) -> dict:
    return {
        "id": job.id,
        "release_group_id": job.release_group_id,
        "status": job.status,
        "total_tracks": job.total_tracks,
        "completed_tracks": job.completed_tracks,
        "current_track_title": job.current_track_title,
        "error_message": job.error_message,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }


def _track_job_dict(tj: DownloadTrackJob) -> dict:
    return {
        "id": tj.id,
        "job_id": tj.job_id,
        "track_id": tj.track_id,
        "status": tj.status,
        "yt_video_id": tj.yt_video_id,
        "yt_search_query": tj.yt_search_query,
        "error_message": tj.error_message,
        "started_at": tj.started_at.isoformat() if tj.started_at else None,
        "completed_at": tj.completed_at.isoformat() if tj.completed_at else None,
    }
