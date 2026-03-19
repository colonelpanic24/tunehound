"""Tests for app.services.scanner."""
import os

import pytest

from app.services.scanner import (
    link_album_folders,
    link_existing_files,
    scan_music_directory_stream,
)


@pytest.mark.asyncio
async def test_scan_nonexistent_directory():
    events = []
    async for e in scan_music_directory_stream("/nonexistent/path/xyz"):
        events.append(e)

    assert events[0]["type"] == "start"
    assert events[0]["total"] == 0
    assert events[-1]["type"] == "done"


@pytest.mark.asyncio
async def test_scan_empty_directory(tmp_path):
    events = []
    async for e in scan_music_directory_stream(str(tmp_path)):
        events.append(e)

    assert events[0]["type"] == "start"
    assert events[0]["total"] == 0
    assert events[-1]["type"] == "done"


@pytest.mark.asyncio
async def test_scan_skips_known_folders(tmp_path, mocker):
    (tmp_path / "Artist A").mkdir()
    (tmp_path / "Artist B").mkdir()

    mocker.patch("app.services.musicbrainz.search_artists", return_value=[])

    events = []
    async for e in scan_music_directory_stream(
        str(tmp_path), known_names={"Artist A"}
    ):
        events.append(e)

    start = events[0]
    assert start["type"] == "start"
    assert start["total"] == 1
    assert start["skipped_known"] == 1


@pytest.mark.asyncio
async def test_scan_yields_result_events(tmp_path, mocker):
    folder = tmp_path / "My Band"
    folder.mkdir()
    (folder / "Album 1").mkdir()
    (folder / "Album 2").mkdir()

    mock_candidates = [{"mbid": "abc", "name": "My Band", "score": 100}]
    mocker.patch("app.services.musicbrainz.search_artists", return_value=mock_candidates)

    events = []
    async for e in scan_music_directory_stream(str(tmp_path)):
        events.append(e)

    result_events = [e for e in events if e["type"] == "result"]
    assert len(result_events) == 1
    ev = result_events[0]
    assert ev["folder"] == "My Band"
    assert ev["album_count"] == 2
    assert ev["done"] == 1
    assert ev["total"] == 1
    assert len(ev["candidates"]) == 1


@pytest.mark.asyncio
async def test_link_existing_files_no_directory():
    count = await link_existing_files("/nonexistent/path", db=None)
    assert count == 0


@pytest.mark.asyncio
async def test_link_existing_files_matches_track(tmp_path, db_session):
    from tests.conftest import seed_artist, seed_release_group, seed_track

    # Create artist folder structure
    artist_dir = tmp_path / "Cool Artist"
    artist_dir.mkdir()
    album_dir = artist_dir / "Cool Album"
    album_dir.mkdir()
    track_file = album_dir / "01 - Cool Song.opus"
    track_file.write_bytes(b"\x00" * 100)

    artist = await seed_artist(db_session, folder_name="Cool Artist")
    rg = await seed_release_group(db_session, artist_id=artist.id, title="Cool Album")
    track = await seed_track(
        db_session,
        release_group_id=rg.id,
        title="Cool Song",
        track_number=1,
        disc_number=1,
        file_path=None,
    )

    # Patch _extract_track_info to return matching info
    import app.services.scanner as scanner_module

    def fake_extract(path):
        if str(track_file) == path:
            return {"title_guess": "Cool Song", "track_number": 1, "disc_number": 1}
        return None

    original = scanner_module._extract_track_info
    scanner_module._extract_track_info = fake_extract
    try:
        count = await link_existing_files(str(artist_dir), db_session)
    finally:
        scanner_module._extract_track_info = original

    assert count == 1

    await db_session.refresh(track)
    assert track.file_path == str(track_file)


# ── link_album_folders ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_link_album_folders_nonexistent_path(db_session):
    """Returns without error when artist path doesn't exist."""
    from tests.conftest import seed_artist, seed_release_group

    artist = await seed_artist(db_session)
    rg = await seed_release_group(db_session, artist_id=artist.id, title="Some Album")

    await link_album_folders("/nonexistent/path", [rg], db_session)

    await db_session.refresh(rg)
    assert rg.folder_path is None


@pytest.mark.asyncio
async def test_link_album_folders_matches_folder(tmp_path, db_session):
    """Sets folder_path and file_count on matching release groups."""
    from tests.conftest import seed_artist, seed_release_group

    artist_dir = tmp_path / "Test Artist"
    artist_dir.mkdir()
    album_dir = artist_dir / "Great Album"
    album_dir.mkdir()
    (album_dir / "01 - Track.mp3").write_bytes(b"\x00" * 10)
    (album_dir / "02 - Track.mp3").write_bytes(b"\x00" * 10)

    artist = await seed_artist(db_session, folder_name="Test Artist")
    rg = await seed_release_group(db_session, artist_id=artist.id, title="Great Album")

    await link_album_folders(str(artist_dir), [rg], db_session)

    await db_session.refresh(rg)
    assert rg.folder_path == str(album_dir)
    assert rg.file_count == 2


@pytest.mark.asyncio
async def test_link_album_folders_no_match_below_threshold(tmp_path, db_session):
    """Does not set folder_path when similarity is too low."""
    from tests.conftest import seed_artist, seed_release_group

    artist_dir = tmp_path / "Artist"
    artist_dir.mkdir()
    (artist_dir / "Completely Different Name").mkdir()

    artist = await seed_artist(db_session, folder_name="Artist")
    rg = await seed_release_group(db_session, artist_id=artist.id, title="Nothing Alike ZZZZ")

    await link_album_folders(str(artist_dir), [rg], db_session)

    await db_session.refresh(rg)
    assert rg.folder_path is None


@pytest.mark.asyncio
async def test_link_album_folders_no_duplicate_assignment(tmp_path, db_session):
    """Each disk folder is assigned to at most one release group."""
    from tests.conftest import seed_artist, seed_release_group

    artist_dir = tmp_path / "Artist"
    artist_dir.mkdir()
    album_dir = artist_dir / "Shared Album"
    album_dir.mkdir()

    artist = await seed_artist(db_session, folder_name="Artist")
    rg1 = await seed_release_group(
        db_session, artist_id=artist.id, title="Shared Album",
        mbid="rg000001-0000-0000-0000-000000000001"
    )
    rg2 = await seed_release_group(
        db_session, artist_id=artist.id, title="Shared Album",
        mbid="rg000001-0000-0000-0000-000000000002"
    )

    await link_album_folders(str(artist_dir), [rg1, rg2], db_session)

    await db_session.refresh(rg1)
    await db_session.refresh(rg2)
    # Only one of them gets the folder
    assigned = [rg for rg in [rg1, rg2] if rg.folder_path is not None]
    assert len(assigned) == 1
    assert assigned[0].folder_path == str(album_dir)
