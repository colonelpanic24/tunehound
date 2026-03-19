"""
Backend-driven library scan job manager.

A single ScanJobManager instance runs the entire scan + import pipeline as an
asyncio background task.  The frontend connects via WebSocket to receive live
progress updates, and can also GET /api/library/scan-job to hydrate state on
page load / reconnect.
"""

import asyncio
import os
import time
from collections.abc import Callable, Coroutine
from dataclasses import asdict, dataclass, field
from typing import Any

Broadcast = Callable[[dict], Coroutine[Any, Any, None]]


# ── State dataclasses ──────────────────────────────────────────────────────────


@dataclass
class ScanLogEntry:
    type: str  # "imported" | "skipped" | "error" | "needs_review"
    label: str
    album_count: int | None = None

    def to_dict(self) -> dict:
        d: dict = {"type": self.type, "label": self.label}
        if self.album_count is not None:
            d["album_count"] = self.album_count
        return d


@dataclass
class NeedsReviewItem:
    folder: str
    candidates: list[dict]

    def to_dict(self) -> dict:
        return {"folder": self.folder, "candidates": self.candidates}


@dataclass
class ScanSummary:
    artists_imported: int
    albums_imported: int
    files_linked: int
    needs_review_count: int
    elapsed_seconds: int

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ScanJobState:
    phase: str = "idle"  # "idle" | "scanning" | "done"
    scan_done: int = 0
    scan_total: int = 0
    import_done: int = 0
    import_total: int = 0
    current_step: str | None = None
    log: list[ScanLogEntry] = field(default_factory=list)
    summary: ScanSummary | None = None
    error: str | None = None
    needs_review: list[NeedsReviewItem] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "phase": self.phase,
            "scan_done": self.scan_done,
            "scan_total": self.scan_total,
            "import_done": self.import_done,
            "import_total": self.import_total,
            "current_step": self.current_step,
            "log": [e.to_dict() for e in self.log],
            "summary": self.summary.to_dict() if self.summary else None,
            "error": self.error,
            "needs_review": [i.to_dict() for i in self.needs_review],
        }


# ── Manager ────────────────────────────────────────────────────────────────────


