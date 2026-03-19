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


async def link_album_folders(artist_path: str, release_groups: list, db) -> None:
    """
    Fuzzy-match each release group against subfolders of artist_path and
    persist ReleaseGroup.folder_path.  Same logic as get_artist_disk_status
    so availability is populated at import time rather than on first page load.
    """
    import re
    from difflib import SequenceMatcher

    THRESHOLD = 0.65

    def _norm(s: str) -> str:
        s = s.lower()
        s = re.sub(r"\s*[\(\[]\d{4}[\)\]]\s*", " ", s)
        s = re.sub(r"\b(disc|disk|vol|volume)\s*\d*\b", "", s, flags=re.IGNORECASE)
        s = re.sub(r"[^\w\s]", " ", s)
        s = re.sub(r"\bthe\b", "", s)
        return " ".join(s.split())

    def _score(folder_name: str, rg_title: str) -> float:
        a, b = _norm(folder_name), _norm(rg_title)
        return SequenceMatcher(None, a, b).ratio() if a and b else 0.0

    if not os.path.isdir(artist_path):
        return

    try:
        disk_folders = [
            {"name": e.name, "path": e.path}
            for e in sorted(os.scandir(artist_path), key=lambda e: e.name)
            if e.is_dir()
        ]
    except OSError:
        return

    if not disk_folders:
        return

    used: set[str] = set()
    changed = False
    for rg in release_groups:
        best, best_score = None, 0.0
        for folder in disk_folders:
            if folder["path"] in used:
                continue
            s = _score(folder["name"], rg.title)
            if s > best_score:
                best_score = s
                best = folder
        if best and best_score >= THRESHOLD:
            used.add(best["path"])
            try:
                file_count = sum(1 for f in os.scandir(best["path"]) if not f.is_dir())
            except OSError:
                file_count = 0
            if rg.folder_path != best["path"] or rg.file_count != file_count:
                rg.folder_path = best["path"]
                rg.file_count = file_count
                changed = True

    if changed:
        await db.commit()


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
