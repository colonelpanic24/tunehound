"""
Scans the music library directory to discover existing artists/albums,
and links found audio files to Track records in the database.
"""

import asyncio
import os
from collections.abc import AsyncGenerator

from app.services.library_watcher import _extract_track_info


async def scan_music_directory_stream(
    library_path: str, known_names: set[str] | None = None
) -> AsyncGenerator[dict, None]:
    """
    Async generator yielding progress events as we scan folders and search MusicBrainz.
    Folders whose name (case-insensitive) matches known_names are skipped.

    Yields:
      {"type": "start", "total": N, "skipped_known": K}
      {"type": "result", "folder": ..., "album_count": ..., "candidates": [...],
                         "done": N, "total": N, "eta_seconds": X}
      {"type": "done"}
    """
    from app.services import musicbrainz as mb

    if not os.path.isdir(library_path):
        yield {"type": "start", "total": 0, "skipped_known": 0}
        yield {"type": "done"}
        return

    try:
        all_dirs = sorted(
            (e for e in os.scandir(library_path) if e.is_dir()),
            key=lambda e: e.name,
        )
    except PermissionError:
        yield {"type": "start", "total": 0, "skipped_known": 0}
        yield {"type": "done"}
        return

    known_lower = {n.lower() for n in known_names} if known_names else set()
    new_folders = [e for e in all_dirs if e.name.lower() not in known_lower]
    total = len(new_folders)
    skipped_known = len(all_dirs) - total

    yield {"type": "start", "total": total, "skipped_known": skipped_known}

    for i, entry in enumerate(new_folders):
        album_count = sum(1 for sub in os.scandir(entry.path) if sub.is_dir())

        try:
            candidates = await mb.search_artists(entry.name, limit=5)
        except Exception:
            candidates = []

        done = i + 1
        remaining = total - done
        yield {
            "type": "result",
            "folder": entry.name,
            "album_count": album_count,
            "candidates": candidates[:5],
            "done": done,
            "total": total,
            "eta_seconds": round(remaining * 1.1, 1),
        }

        if remaining > 0:
            await asyncio.sleep(1.1)

    yield {"type": "done"}


async def link_existing_files(library_path: str, db) -> int:
    """
    Walk library_path, find audio files, and match them to existing Track records
    that don't yet have a file_path set. Returns the count of newly linked tracks.
    """
    from sqlalchemy import select

    from app.models import Artist, ReleaseGroup, Track

    if not os.path.isdir(library_path):
        return 0

    # Scope matches to the artist whose folder this is, so that tracks from
    # other artists with the same title/number don't cause ambiguity errors.
    artist_folder = os.path.basename(library_path)

    count = 0
    for root, _, files in os.walk(library_path):
        for filename in files:
            path = os.path.join(root, filename)
            info = _extract_track_info(path)
            if not info:
                continue

            result = await db.execute(
                select(Track)
                .join(ReleaseGroup, Track.release_group_id == ReleaseGroup.id)
                .join(Artist, ReleaseGroup.artist_id == Artist.id)
                .where(
                    Artist.folder_name == artist_folder,
                    Track.title.ilike(f"%{info['title_guess']}%"),
                    Track.track_number == info["track_number"],
                    Track.disc_number == info["disc_number"],
                    Track.file_path.is_(None),
                )
                .limit(1)
            )
            track = result.scalar_one_or_none()
            if track:
                track.file_path = path
                count += 1

    if count:
        await db.commit()

    return count