class ScanJobManager:
    def __init__(self) -> None:
        self._state = ScanJobState()
        self._task: asyncio.Task | None = None
        self._abort = asyncio.Event()
        self._broadcast: Broadcast | None = None
        self._db_factory: Any = None

    def configure(self, broadcast: Broadcast, db_factory: Any) -> None:
        self._broadcast = broadcast
        self._db_factory = db_factory

    def get_state(self) -> dict:
        return self._state.to_dict()

    def is_running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self) -> None:
        if self.is_running():
            return
        self._abort.clear()
        self._state = ScanJobState(phase="scanning")
        self._task = asyncio.create_task(self._run())

    async def cancel(self) -> None:
        self._abort.set()
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
        self._state.phase = "idle"
        self._state.current_step = None

    def remove_review_item(self, folder: str) -> None:
        self._state.needs_review = [
            i for i in self._state.needs_review if i.folder != folder
        ]

    async def _emit(self, msg: dict) -> None:
        if self._broadcast:
            try:
                await self._broadcast(msg)
            except Exception:
                pass

    def _progress_snapshot(self) -> dict:
        s = self._state
        return {
            "scan_done": s.scan_done,
            "scan_total": s.scan_total,
            "import_done": s.import_done,
            "import_total": s.import_total,
            "current_step": s.current_step,
        }

    # ── Main pipeline ──────────────────────────────────────────────────────────

    async def _run(self) -> None:  # noqa: PLR0912, PLR0915
        import shutil

        from sqlalchemy import select

        from app.config import settings
        from app.models import Artist, DownloadSettings, ReleaseGroup, Track
        from app.schemas import ArtistOut
        from app.services import artwork as artwork_svc
        from app.services import musicbrainz as mb
        from app.services import scanner
        from app.services.coverart import get_cover_art_url
        from app.services.image_cache import cache_image
        from app.services.tag_reader import read_tags
        from app.services.tagger import compute_art_hash_from_cover_file

        abort = self._abort
        state = self._state
        start_time = time.monotonic()
        albums_imported = 0
        files_linked = 0
        needs_review_count = 0
        threshold = 80

        # Fetch confidence threshold
        try:
            async with self._db_factory() as db:
                result = await db.execute(
                    select(DownloadSettings).where(DownloadSettings.id == 1)
                )
                dl_settings = result.scalar_one_or_none()
                if dl_settings:
                    threshold = dl_settings.scan_min_confidence
        except Exception:
            pass

        # ── Concurrent import queue ────────────────────────────────────────────

        queue: list[dict] = []
        processor_active = False

        async def import_one(item: dict) -> None:
            nonlocal albums_imported, files_linked
            mbid = item["mbid"]
            folder_name = item["folder"]

            try:
                async with self._db_factory() as db:
                    # Language filter
                    lang_result = await db.execute(
                        select(DownloadSettings).where(DownloadSettings.id == 1)
                    )
                    dl_settings = lang_result.scalar_one_or_none()
                    _lang_codes = [
                        c.strip()
                        for c in (
                            dl_settings.album_languages if dl_settings else "eng"
                        ).split(",")
                        if c.strip()
                    ]
                    _lang_filter = _lang_codes or None

                    # Skip already-imported artists
                    existing = await db.execute(
                        select(Artist).where(Artist.mbid == mbid)
                    )
                    existing_artist = existing.scalar_one_or_none()
                    if existing_artist:
                        if not existing_artist.folder_name and folder_name:
                            existing_artist.folder_name = folder_name
                            await db.commit()
                        state.import_done += 1
                        log_entry = ScanLogEntry(type="skipped", label=mbid)
                        state.log.append(log_entry)
                        await self._emit(
                            {"type": "scan_progress", **self._progress_snapshot()}
                        )
                        await self._emit(
                            {"type": "scan_log", "entry": log_entry.to_dict()}
                        )
                        return

                    # ── artist_info ────────────────────────────────────────────
                    state.current_step = (
                        f"{folder_name or mbid} — fetching artist info"
                    )
                    await self._emit(
                        {"type": "scan_progress", **self._progress_snapshot()}
                    )

                    mb_artist = await mb.get_artist(mbid)
                    artist_name = mb_artist.get("name", folder_name or mbid)

                    if abort.is_set():
                        return

                    # Artist image
                    image_url = None
                    if folder_name:
                        artist_path_check = os.path.join(
                            settings.music_library_path, folder_name
                        )
                        local_img = artwork_svc.find_local_artist_image(
                            artist_path_check
                        )
                        if local_img:
                            ext = (
                                os.path.splitext(local_img)[1].lstrip(".") or "jpg"
                            )
                            dest_dir = os.path.join(
                                settings.data_dir, "images", "artists"
                            )
                            os.makedirs(dest_dir, exist_ok=True)
                            dest = os.path.join(dest_dir, f"{mbid}.{ext}")
                            try:
                                shutil.copy2(local_img, dest)
                                image_url = f"/images/artists/{mbid}.{ext}"
                            except Exception:
                                pass
                    if image_url is None:
                        remote_image_url = await mb.get_artist_image_url(mb_artist)
                        if remote_image_url:
                            image_url = await cache_image(
                                "artists", mbid, remote_image_url
                            )

                    wikidata_id = None
                    for rel in mb_artist.get("url-relation-list", []):
                        if "wikidata.org/wiki/Q" in rel.get("target", ""):
                            wikidata_id = rel["target"].split("/")[-1]
                            break

                    artist = Artist(
                        mbid=mbid,
                        name=artist_name,
                        sort_name=mb_artist.get("sort-name"),
                        disambiguation=mb_artist.get("disambiguation"),
                        image_url=image_url,
                        wikidata_id=wikidata_id,
                        folder_name=folder_name,
                    )
                    db.add(artist)
                    await db.flush()

                    # ── albums ────────────────────────────────────────────────
                    state.current_step = f"{artist_name} — fetching albums"
                    await self._emit(
                        {"type": "scan_progress", **self._progress_snapshot()}
                    )

                    _EXCLUDED_SECONDARY = {
                        "Live", "Compilation", "Remix", "DJ-mix",
                        "Mixtape/Street", "Demo", "Interview", "Spokenword",
                        "Audiobook", "Audio drama",
                    }
                    mb_groups = await mb.get_release_groups(
                        mbid, languages=_lang_filter
                    )
                    mb_groups = [
                        g
                        for g in mb_groups
                        if not any(
                            t in _EXCLUDED_SECONDARY
                            for t in g.get("secondary-type-list", [])
                        )
                    ]
                    release_groups = []
                    for mg in mb_groups:
                        secondary = mg.get("secondary-type-list", [])
                        rg = ReleaseGroup(
                            mbid=mg["id"],
                            artist_id=artist.id,
                            title=mg["title"],
                            primary_type=mg.get("primary-type"),
                            secondary_types=(
                                ",".join(secondary) if secondary else None
                            ),
                            first_release_date=mg.get("first-release-date"),
                        )
                        db.add(rg)
                        release_groups.append(rg)

                    await db.commit()

                    # ── cover art ─────────────────────────────────────────────
                    album_count = len(release_groups)
                    state.current_step = f"{artist_name} — fetching cover art"
                    await self._emit(
                        {"type": "scan_progress", **self._progress_snapshot()}
                    )

                    async def _fetch_cover(rg: ReleaseGroup) -> None:
                        try:
                            if folder_name:
                                _artist_path = os.path.join(
                                    settings.music_library_path, folder_name
                                )
                                if os.path.isdir(_artist_path):
                                    for entry in os.scandir(_artist_path):
                                        if entry.is_dir():
                                            local_cover = (
                                                artwork_svc.find_local_folder_image(
                                                    entry.path
                                                )
                                            )
                                            if local_cover:
                                                from difflib import SequenceMatcher

                                                score = SequenceMatcher(
                                                    None,
                                                    entry.name.lower(),
                                                    rg.title.lower(),
                                                ).ratio()
                                                if score >= 0.6:
                                                    ext = (
                                                        os.path.splitext(local_cover)[
                                                            1
                                                        ].lstrip(".")
                                                        or "jpg"
                                                    )
                                                    dest_dir = os.path.join(
                                                        settings.data_dir,
                                                        "images",
                                                        "covers",
                                                    )
                                                    os.makedirs(
                                                        dest_dir, exist_ok=True
                                                    )
                                                    dest = os.path.join(
                                                        dest_dir,
                                                        f"{rg.mbid}.{ext}",
                                                    )
                                                    try:
                                                        shutil.copy2(
                                                            local_cover, dest
                                                        )
                                                        rg.cover_art_url = f"/images/covers/{rg.mbid}.{ext}"
                                                        rg.cover_art_hash = compute_art_hash_from_cover_file(
                                                            rg.cover_art_url
                                                        )
                                                    except Exception:
                                                        pass
                                                    return
                            remote_url = await get_cover_art_url(rg.mbid)
                            if remote_url:
                                rg.cover_art_url = await cache_image(
                                    "covers", rg.mbid, remote_url
                                )
                                if rg.cover_art_url:
                                    rg.cover_art_hash = (
                                        compute_art_hash_from_cover_file(
                                            rg.cover_art_url
                                        )
                                    )
                        except Exception:
                            pass

                    await asyncio.gather(*[_fetch_cover(rg) for rg in release_groups])
                    await db.commit()

                    # ── tracks ────────────────────────────────────────────────
                    state.current_step = f"{artist_name} — fetching tracks"
                    await self._emit(
                        {"type": "scan_progress", **self._progress_snapshot()}
                    )

                    for rg in release_groups:
                        if rg.tracks_fetched:
                            continue
                        try:
                            mb_tracks = await mb.get_tracks_for_release_group(
                                rg.mbid
                            )
                            for t in mb_tracks:
                                db.add(
                                    Track(
                                        mbid=t["mbid"],
                                        release_group_id=rg.id,
                                        title=t["title"],
                                        track_number=t["track_number"],
                                        disc_number=t["disc_number"],
                                        duration_ms=t.get("duration_ms"),
                                    )
                                )
                            rg.tracks_fetched = True
                        except Exception:
                            pass
                    await db.commit()

                    # ── link files ────────────────────────────────────────────
                    if folder_name:
                        artist_path = os.path.join(
                            settings.music_library_path, folder_name
                        )
                        linked = await scanner.link_existing_files(artist_path, db)
                        files_linked += linked
                        await _scan_tags_for_artist(artist_path, db, read_tags)

                    await db.refresh(artist)
                    artist_out = ArtistOut.model_validate(artist)
                    albums_imported += album_count
                    state.import_done += 1
                    state.current_step = None
                    log_entry = ScanLogEntry(
                        type="imported",
                        label=artist_name,
                        album_count=album_count,
                    )
                    state.log.append(log_entry)
                    await self._emit(
                        {"type": "scan_progress", **self._progress_snapshot()}
                    )
                    await self._emit(
                        {"type": "scan_log", "entry": log_entry.to_dict()}
                    )
                    # Live UI update
                    await self._emit(
                        {
                            "type": "artist_ready",
                            "payload": artist_out.model_dump(mode="json"),
                        }
                    )

            except asyncio.CancelledError:
                raise
            except Exception as exc:
                state.import_done += 1
                state.current_step = None
                log_entry = ScanLogEntry(type="error", label=f"{mbid}: {exc}")
                state.log.append(log_entry)
                await self._emit(
                    {"type": "scan_progress", **self._progress_snapshot()}
                )
                await self._emit(
                    {"type": "scan_log", "entry": log_entry.to_dict()}
                )

        async def process_queue() -> None:
            nonlocal processor_active
            if processor_active:
                return
            processor_active = True
            while queue:
                if abort.is_set():
                    break
                item = queue.pop(0)
                await import_one(item)
                # MusicBrainz rate limit between artists
                if queue:
                    await asyncio.sleep(1.1)
            processor_active = False

        # ── Scan ──────────────────────────────────────────────────────────────

        try:
            async with self._db_factory() as db:
                result = await db.execute(select(Artist.name))
                known_names = {row[0] for row in result.all()}

            async for event in scanner.scan_music_directory_stream(
                settings.music_library_path, known_names
            ):
                if abort.is_set():
                    return

                etype = event.get("type")
                if etype == "start":
                    state.scan_total = event["total"]
                    await self._emit(
                        {"type": "scan_started", "total": event["total"]}
                    )
                elif etype == "result":
                    folder = event["folder"]
                    cands = event.get("candidates", [])
                    state.scan_done = event["done"]
                    if cands and cands[0]["score"] >= threshold:
                        queue.append({"mbid": cands[0]["mbid"], "folder": folder})
                        state.import_total += 1
                        await self._emit(
                            {"type": "scan_progress", **self._progress_snapshot()}
                        )
                        asyncio.create_task(process_queue())
                    elif cands:
                        needs_review_count += 1
                        nr_item = NeedsReviewItem(
                            folder=folder, candidates=cands
                        )
                        state.needs_review.append(nr_item)
                        log_entry = ScanLogEntry(
                            type="needs_review", label=folder
                        )
                        state.log.append(log_entry)
                        await self._emit(
                            {"type": "scan_progress", **self._progress_snapshot()}
                        )
                        await self._emit(
                            {"type": "scan_log", "entry": log_entry.to_dict()}
                        )
                    else:
                        await self._emit(
                            {"type": "scan_progress", **self._progress_snapshot()}
                        )

            # Drain remaining imports after scan completes
            while queue or processor_active:
                if abort.is_set():
                    return
                await asyncio.sleep(0.2)

            elapsed_seconds = round(time.monotonic() - start_time)
            summary = ScanSummary(
                artists_imported=state.import_done,
                albums_imported=albums_imported,
                files_linked=files_linked,
                needs_review_count=needs_review_count,
                elapsed_seconds=elapsed_seconds,
            )
            state.summary = summary
            state.phase = "done"
            state.current_step = None
            await self._emit({"type": "scan_done", "summary": summary.to_dict()})

        except asyncio.CancelledError:
            state.phase = "idle"
            state.current_step = None
        except Exception as exc:
            state.phase = "idle"
            state.error = str(exc)
            await self._emit({"type": "scan_error", "error": str(exc)})


# ── Helpers ────────────────────────────────────────────────────────────────────


async def _scan_tags_for_artist(artist_path: str, db: Any, read_tags_fn: Any) -> None:
    import os

    from sqlalchemy import select

    from app.models import Track

    try:
        result = await db.execute(select(Track).where(Track.file_path.isnot(None)))
        tracks = result.scalars().all()
        updated = 0
        for track in tracks:
            if not track.file_path or not track.file_path.startswith(artist_path):
                continue
            if not os.path.isfile(track.file_path):
                continue
            snap = read_tags_fn(track.file_path)
            if snap:
                track.tag_title = snap.title
                track.tag_artist = snap.artist
                track.tag_album = snap.album
                track.tag_track_number = snap.track_number
                track.tag_art_hash = snap.art_hash
                track.tags_scanned_at = snap.scanned_at
                updated += 1
        if updated:
            await db.commit()
    except Exception:
        pass


# ── Singleton ──────────────────────────────────────────────────────────────────

scan_job_manager = ScanJobManager()
