"""
Seed a demo TuneHound database with fictional data for README screenshots.

Creates a completely separate data directory so it never touches your real library.
All artist names, album names, and artwork are fictional or public-domain.

Usage (from repo root):
    backend/.venv/bin/python3 scripts/seed_screenshots.py

The demo DB lives at ~/.local/share/tunehound-demo/ by default.
Override with DEMO_DATA_DIR env var.

After seeding, start a demo backend with:
    DEMO_DATA_DIR=~/.local/share/tunehound-demo scripts/start_demo_backend.sh
Then run the capture script in another terminal:
    backend/.venv/bin/python3 scripts/capture_screenshots.py
"""

import asyncio
import json
import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

DEMO_DATA_DIR = Path(
    os.environ.get("DEMO_DATA_DIR", Path.home() / ".local/share/tunehound-demo")
).expanduser()
DEMO_DATA_DIR.mkdir(parents=True, exist_ok=True)

os.environ["DATA_DIR"] = str(DEMO_DATA_DIR)
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{DEMO_DATA_DIR}/tunehound.db"
os.environ.setdefault("MUSIC_LIBRARY_PATH", "/music")

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine  # noqa: E402

from app.database import Base  # noqa: E402
from app.models import (  # noqa: E402
    Artist,
    DownloadJob,
    DownloadSettings,
    ReleaseGroup,
    Track,
)

# ── Fictional seed data ────────────────────────────────────────────────────────
# All artists, albums, and track names are fictional.
# Artwork uses picsum.photos — public-domain placeholder images seeded by a fixed
# integer so the same image always appears for the same artist/album.

def picsum(seed: int, size: int = 500) -> str:
    return f"https://picsum.photos/seed/{seed}/{size}/{size}"


