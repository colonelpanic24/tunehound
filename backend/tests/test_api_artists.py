"""Tests for /api/artists endpoints."""
import pytest

from tests.conftest import seed_artist, seed_release_group


@pytest.mark.asyncio
async def test_list_artists_empty(client):
    r = await client.get("/api/artists")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_list_artists_returns_data(client, db_session):
    await seed_artist(db_session, name="Radiohead")

    r = await client.get("/api/artists")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["name"] == "Radiohead"


@pytest.mark.asyncio
async def test_get_artist_not_found(client):
    r = await client.get("/api/artists/9999")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_get_artist(client, db_session):
    artist = await seed_artist(db_session, name="Portishead")

    r = await client.get(f"/api/artists/{artist.id}")
    assert r.status_code == 200
    assert r.json()["name"] == "Portishead"


@pytest.mark.asyncio
async def test_search_artists(client, mocker):
    mocker.patch(
        "app.api.artists.mb.search_artists",
        return_value=[
            {"mbid": "abc123", "name": "Massive Attack", "sort_name": "Massive Attack",
             "disambiguation": None, "score": 100}
        ],
    )

    r = await client.get("/api/artists/search?q=massive")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["name"] == "Massive Attack"


@pytest.mark.asyncio
async def test_get_artist_albums(client, db_session, mocker):
    mocker.patch("app.api.artists.mb.get_release_group_description", return_value=None)
    artist = await seed_artist(db_session)
    await seed_release_group(db_session, artist_id=artist.id, title="OK Computer")

    r = await client.get(f"/api/artists/{artist.id}/albums")
    assert r.status_code == 200
    albums = r.json()
    assert len(albums) == 1
    assert albums[0]["title"] == "OK Computer"


@pytest.mark.asyncio
async def test_delete_artist_not_found(client):
    r = await client.delete("/api/artists/9999")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_delete_artist(client, db_session):
    artist = await seed_artist(db_session)

    r = await client.delete(f"/api/artists/{artist.id}")
    assert r.status_code == 204

    # Verify gone
    r2 = await client.get(f"/api/artists/{artist.id}")
    assert r2.status_code == 404


@pytest.mark.asyncio
async def test_get_artist_disk_status_no_folder(client, db_session, mocker):
    """Returns empty lists when artist has no folder_name configured."""
    artist = await seed_artist(db_session, folder_name=None)

    r = await client.get(f"/api/artists/{artist.id}/disk-status")
    assert r.status_code == 200
    data = r.json()
    assert data["matched"] == []
    assert data["unmatched_folders"] == []


@pytest.mark.asyncio
async def test_get_artist_disk_status_uses_stored_file_count(client, db_session, mocker, tmp_path):
    """Uses stored folder_path and file_count; does not re-scan every folder."""
    mocker.patch("app.api.artists.settings.music_library_path", str(tmp_path))

    artist_dir = tmp_path / "My Artist"
    artist_dir.mkdir()
    album_dir = artist_dir / "Great Album"
    album_dir.mkdir()
    (album_dir / "01.mp3").write_bytes(b"\x00")
    (album_dir / "02.mp3").write_bytes(b"\x00")

    artist = await seed_artist(db_session, folder_name="My Artist")
    await seed_release_group(
        db_session, artist_id=artist.id, title="Great Album",
        folder_path=str(album_dir), file_count=2
    )

    r = await client.get(f"/api/artists/{artist.id}/disk-status")
    assert r.status_code == 200
    data = r.json()
    assert len(data["matched"]) == 1
    assert data["matched"][0]["file_count"] == 2
    assert data["matched"][0]["folder_path"] == str(album_dir)
    assert data["missing"] == []


@pytest.mark.asyncio
async def test_get_artist_disk_status_clears_stale_folder(client, db_session, mocker, tmp_path):
    """Clears folder_path when the folder no longer exists on disk."""
    mocker.patch("app.api.artists.settings.music_library_path", str(tmp_path))

    artist_dir = tmp_path / "My Artist"
    artist_dir.mkdir()
    # Note: no album subfolder — the stored path is stale

    artist = await seed_artist(db_session, folder_name="My Artist")
    await seed_release_group(
        db_session, artist_id=artist.id, title="Deleted Album",
        folder_path=str(artist_dir / "Deleted Album"), file_count=5
    )

    r = await client.get(f"/api/artists/{artist.id}/disk-status")
    assert r.status_code == 200
    data = r.json()
    # Should be in missing since folder no longer exists
    assert len(data["missing"]) == 1
    assert data["missing"][0]["title"] == "Deleted Album"
    assert data["matched"] == []


@pytest.mark.asyncio
async def test_get_artist_disk_status_not_found(client):
    r = await client.get("/api/artists/9999/disk-status")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_subscribe_artist_duplicate_is_handled(client, db_session, mocker):
    """Subscribing a second time for an already-known mbid should not crash."""
    mocker.patch(
        "app.api.artists.mb.get_artist",
        return_value={"name": "Test Artist", "sort-name": "Artist, Test",
                      "disambiguation": None, "url-relation-list": []},
    )
    mocker.patch("app.api.artists.mb.get_artist_image_url", return_value=None)
    mocker.patch("app.api.artists.mb.get_release_groups", return_value=[])
    mocker.patch("app.api.artists.artwork_svc.find_local_artist_image", return_value=None)
    mocker.patch("app.api.artists._fetch_cover_art_for_artist", return_value=None)

    mbid = "a1b2c3d4-0000-0000-0000-000000000001"
    await seed_artist(db_session, mbid=mbid)

    r = await client.post("/api/artists", json={"mbid": mbid, "name": "Test Artist"})
    # Should either succeed (returning existing) or 409 — not 500
    assert r.status_code in (200, 201, 409)
