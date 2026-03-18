"""Tests for GET /api/stats."""
import pytest

from tests.conftest import seed_artist, seed_release_group, seed_track


@pytest.mark.asyncio
async def test_stats_empty_db(client):
    r = await client.get("/api/stats")
    assert r.status_code == 200
    data = r.json()
    assert data["artists"] == 0
    assert data["albums"] == 0
    assert data["tracks"] == 0
    assert data["files_linked"] == 0
    assert data["active_downloads"] == 0


@pytest.mark.asyncio
async def test_stats_with_data(client, db_session):
    artist = await seed_artist(db_session)
    rg = await seed_release_group(db_session, artist_id=artist.id)
    await seed_track(db_session, release_group_id=rg.id)
    await seed_track(db_session, release_group_id=rg.id, track_number=2, file_path="/tmp/t.mp3")

    r = await client.get("/api/stats")
    assert r.status_code == 200
    data = r.json()
    assert data["artists"] == 1
    assert data["albums"] == 1
    assert data["tracks"] == 2
    assert data["files_linked"] == 1
