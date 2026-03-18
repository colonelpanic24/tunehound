"""Tests for /api/downloads/settings endpoints."""
import pytest


@pytest.mark.asyncio
async def test_get_settings_creates_defaults(client):
    r = await client.get("/api/downloads/settings")
    assert r.status_code == 200
    data = r.json()
    assert "audio_format" in data
    assert "yt_format" in data
    assert "delay_min" in data
    assert "delay_max" in data
    assert "max_retries" in data
    assert "sponsorblock_remove" in data
    assert "search_query_template" in data
    assert "release_types" in data


@pytest.mark.asyncio
async def test_patch_settings(client):
    r = await client.patch(
        "/api/downloads/settings",
        json={"audio_format": "flac", "delay_min": 2.0},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["audio_format"] == "flac"
    assert data["delay_min"] == 2.0


@pytest.mark.asyncio
async def test_patch_settings_partial(client):
    # First set a known state
    await client.patch("/api/downloads/settings", json={"delay_max": 30.0})

    # Patch only one field
    r = await client.patch("/api/downloads/settings", json={"delay_min": 1.5})
    assert r.status_code == 200
    data = r.json()
    assert data["delay_min"] == 1.5
    assert data["delay_max"] == 30.0


@pytest.mark.asyncio
async def test_patch_sponsorblock(client):
    r = await client.patch(
        "/api/downloads/settings",
        json={"sponsorblock_remove": "music_offtopic,sponsor"},
    )
    assert r.status_code == 200
    assert r.json()["sponsorblock_remove"] == "music_offtopic,sponsor"


@pytest.mark.asyncio
async def test_patch_release_types(client):
    r = await client.patch(
        "/api/downloads/settings",
        json={"release_types": "album,ep,single"},
    )
    assert r.status_code == 200
    assert r.json()["release_types"] == "album,ep,single"


@pytest.mark.asyncio
async def test_list_jobs_empty(client):
    r = await client.get("/api/downloads/jobs")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_get_job_not_found(client):
    r = await client.get("/api/downloads/jobs/9999")
    assert r.status_code == 404
