"""Tests for /api/albums endpoints."""
import pytest

from tests.conftest import seed_artist, seed_release_group, seed_track


@pytest.mark.asyncio
async def test_list_albums_empty(client):
    r = await client.get("/api/albums")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_list_albums_returns_all(client, db_session):
    artist = await seed_artist(db_session)
    await seed_release_group(db_session, artist_id=artist.id, title="Album A")
    await seed_release_group(
        db_session, artist_id=artist.id,
        title="Album B",
        mbid="rg000002-0000-0000-0000-000000000002",
    )

    r = await client.get("/api/albums")
    assert r.status_code == 200
    titles = {a["title"] for a in r.json()}
    assert titles == {"Album A", "Album B"}


@pytest.mark.asyncio
async def test_get_album_not_found(client):
    r = await client.get("/api/albums/9999")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_get_album(client, db_session, mocker):
    mocker.patch("app.api.albums.mb.get_release_group_description", return_value=None)
    artist = await seed_artist(db_session)
    rg = await seed_release_group(db_session, artist_id=artist.id)

    r = await client.get(f"/api/albums/{rg.id}")
    assert r.status_code == 200
    data = r.json()
    assert data["title"] == "Test Album"
    assert data["id"] == rg.id


@pytest.mark.asyncio
async def test_update_album_watched(client, db_session, mocker):
    mocker.patch("app.api.albums.mb.get_release_group_description", return_value=None)
    artist = await seed_artist(db_session)
    rg = await seed_release_group(db_session, artist_id=artist.id)
    assert rg.watched is True

    r = await client.patch(f"/api/albums/{rg.id}", json={"watched": False})
    assert r.status_code == 200
    assert r.json()["watched"] is False


@pytest.mark.asyncio
async def test_update_album_not_found(client):
    r = await client.patch("/api/albums/9999", json={"watched": False})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_get_album_tracks_empty(client, db_session, mocker):
    mocker.patch("app.api.albums.mb.get_tracks_for_release_group", return_value=[])
    artist = await seed_artist(db_session)
    rg = await seed_release_group(db_session, artist_id=artist.id)

    r = await client.get(f"/api/albums/{rg.id}/tracks")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_get_album_tracks_fetches_from_mb(client, db_session, mocker):
    mb_tracks = [
        {"mbid": "t1", "title": "Song One", "track_number": 1, "disc_number": 1, "duration_ms": 200000},
        {"mbid": "t2", "title": "Song Two", "track_number": 2, "disc_number": 1, "duration_ms": 180000},
    ]
    mocker.patch("app.api.albums.mb.get_tracks_for_release_group", return_value=mb_tracks)
    mocker.patch("app.services.scanner.link_existing_files", return_value=0)

    artist = await seed_artist(db_session, folder_name=None)
    rg = await seed_release_group(db_session, artist_id=artist.id)

    r = await client.get(f"/api/albums/{rg.id}/tracks")
    assert r.status_code == 200
    tracks = r.json()
    assert len(tracks) == 2
    assert tracks[0]["title"] == "Song One"


@pytest.mark.asyncio
async def test_tag_status_no_tracks(client, db_session, mocker):
    mocker.patch("app.api.albums.mb.get_release_group_description", return_value=None)
    artist = await seed_artist(db_session)
    rg = await seed_release_group(db_session, artist_id=artist.id)

    r = await client.get(f"/api/albums/{rg.id}/tag-status")
    assert r.status_code == 200
    data = r.json()
    assert data["release_group_id"] == rg.id
    assert data["tracks"] == []


@pytest.mark.asyncio
async def test_tag_status_in_sync_track(client, db_session):
    import os
    import tempfile
    artist = await seed_artist(db_session, name="Blur")
    rg = await seed_release_group(db_session, artist_id=artist.id, title="Parklife")
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        f.write(b"\x00")
        path = f.name
    try:
        await seed_track(
            db_session,
            release_group_id=rg.id,
            title="Girls & Boys",
            track_number=1,
            file_path=path,
            tag_title="Girls & Boys",
            tag_artist="Blur",
            tag_album="Parklife",
            tag_track_number="1",
        )
        r = await client.get(f"/api/albums/{rg.id}/tag-status")
        assert r.status_code == 200
        track_statuses = r.json()["tracks"]
        assert len(track_statuses) == 1
        assert track_statuses[0]["in_sync"] is True
        assert track_statuses[0]["issues"] == []
    finally:
        os.unlink(path)
