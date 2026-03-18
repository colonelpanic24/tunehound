"""Tests for /api/library endpoints."""
import json
import os
import tempfile

import pytest

from tests.conftest import seed_artist, seed_release_group, seed_track


@pytest.mark.asyncio
async def test_clear_artists_empty_db(client):
    r = await client.delete("/api/library/artists")
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_clear_artists_removes_all(client, db_session):
    artist = await seed_artist(db_session)
    rg = await seed_release_group(db_session, artist_id=artist.id)
    await seed_track(db_session, release_group_id=rg.id)

    r = await client.delete("/api/library/artists")
    assert r.status_code == 204

    # Confirm they're gone
    stats = (await client.get("/api/stats")).json()
    assert stats["artists"] == 0
    assert stats["albums"] == 0
    assert stats["tracks"] == 0


@pytest.mark.asyncio
async def test_missing_count_zero(client):
    r = await client.get("/api/library/missing/count")
    assert r.status_code == 200
    assert r.json()["count"] == 0


@pytest.mark.asyncio
async def test_missing_count_with_tracks_no_files(client, db_session):
    artist = await seed_artist(db_session)
    rg = await seed_release_group(db_session, artist_id=artist.id, tracks_fetched=True)
    await seed_track(db_session, release_group_id=rg.id, file_path=None)

    r = await client.get("/api/library/missing/count")
    assert r.status_code == 200
    assert r.json()["count"] == 1


@pytest.mark.asyncio
async def test_missing_count_album_with_file(client, db_session):
    artist = await seed_artist(db_session)
    rg = await seed_release_group(db_session, artist_id=artist.id, tracks_fetched=True)
    await seed_track(db_session, release_group_id=rg.id, file_path="/music/track.mp3")

    r = await client.get("/api/library/missing/count")
    assert r.status_code == 200
    assert r.json()["count"] == 0


@pytest.mark.asyncio
async def test_library_stats_no_files(client, tmp_path, mocker):
    mocker.patch("app.api.library.settings.music_library_path", str(tmp_path))
    r = await client.get("/api/library/stats")
    assert r.status_code == 200
    data = r.json()
    assert data["total_tracks"] == 0
    assert data["total_size_bytes"] == 0
    assert data["by_format"] == {}


@pytest.mark.asyncio
async def test_library_stats_with_files(client, tmp_path, mocker):
    # Write a fake audio file
    fake_file = tmp_path / "song.mp3"
    fake_file.write_bytes(b"\xff\xfb" * 100)

    mocker.patch("app.api.library.settings.music_library_path", str(tmp_path))

    r = await client.get("/api/library/stats")
    assert r.status_code == 200
    data = r.json()
    assert data["total_tracks"] == 1
    assert data["by_format"] == {"mp3": 1}
    assert data["total_size_bytes"] > 0


@pytest.mark.asyncio
async def test_orphaned_files_empty(client, tmp_path, mocker):
    mocker.patch("app.api.library.settings.music_library_path", str(tmp_path))

    r = await client.get("/api/library/orphaned")
    assert r.status_code == 200
    data = r.json()
    assert data["items"] == []
    assert data["total"] == 0


@pytest.mark.asyncio
async def test_orphaned_files_detects_unlinked(client, db_session, tmp_path, mocker):
    mocker.patch("app.api.library.settings.music_library_path", str(tmp_path))

    # Create a real file that is NOT linked to any track
    fake_file = tmp_path / "orphan.mp3"
    fake_file.write_bytes(b"\xff\xfb" * 50)

    r = await client.get("/api/library/orphaned")
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 1
    assert data["items"][0]["filename"] == "orphan.mp3"


@pytest.mark.asyncio
async def test_orphaned_files_linked_not_returned(client, db_session, tmp_path, mocker):
    mocker.patch("app.api.library.settings.music_library_path", str(tmp_path))

    fake_file = tmp_path / "linked.mp3"
    fake_file.write_bytes(b"\xff\xfb" * 50)

    artist = await seed_artist(db_session)
    rg = await seed_release_group(db_session, artist_id=artist.id)
    await seed_track(db_session, release_group_id=rg.id, file_path=str(fake_file))

    r = await client.get("/api/library/orphaned")
    assert r.status_code == 200
    assert r.json()["total"] == 0
