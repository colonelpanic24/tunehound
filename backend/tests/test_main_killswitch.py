"""Tests for the ExternalUrlKillSwitch middleware logic."""
import pytest

from app.main import _scan_for_external_urls


def test_no_external_urls_passes():
    # Should not raise or call os._exit
    _scan_for_external_urls(
        {"image_url": "/images/artists/abc.jpg", "name": "Test"},
        "/api/artists",
    )


def test_null_image_url_passes():
    _scan_for_external_urls({"image_url": None}, "/api/artists")


def test_external_image_url_kills(mocker):
    mock_exit = mocker.patch("app.main.os._exit")
    _scan_for_external_urls(
        {"image_url": "https://example.com/photo.jpg"},
        "/api/artists",
    )
    mock_exit.assert_called_once_with(1)


def test_external_cover_art_url_kills(mocker):
    mock_exit = mocker.patch("app.main.os._exit")
    _scan_for_external_urls(
        {"cover_art_url": "http://coverartarchive.org/release/abc.jpg"},
        "/api/albums/1",
    )
    mock_exit.assert_called_once_with(1)


def test_external_url_in_nested_list(mocker):
    mock_exit = mocker.patch("app.main.os._exit")
    _scan_for_external_urls(
        [{"image_url": "https://example.com/photo.jpg"}],
        "/api/artists",
    )
    mock_exit.assert_called_once_with(1)


def test_non_watched_field_not_checked(mocker):
    mock_exit = mocker.patch("app.main.os._exit")
    _scan_for_external_urls(
        {"bio": "https://en.wikipedia.org/wiki/Test"},
        "/api/artists/1",
    )
    mock_exit.assert_not_called()
