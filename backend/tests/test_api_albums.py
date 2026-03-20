"""Tests for /api/albums endpoints."""
import pytest

from tests.conftest import seed_artist, seed_release_group, seed_track


@pytest.mark.asyncio
async def test_list_albums_empty(client):
    r = await client.get("/api/albums")
    assert r.status_code == 200
    data = r.json()
    assert data["items"] == []
    assert data["total"] == 0
    assert data["counts"]["all"] == 0


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
    data = r.json()
    titles = {a["title"] for a in data["items"]}
    assert titles == {"Album A", "Album B"}
    assert data["total"] == 2
    assert data["counts"]["all"] == 2


@pytest.mark.asyncio
async def test_list_albums_pagination(client, db_session):
    artist = await seed_artist(db_session)
    for i in range(5):
        await seed_release_group(
            db_session, artist_id=artist.id,
            title=f"Album {i}",
            mbid=f"rg00000{i}-0000-0000-0000-000000000001",
        )

    r = await client.get("/api/albums?offset=0&limit=2")
    assert r.status_code == 200
    data = r.json()
    assert len(data["items"]) == 2
    assert data["total"] == 5

    r2 = await client.get("/api/albums?offset=2&limit=2")
    assert r2.status_code == 200
    data2 = r2.json()
    assert len(data2["items"]) == 2
    # No overlap between pages
    titles1 = {a["title"] for a in data["items"]}
    titles2 = {a["title"] for a in data2["items"]}
    assert titles1.isdisjoint(titles2)


@pytest.mark.asyncio
async def test_list_albums_search(client, db_session):
    artist = await seed_artist(db_session)
    await seed_release_group(db_session, artist_id=artist.id, title="Parklife",
                             mbid="rg000001-0000-0000-0000-000000000001")
    await seed_release_group(db_session, artist_id=artist.id, title="Modern Life Is Rubbish",
                             mbid="rg000002-0000-0000-0000-000000000002")

    r = await client.get("/api/albums?search=park")
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 1
    assert data["items"][0]["title"] == "Parklife"


@pytest.mark.asyncio
async def test_list_albums_avail_filter(client, db_session):
    artist = await seed_artist(db_session)
    await seed_release_group(db_session, artist_id=artist.id, title="On Disk",
                             mbid="rg000001-0000-0000-0000-000000000001",
                             folder_path="/music/artist/on-disk")
    await seed_release_group(db_session, artist_id=artist.id, title="Missing",
                             mbid="rg000002-0000-0000-0000-000000000002")

    r = await client.get("/api/albums?avail=on-disk")
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 1
    assert data["items"][0]["title"] == "On Disk"

    r2 = await client.get("/api/albums?avail=missing")
    assert r2.status_code == 200
    data2 = r2.json()
    assert data2["total"] == 1
    assert data2["items"][0]["title"] == "Missing"


@pytest.mark.asyncio
async def test_list_albums_counts_reflect_avail(client, db_session):
    artist = await seed_artist(db_session)
    await seed_release_group(db_session, artist_id=artist.id, title="On Disk",
                             mbid="rg000001-0000-0000-0000-000000000001",
                             folder_path="/music/artist/on-disk")
    await seed_release_group(db_session, artist_id=artist.id, title="Missing",
                             mbid="rg000002-0000-0000-0000-000000000002")

    r = await client.get("/api/albums")
    counts = r.json()["counts"]
    assert counts["all"] == 2
    assert counts["on_disk"] == 1
    assert counts["missing"] == 1


@pytest.mark.asyncio
async def test_list_albums_grouped(client, db_session):
    artist1 = await seed_artist(db_session, name="Artist One",
                                mbid="a1000000-0000-0000-0000-000000000001")
    artist2 = await seed_artist(db_session, name="Artist Two",
                                mbid="a2000000-0000-0000-0000-000000000002")
    await seed_release_group(db_session, artist_id=artist1.id, title="Album A",
                             mbid="rg000001-0000-0000-0000-000000000001")
    await seed_release_group(db_session, artist_id=artist1.id, title="Album B",
                             mbid="rg000002-0000-0000-0000-000000000002")
    await seed_release_group(db_session, artist_id=artist2.id, title="Album C",
                             mbid="rg000003-0000-0000-0000-000000000003")

    r = await client.get("/api/albums?grouped=true")
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 2  # 2 artists
    assert len(data["items"]) == 2
    artist_names = {g["artist_name"] for g in data["items"]}
    assert artist_names == {"Artist One", "Artist Two"}
    group1 = next(g for g in data["items"] if g["artist_name"] == "Artist One")
    assert len(group1["albums"]) == 2


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
