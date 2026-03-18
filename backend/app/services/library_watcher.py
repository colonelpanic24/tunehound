"""
Watches the music library directory for changes and syncs file_path on Track
records to reflect files added, moved, or deleted outside the app.
"""

import asyncio
import os
import re

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

# Supported audio extensions
AUDIO_EXTS = {".ogg", ".opus", ".flac", ".mp3", ".m4a", ".aac", ".wav"}

_observer: Observer | None = None


def _extract_track_info(path: str) -> dict | None:
    """
    Try to parse Lidarr-style path:
      /music/<Artist>/<Album> (<Year>)/<TrackNo> - <Title>.ext
    Returns None if the path doesn't match.
    """
    parts = path.replace("\\", "/").split("/")
    if len(parts) < 3:
        return None
    filename = parts[-1]
    ext = os.path.splitext(filename)[1].lower()
    if ext not in AUDIO_EXTS:
        return None

    # Match "01 - Title.ext" or "01-02 - Title.ext" (disc-track)
    m = re.match(r"^(\d{2})(?:-(\d{2}))? - (.+)\.[^.]+$", filename)
    if not m:
        return None

    return {
        "path": path,
        "ext": ext,
        "track_number": int(m.group(2) or m.group(1)),
        "disc_number": int(m.group(1)) if m.group(2) else 1,
        "title_guess": m.group(3),
    }


class _MusicEventHandler(FileSystemEventHandler):
    def __init__(self, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue):
        self._loop = loop
        self._queue = queue

    def _enqueue(self, event_type: str, path: str):
        info = _extract_track_info(path)
        if info:
            asyncio.run_coroutine_threadsafe(
                self._queue.put({"event": event_type, **info}), self._loop
            )

    def on_created(self, event: FileSystemEvent):
        if not event.is_directory:
            self._enqueue("created", event.src_path)

    def on_deleted(self, event: FileSystemEvent):
        if not event.is_directory:
            self._enqueue("deleted", event.src_path)

    def on_moved(self, event: FileSystemEvent):
        if not event.is_directory:
            self._enqueue("deleted", event.src_path)
            self._enqueue("created", event.dest_path)


async def _process_events(queue: asyncio.Queue, db_session_factory) -> None:
    """Drain the event queue and update Track.file_path in the DB."""
    from sqlalchemy import select

    from app.models import Track

    while True:
        event = await queue.get()
        try:
            async with db_session_factory() as db:
                if event["event"] == "created":
                    # Try to match by title guess
                    result = await db.execute(
                        select(Track).where(
                            Track.title.ilike(f"%{event['title_guess']}%"),
                            Track.track_number == event["track_number"],
                            Track.disc_number == event["disc_number"],
                        )
                    )
                    track = result.scalar_one_or_none()
                    if track:
                        track.file_path = event["path"]
                        await db.commit()

                elif event["event"] == "deleted":
                    result = await db.execute(
                        select(Track).where(Track.file_path == event["path"])
                    )
                    track = result.scalar_one_or_none()
                    if track:
                        track.file_path = None
                        await db.commit()
        except Exception:
            pass  # Don't let watcher errors crash the app


def start_library_watcher(
    library_path: str,
    loop: asyncio.AbstractEventLoop,
    db_session_factory,
) -> None:
    global _observer
    if _observer is not None:
        return

    queue: asyncio.Queue = asyncio.Queue()
    asyncio.run_coroutine_threadsafe(
        _process_events(queue, db_session_factory), loop
    )

    handler = _MusicEventHandler(loop, queue)
    _observer = Observer()
    _observer.schedule(handler, library_path, recursive=True)
    _observer.start()


def stop_library_watcher() -> None:
    global _observer
    if _observer:
        _observer.stop()
        _observer.join()
        _observer = None