ARTISTS = [
    {
        "mbid": "11111111-0000-0000-0000-000000000001",
        "name": "Pale Harbor",
        "sort_name": "Pale Harbor",
        "image_url": picsum(101),
        "bio": (
            "Pale Harbor is an ambient electronic duo from the Pacific Northwest, "
            "formed in 2009. Known for their layered synthesizers and field recordings, "
            "they have released four studio albums exploring themes of coastlines, fog, "
            "and maritime solitude. Their sound draws on minimalist composition and "
            "shoegaze textures."
        ),
        "folder_name": "Pale Harbor",
        "albums": [
            {
                "mbid": "aaaaaaaa-0000-0000-0000-000000000001",
                "title": "Tidal Architecture",
                "primary_type": "Album",
                "first_release_date": "2013-03-12",
                "cover_art_url": picsum(201),
                "file_count": 9,
                "on_disk": True,
                "tracks": [
                    ("Breakwater", 1, 312000),
                    ("The Estuary", 2, 284000),
                    ("Low Pressure System", 3, 347000),
                    ("Saltmarsh", 4, 261000),
                    ("Harbour Lights", 5, 298000),
                    ("Littoral", 6, 334000),
                    ("The Intertidal Zone", 7, 420000),
                    ("Drift", 8, 189000),
                    ("Open Water", 9, 511000),
                ],
            },
            {
                "mbid": "aaaaaaaa-0000-0000-0000-000000000002",
                "title": "Grey Season",
                "primary_type": "Album",
                "first_release_date": "2016-10-07",
                "cover_art_url": picsum(202),
                "file_count": 8,
                "on_disk": True,
                "tracks": [
                    ("November Light", 1, 278000),
                    ("Fog Advisory", 2, 365000),
                    ("Cold Front", 3, 312000),
                    ("Inversions", 4, 244000),
                    ("Precipitation", 5, 398000),
                    ("The Overcast", 6, 271000),
                    ("Solstice", 7, 336000),
                    ("First Thaw", 8, 445000),
                ],
            },
            {
                "mbid": "aaaaaaaa-0000-0000-0000-000000000003",
                "title": "Pelagic",
                "primary_type": "Album",
                "first_release_date": "2020-06-15",
                "cover_art_url": picsum(203),
                "file_count": 10,
                "on_disk": False,
                "tracks": [
                    ("Mesopelagic", 1, 389000),
                    ("Bathyal", 2, 412000),
                    ("Abyssal Plain", 3, 356000),
                    ("Hadal", 4, 478000),
                    ("Upwelling", 5, 267000),
                    ("Bioluminescence", 6, 344000),
                    ("The Thermocline", 7, 301000),
                    ("Deep Current", 8, 433000),
                    ("Pressure Ridge", 9, 289000),
                    ("Surface Tension", 10, 521000),
                ],
            },
        ],
    },
    {
        "mbid": "22222222-0000-0000-0000-000000000002",
        "name": "The Midnight Static",
        "sort_name": "Midnight Static, The",
        "image_url": picsum(102),
        "bio": (
            "The Midnight Static is an indie rock band formed in 2007 in a small "
            "Midwestern college town. Their music blends driving guitar work with "
            "melancholic lyrics about displacement and late nights. The band has toured "
            "extensively across North America and released five albums independently "
            "before signing to a small label for their fourth record."
        ),
        "folder_name": "The Midnight Static",
        "albums": [
            {
                "mbid": "bbbbbbbb-0000-0000-0000-000000000001",
                "title": "Signal Loss",
                "primary_type": "Album",
                "first_release_date": "2009-09-22",
                "cover_art_url": picsum(211),
                "file_count": 11,
                "on_disk": True,
                "tracks": [
                    ("Carrier Wave", 1, 243000),
                    ("Dead Air", 2, 312000),
                    ("The Repeater", 3, 278000),
                    ("Interference", 4, 354000),
                    ("Off-Channel", 5, 198000),
                    ("Noise Floor", 6, 411000),
                    ("White Noise Suite", 7, 267000),
                    ("Standby", 8, 189000),
                    ("Lost Frequency", 9, 322000),
                    ("Residual", 10, 344000),
                    ("Final Transmission", 11, 488000),
                ],
            },
            {
                "mbid": "bbbbbbbb-0000-0000-0000-000000000002",
                "title": "Halflife",
                "primary_type": "Album",
                "first_release_date": "2012-04-03",
                "cover_art_url": picsum(212),
                "file_count": 10,
                "on_disk": True,
                "tracks": [
                    ("Decay Rate", 1, 267000),
                    ("Critical Mass", 2, 344000),
                    ("Unstable Isotope", 3, 298000),
                    ("Chain Reaction", 4, 376000),
                    ("Shielding", 5, 231000),
                    ("Fission", 6, 412000),
                    ("Half-Life", 7, 289000),
                    ("Coolant", 8, 334000),
                    ("Reactor", 9, 311000),
                    ("Fallout", 10, 456000),
                ],
            },
            {
                "mbid": "bbbbbbbb-0000-0000-0000-000000000003",
                "title": "Narrowband",
                "primary_type": "Album",
                "first_release_date": "2019-02-14",
                "cover_art_url": picsum(213),
                "file_count": None,
                "on_disk": False,
                "tracks": [
                    ("Compression", 1, 256000),
                    ("Latency", 2, 312000),
                    ("Packet Loss", 3, 278000),
                    ("Handshake", 4, 334000),
                    ("Timeout", 5, 289000),
                    ("Reroute", 6, 344000),
                    ("Bandwidth", 7, 401000),
                    ("Last Mile", 8, 523000),
                ],
            },
        ],
    },
    {
        "mbid": "33333333-0000-0000-0000-000000000003",
        "name": "Ghost Circuit",
        "sort_name": "Ghost Circuit",
        "image_url": picsum(103),
        "bio": (
            "Ghost Circuit is an electronic producer and live performer based in "
            "Berlin. Combining hardware synthesizers with generative software, their "
            "music sits at the intersection of techno and ambient. Ghost Circuit has "
            "contributed to several film soundtracks and regularly performs at "
            "underground venues across Europe."
        ),
        "folder_name": "Ghost Circuit",
        "albums": [
            {
                "mbid": "cccccccc-0000-0000-0000-000000000001",
                "title": "Voltage Divider",
                "primary_type": "Album",
                "first_release_date": "2015-07-30",
                "cover_art_url": picsum(221),
                "file_count": 8,
                "on_disk": True,
                "tracks": [
                    ("Ohm's Law", 1, 445000),
                    ("Resistor Network", 2, 378000),
                    ("Capacitance", 3, 512000),
                    ("Impedance", 4, 389000),
                    ("Ground Loop", 5, 434000),
                    ("Signal Path", 6, 356000),
                    ("Open Collector", 7, 411000),
                    ("Floating Gate", 8, 623000),
                ],
            },
            {
                "mbid": "cccccccc-0000-0000-0000-000000000002",
                "title": "Dark Current",
                "primary_type": "Album",
                "first_release_date": "2018-11-09",
                "cover_art_url": picsum(222),
                "file_count": 7,
                "on_disk": False,
                "tracks": [
                    ("Leakage", 1, 456000),
                    ("Reverse Bias", 2, 389000),
                    ("Avalanche", 3, 512000),
                    ("Zener", 4, 334000),
                    ("Thermal Noise", 5, 445000),
                    ("Shot Noise", 6, 378000),
                    ("Dark Current", 7, 689000),
                ],
            },
        ],
    },
    {
        "mbid": "44444444-0000-0000-0000-000000000004",
        "name": "Silent Ledge",
        "sort_name": "Silent Ledge",
        "image_url": picsum(104),
        "bio": (
            "Silent Ledge is a post-rock instrumental quartet from Montreal, formed in "
            "2011. Their sprawling compositions build from quiet, fingerpicked passages "
            "to towering crescendos over the course of eight to twelve minutes. The band "
            "self-records and self-releases all music from their home studio."
        ),
        "folder_name": "Silent Ledge",
        "albums": [
            {
                "mbid": "dddddddd-0000-0000-0000-000000000001",
                "title": "Scarps",
                "primary_type": "Album",
                "first_release_date": "2014-05-19",
                "cover_art_url": picsum(231),
                "file_count": 6,
                "on_disk": True,
                "tracks": [
                    ("Fault Line", 1, 567000),
                    ("Talus", 2, 489000),
                    ("Escarpment", 3, 712000),
                    ("The Overhang", 4, 634000),
                    ("Scree", 5, 445000),
                    ("The Long Descent", 6, 823000),
                ],
            },
            {
                "mbid": "dddddddd-0000-0000-0000-000000000002",
                "title": "Pressure and Time",
                "primary_type": "Album",
                "first_release_date": "2017-08-28",
                "cover_art_url": picsum(232),
                "file_count": 5,
                "on_disk": False,
                "tracks": [
                    ("Lithification", 1, 612000),
                    ("Unconformity", 2, 578000),
                    ("Strata", 3, 734000),
                    ("The Deep Past", 4, 689000),
                    ("Uplift", 5, 912000),
                ],
            },
        ],
    },
    {
        "mbid": "55555555-0000-0000-0000-000000000005",
        "name": "Sunken Garden",
        "sort_name": "Sunken Garden",
        "image_url": picsum(105),
        "bio": (
            "Sunken Garden is a one-person project focused on slow, textural music "
            "combining acoustic instruments with tape loops and found sounds. Released "
            "three albums between 2018 and 2023, each recorded in a single location: "
            "a converted greenhouse, an old boathouse, and a disused railway depot."
        ),
        "folder_name": "Sunken Garden",
        "albums": [
            {
                "mbid": "eeeeeeee-0000-0000-0000-000000000001",
                "title": "Greenhouse",
                "primary_type": "Album",
                "first_release_date": "2018-04-01",
                "cover_art_url": picsum(241),
                "file_count": 7,
                "on_disk": True,
                "tracks": [
                    ("Morning Condensation", 1, 356000),
                    ("Creeper", 2, 289000),
                    ("Root System", 3, 412000),
                    ("Dormancy", 4, 378000),
                    ("Forcing House", 5, 334000),
                    ("Propagation", 6, 445000),
                    ("The Last Cutting", 7, 612000),
                ],
            },
        ],
    },
]

