"""Tests for /api/library endpoints."""
import pytest

from tests.conftest import seed_artist, seed_release_group, seed_track

# ── POST /api/library/rename-folder ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_rename_folder_not_found(client, tmp_path, mocker):
    mocker.patch("app.api.library.settings.music_library_path", str(tmp_path))
    mocker.patch("app.services.library_watcher.stop_library_watcher")
    mocker.patch("app.services.library_watcher.start_library_watcher")
    r = await client.post(
        "/api/library/rename-folder",
        json={"old_name": "Nonexistent", "new_name": "Something"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_rename_folder_destination_exists(client, tmp_path, mocker):
    mocker.patch("app.api.library.settings.music_library_path", str(tmp_path))
    mocker.patch("app.services.library_watcher.stop_library_watcher")
    mocker.patch("app.services.library_watcher.start_library_watcher")
    (tmp_path / "OldName").mkdir()
    (tmp_path / "NewName").mkdir()
    r = await client.post(
        "/api/library/rename-folder",
        json={"old_name": "OldName", "new_name": "NewName"},
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_rename_folder_renames_on_disk(client, db_session, tmp_path, mocker):
    mocker.patch("app.api.library.settings.music_library_path", str(tmp_path))
    mocker.patch("app.services.library_watcher.stop_library_watcher")
    mocker.patch("app.services.library_watcher.start_library_watcher")

    old_dir = tmp_path / "AC DC"
    old_dir.mkdir()

    r = await client.post(
        "/api/library/rename-folder",
        json={"old_name": "AC DC", "new_name": "AC_DC"},
    )
    assert r.status_code == 200
    assert not (tmp_path / "AC DC").exists()
    assert (tmp_path / "AC_DC").exists()


@pytest.mark.asyncio
async def test_rename_folder_updates_artist_and_tracks(client, db_session, tmp_path, mocker):
    mocker.patch("app.api.library.settings.music_library_path", str(tmp_path))
    mocker.patch("app.services.library_watcher.stop_library_watcher")
    mocker.patch("app.services.library_watcher.start_library_watcher")

    old_dir = tmp_path / "Old Name"
    album_dir = old_dir / "Album"
    album_dir.mkdir(parents=True)
    track_file = album_dir / "01 - Song.mp3"
    track_file.write_bytes(b"\x00" * 10)

    artist = await seed_artist(db_session, folder_name="Old Name")
    rg = await seed_release_group(db_session, artist_id=artist.id)
    track = await seed_track(
        db_session, release_group_id=rg.id, file_path=str(track_file)
    )

    r = await client.post(
        "/api/library/rename-folder",
        json={"old_name": "Old Name", "new_name": "New Name"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["tracks_updated"] == 1

    await db_session.refresh(artist)
    await db_session.refresh(track)
    assert artist.folder_name == "New Name"
    assert "New Name" in track.file_path
    assert "Old Name" not in track.file_path


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



# ── POST /api/library/sync-files ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_sync_files_no_artists(client):
    r = await client.post("/api/library/sync-files")
    assert r.status_code == 200
    data = r.json()
    assert data["artists_processed"] == 0
    assert data["files_linked"] == 0
    assert data["files_unlinked"] == 0


@pytest.mark.asyncio
async def test_sync_files_clears_broken_links(client, db_session, tmp_path, mocker):
    mocker.patch("app.api.library.settings.music_library_path", str(tmp_path))
    # Patch scanner.link_existing_files and scanner.link_album_folders to no-ops
    mocker.patch("app.services.scanner.link_existing_files", return_value=0)
    mocker.patch("app.services.scanner.link_album_folders", return_value=None)

    artist = await seed_artist(db_session, folder_name="MyArtist")
    (tmp_path / "MyArtist").mkdir()
    rg = await seed_release_group(db_session, artist_id=artist.id)
    # Track pointing to a file that doesn't exist
    track = await seed_track(
        db_session, release_group_id=rg.id, file_path=str(tmp_path / "MyArtist" / "gone.mp3")
    )

    r = await client.post("/api/library/sync-files")
    assert r.status_code == 200
    data = r.json()
    assert data["artists_processed"] == 1
    assert data["files_unlinked"] == 1

    await db_session.refresh(track)
    assert track.file_path is None


@pytest.mark.asyncio
async def test_sync_files_keeps_valid_links(client, db_session, tmp_path, mocker):
    mocker.patch("app.api.library.settings.music_library_path", str(tmp_path))
    mocker.patch("app.services.scanner.link_existing_files", return_value=0)
    mocker.patch("app.services.scanner.link_album_folders", return_value=None)

    artist = await seed_artist(db_session, folder_name="MyArtist")
    (tmp_path / "MyArtist").mkdir()
    rg = await seed_release_group(db_session, artist_id=artist.id)
    real_file = tmp_path / "MyArtist" / "real.mp3"
    real_file.write_bytes(b"\xff\xfb" * 10)
    track = await seed_track(
        db_session, release_group_id=rg.id, file_path=str(real_file)
    )

    r = await client.post("/api/library/sync-files")
    assert r.status_code == 200
    data = r.json()
    assert data["files_unlinked"] == 0

    await db_session.refresh(track)
    assert track.file_path is not None


# ── POST /api/library/rescan-tags ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_rescan_tags_no_tracks(client):
    r = await client.post("/api/library/rescan-tags")
    assert r.status_code == 200
    assert r.json()["tracks_updated"] == 0


@pytest.mark.asyncio
async def test_rescan_tags_updates_linked_tracks(client, db_session, tmp_path, mocker):
    # Seed a track with a real file path
    artist = await seed_artist(db_session)
    rg = await seed_release_group(db_session, artist_id=artist.id)
    fake_file = tmp_path / "track.mp3"
    fake_file.write_bytes(b"\xff\xfb" * 10)
    track = await seed_track(
        db_session, release_group_id=rg.id, file_path=str(fake_file)
    )

    from app.services.tag_reader import TagSnapshot

    fake_snap = TagSnapshot(
        title="New Title",
        artist="New Artist",
        album="New Album",
        track_number="3",
        art_hash=None,
    )
    mocker.patch("app.api.library.read_tags", return_value=fake_snap)

    r = await client.post("/api/library/rescan-tags")
    assert r.status_code == 200
    assert r.json()["tracks_updated"] == 1

    await db_session.refresh(track)
    assert track.tag_title == "New Title"
    assert track.tag_artist == "New Artist"


@pytest.mark.asyncio
async def test_rescan_tags_skips_missing_files(client, db_session, tmp_path, mocker):
    artist = await seed_artist(db_session)
    rg = await seed_release_group(db_session, artist_id=artist.id)
    # file_path set but file doesn't exist
    await seed_track(
        db_session, release_group_id=rg.id, file_path=str(tmp_path / "missing.mp3")
    )

    read_tags_mock = mocker.patch("app.api.library.read_tags")

    r = await client.post("/api/library/rescan-tags")
    assert r.status_code == 200
    assert r.json()["tracks_updated"] == 0
    read_tags_mock.assert_not_called()


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
