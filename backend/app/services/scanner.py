"""
Scans the music library directory to discover existing artists/albums,
and links found audio files to Track records in the database.
"""

import asyncio
import os
import re
from collections.abc import AsyncGenerator
from difflib import SequenceMatcher

from app.services.library_watcher import _extract_track_info


def _normalize_folder_name(name: str) -> str:
    """
    Normalise a music library folder name before passing it to MusicBrainz.

    Handles several real-world naming conventions that confuse MB search:
    - Sort-name format  "Artist, The" → "The Artist"  (also A / An)
    - Trailing underscore used as punctuation substitute  "Bare Jr_" → "Bare Jr"
    - Internal underscores as character substitutes  "AC_DC" → "AC DC"
    - Common format tags  "[FLAC]"  "(V0)"  "[320kbps]"  → stripped
    """
    # Strip bracketed format tags, e.g. "[FLAC]", "(V0)", "[320kbps]"
    name = re.sub(r"[\[\(][^\]\)]{1,20}[\]\)]", "", name).strip()

    # Replace all underscores with spaces (covers "Bare Jr_" and "AC_DC")
    name = name.replace("_", " ").strip()

    # Flip sort-name format: "Artist, The" → "The Artist"
    name = re.sub(r"^(.+),\s+(The|A|An)$", r"\2 \1", name, flags=re.IGNORECASE)

    # Collapse any double spaces introduced above
    name = re.sub(r"\s+", " ", name).strip()

    return name


def _strip_article(s: str) -> str:
    """Strip a leading 'the', 'a', or 'an' (case-insensitive) from a string."""
    return re.sub(r"^(the|a|an)\s+", "", s, flags=re.IGNORECASE).strip()


def _rescore_candidates(query: str, candidates: list[dict]) -> list[dict]:
    """
    Re-score MusicBrainz candidates by blending the MB relevance score with
    a local name-similarity score.

    MB search alone can return "Rufus Beck" ahead of "Beck" when the query is
    "Beck" (MB scores partial matches generously).  Adding local similarity
    heavily penalises candidates whose name is significantly longer/different
    from the query, so exact matches win.

    When the query starts with a leading article ("The", "A", "An"), we also
    compare article-stripped forms so that e.g. "The Watchmen" vs "The Beatles"
    is measured as "Watchmen" vs "Beatles" (≈0.13) rather than comparing the
    full strings (which share "The " and inflate the score).

    Combined score formula:  MB_score × 0.4 + name_similarity × 100 × 0.6
    Both components are in the 0-100 range; the result is clamped to 100.
    """
    q = query.lower()
    q_core = _strip_article(q)
    use_core = q_core != q  # query starts with an article

    rescored = []
    for c in candidates:
        name = c["name"].lower()
        sort_name = (c.get("sort_name") or c["name"]).lower()
        if use_core:
            name_sim = max(
                SequenceMatcher(None, q_core, _strip_article(name)).ratio(),
                SequenceMatcher(None, q_core, _strip_article(sort_name)).ratio(),
            )
        else:
            name_sim = max(
                SequenceMatcher(None, q, name).ratio(),
                SequenceMatcher(None, q, sort_name).ratio(),
            )
        combined = round(min(100, c["score"] * 0.4 + name_sim * 100 * 0.6))
        rescored.append({**c, "score": combined})
    rescored.sort(key=lambda x: x["score"], reverse=True)
    return rescored


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

        query = _normalize_folder_name(entry.name)
        try:
            candidates = await mb.search_artists(query, limit=5)
            candidates = _rescore_candidates(query, candidates)
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


def _title_norm(s: str) -> str:
    """Normalise a track title for fuzzy comparison."""
    s = s.lower()
    s = re.sub(r"[^\w\s]", " ", s)  # collapse punctuation to spaces
    s = re.sub(r"\bthe\b", "", s)   # strip article "the"
    return re.sub(r"\s+", " ", s).strip()


def _titles_match(db_title: str, file_title: str) -> bool:
    """Return True when titles are equivalent after normalisation."""
    a, b = _title_norm(db_title), _title_norm(file_title)
    if not a or not b:
        return False
    return a == b or (len(a) > 3 and a in b) or (len(b) > 3 and b in a)


async def link_existing_files(library_path: str, db) -> int:
    """
    Walk library_path, find audio files, and match them to existing Track records
    that don't yet have a file_path set.  Uses a three-tier matching strategy:

      1. Exact MusicBrainz recording MBID from embedded tags → Track.mbid
      2. Tag-derived title + track number with normalised comparison
      3. Filename-derived title + track number (original behaviour, fallback)

    Returns the count of newly linked tracks.
    """
    from sqlalchemy import select

    from app.models import Artist, ReleaseGroup, Track
    from app.services.library_watcher import AUDIO_EXTS
    from app.services.tag_reader import read_tags

    if not os.path.isdir(library_path):
        return 0

    # Scope all queries to the artist whose folder this is.
    artist_folder = os.path.basename(library_path)

    count = 0
    for root, _, files in os.walk(library_path):
        for filename in files:
            path = os.path.join(root, filename)
            if os.path.splitext(filename)[1].lower() not in AUDIO_EXTS:
                continue

            tags = read_tags(path)

            # ── Tier 1: exact MBID match ──────────────────────────────────────
            if tags and tags.recording_mbid:
                result = await db.execute(
                    select(Track)
                    .join(ReleaseGroup, Track.release_group_id == ReleaseGroup.id)
                    .join(Artist, ReleaseGroup.artist_id == Artist.id)
                    .where(
                        Artist.folder_name == artist_folder,
                        Track.mbid == tags.recording_mbid,
                        Track.file_path.is_(None),
                    )
                    .limit(1)
                )
                track = result.scalar_one_or_none()
                if track:
                    track.file_path = path
                    count += 1
                    continue

            # ── Tiers 2 & 3: title + track-number matching ───────────────────
            # Prefer tag-derived values; fall back to filename parsing.
            info = _extract_track_info(path)
            tag_title = tags.title if tags else None

            track_num: int | None = None
            disc_num: int = 1

            # Tag track number (e.g. "10/13" → 10)
            if tags and tags.track_number:
                try:
                    track_num = int(str(tags.track_number).split("/")[0])
                except (ValueError, AttributeError):
                    pass

            # Filename fallback
            if track_num is None and info:
                track_num = info["track_number"]
                disc_num = info["disc_number"]

            if track_num is None:
                continue

            # Build ordered list of title candidates (tag first, then filename)
            title_sources: list[str] = []
            if tag_title:
                title_sources.append(tag_title)
            if info and info["title_guess"] and info["title_guess"] != tag_title:
                title_sources.append(info["title_guess"])

            if not title_sources:
                continue

            # Fetch all unlinked tracks for this artist at this position
            result = await db.execute(
                select(Track)
                .join(ReleaseGroup, Track.release_group_id == ReleaseGroup.id)
                .join(Artist, ReleaseGroup.artist_id == Artist.id)
                .where(
                    Artist.folder_name == artist_folder,
                    Track.track_number == track_num,
                    Track.disc_number == disc_num,
                    Track.file_path.is_(None),
                )
            )
            candidates = result.scalars().all()
            if not candidates:
                continue

            for title in title_sources:
                matched = next(
                    (c for c in candidates if _titles_match(c.title, title)),
                    None,
                )
                if matched:
                    matched.file_path = path
                    count += 1
                    break

    if count:
        await db.commit()

    return count