DOWNLOAD_JOBS = [
    {
        "artist_index": 1,   # The Midnight Static
        "album_index": 2,    # Narrowband
        "status": "completed",
        "completed_tracks": 8,
        "total_tracks": 8,
        "created_at": datetime.now(UTC) - timedelta(hours=2),
        "started_at": datetime.now(UTC) - timedelta(hours=2),
        "completed_at": datetime.now(UTC) - timedelta(hours=1, minutes=44),
    },
    {
        "artist_index": 2,   # Ghost Circuit
        "album_index": 1,    # Dark Current
        "status": "completed",
        "completed_tracks": 7,
        "total_tracks": 7,
        "created_at": datetime.now(UTC) - timedelta(minutes=40),
        "started_at": datetime.now(UTC) - timedelta(minutes=39),
        "completed_at": datetime.now(UTC) - timedelta(minutes=24),
    },
    {
        "artist_index": 3,   # Silent Ledge
        "album_index": 1,    # Pressure and Time
        "status": "failed",
        "completed_tracks": 2,
        "total_tracks": 5,
        "created_at": datetime.now(UTC) - timedelta(minutes=12),
        "started_at": datetime.now(UTC) - timedelta(minutes=11),
        "completed_at": None,
        "error_message": "yt-dlp: ERROR: No video results found for query 'Sunken Garden Lithification'.",
    },
]

SCAN_JOB_STATE = {
    "phase": "done",
    "scan_done": 18,
    "scan_total": 18,
    "import_done": 5,
    "import_total": 5,
    "current_step": None,
    "log": [
        {"type": "imported", "label": "Pale Harbor", "album_count": 3},
        {"type": "imported", "label": "The Midnight Static", "album_count": 3},
        {"type": "imported", "label": "Ghost Circuit", "album_count": 2},
        {"type": "imported", "label": "Silent Ledge", "album_count": 2},
        {"type": "imported", "label": "Sunken Garden", "album_count": 1},
        {"type": "skipped", "label": "Unknown Artist"},
        {"type": "skipped", "label": "Various Artists"},
    ],
    "needs_review": [],
    "error": None,
    "summary": {
        "artists_imported": 5,
        "albums_imported": 11,
        "files_linked": 46,
        "needs_review_count": 0,
        "elapsed_seconds": 22,
    },
    "completed_at": (datetime.now(UTC) - timedelta(hours=3)).isoformat(),
}


# ── Seeding logic ──────────────────────────────────────────────────────────────

async def seed(db: AsyncSession) -> None:
    from sqlalchemy import text

    for table in [
        "download_track_jobs", "download_jobs",
        "retag_track_jobs", "retag_jobs",
        "tracks", "release_groups", "artists",
        "download_settings",
    ]:
        await db.execute(text(f"DELETE FROM {table}"))  # noqa: S608
    await db.commit()

    db.add(DownloadSettings(id=1))
    await db.commit()

    rg_objs: list[list[ReleaseGroup]] = []

    for artist_data in ARTISTS:
        artist = Artist(
            mbid=artist_data["mbid"],
            name=artist_data["name"],
            sort_name=artist_data.get("sort_name"),
            image_url=artist_data.get("image_url"),
            bio=artist_data.get("bio"),
            folder_name=artist_data.get("folder_name"),
            subscribed=True,
        )
        db.add(artist)
        await db.flush()

        artist_rgs: list[ReleaseGroup] = []
        for album_data in artist_data["albums"]:
            on_disk = album_data.get("on_disk", False)
            rg = ReleaseGroup(
                mbid=album_data["mbid"],
                artist_id=artist.id,
                title=album_data["title"],
                primary_type=album_data.get("primary_type"),
                first_release_date=album_data.get("first_release_date"),
                cover_art_url=album_data.get("cover_art_url"),
                file_count=album_data.get("file_count"),
                folder_path=(
                    f"/music/{artist_data['folder_name']}/{album_data['title']}"
                    if on_disk else None
                ),
                tracks_fetched=True,
                watched=True,
            )
            db.add(rg)
            await db.flush()
            artist_rgs.append(rg)

            for title, number, duration in album_data["tracks"]:
                track = Track(
                    release_group_id=rg.id,
                    title=title,
                    track_number=number,
                    disc_number=1,
                    duration_ms=duration,
                    file_path=(
                        f"/music/{artist_data['folder_name']}/{album_data['title']}"
                        f"/{number:02d} {title}.mp3"
                        if on_disk else None
                    ),
                )
                db.add(track)

        rg_objs.append(artist_rgs)

    await db.flush()

    for job_data in DOWNLOAD_JOBS:
        rg = rg_objs[job_data["artist_index"]][job_data["album_index"]]
        db.add(DownloadJob(
            release_group_id=rg.id,
            status=job_data["status"],
            completed_tracks=job_data["completed_tracks"],
            total_tracks=job_data["total_tracks"],
            created_at=job_data["created_at"],
            started_at=job_data.get("started_at"),
            completed_at=job_data.get("completed_at"),
            error_message=job_data.get("error_message"),
        ))

    await db.commit()

    total_albums = sum(len(a["albums"]) for a in ARTISTS)
    print(f"Seeded {len(ARTISTS)} artists, {total_albums} albums into {DEMO_DATA_DIR}/tunehound.db")


async def main() -> None:
    engine = create_async_engine(os.environ["DATABASE_URL"], echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        await seed(session)

    await engine.dispose()

    state_path = DEMO_DATA_DIR / "scan_job_state.json"
    state_path.write_text(json.dumps(SCAN_JOB_STATE, indent=2))
    print(f"Wrote scan state to {state_path}")
    print("\nNext steps:")
    print(f"  1. Start demo backend: DEMO_DATA_DIR={DEMO_DATA_DIR} scripts/start_demo_backend.sh")
    print("  2. Capture screenshots: backend/.venv/bin/python3 scripts/capture_screenshots.py")


if __name__ == "__main__":
    asyncio.run(main())
