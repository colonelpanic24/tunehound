"""
Write ID3/Vorbis/FLAC tags to downloaded audio files using mutagen.
"""

import base64
import hashlib
import os

from mutagen.flac import FLAC, Picture
from mutagen.id3 import APIC, ID3, TALB, TDRC, TIT2, TPE1, TRCK
from mutagen.mp4 import MP4, MP4Cover
from mutagen.oggopus import OggOpus
from mutagen.oggvorbis import OggVorbis


def compute_art_hash_from_cover_file(cover_url: str) -> str | None:
    """
    Read the cached cover image file referenced by cover_url (a local /images/... path)
    and return its SHA-256 hash, or None if the file cannot be read.
    """
    from app.services.image_cache import _IMAGES_DIR
    rel = cover_url.lstrip("/")  # e.g. "images/covers/abc.jpg"
    src = os.path.join(os.path.dirname(_IMAGES_DIR), rel)
    if not os.path.isfile(src):
        sub = rel.replace("images/", "", 1)
        src = os.path.join(_IMAGES_DIR, sub)
    try:
        with open(src, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()
    except Exception:
        return None


def tag_file(
    file_path: str,
    title: str,
    artist: str,
    album: str,
    track_number: int,
    disc_number: int,
    year: str | None,
    cover_bytes: bytes | None = None,
) -> None:
    ext = os.path.splitext(file_path)[1].lower()

    if ext in (".ogg",):
        # Detect opus vs vorbis by trying OggOpus first
        try:
            _tag_ogg_opus(file_path, title, artist, album, track_number, disc_number, year, cover_bytes)
        except Exception:
            _tag_ogg_vorbis(file_path, title, artist, album, track_number, disc_number, year, cover_bytes)
    elif ext == ".opus":
        _tag_ogg_opus(file_path, title, artist, album, track_number, disc_number, year, cover_bytes)
    elif ext in (".mp3",):
        _tag_mp3(file_path, title, artist, album, track_number, disc_number, year, cover_bytes)
    elif ext in (".flac",):
        _tag_flac(file_path, title, artist, album, track_number, disc_number, year, cover_bytes)
    elif ext in (".m4a", ".aac"):
        _tag_m4a(file_path, title, artist, album, track_number, disc_number, year, cover_bytes)
    # For unsupported formats we silently skip — not worth crashing the download


def _tag_ogg_opus(file_path, title, artist, album, track_number, disc_number, year, cover_bytes):
    audio = OggOpus(file_path)
    audio["title"] = [title]
    audio["artist"] = [artist]
    audio["album"] = [album]
    audio["tracknumber"] = [str(track_number)]
    audio["discnumber"] = [str(disc_number)]
    if year:
        audio["date"] = [year]
    if cover_bytes:
        pic = Picture()
        pic.type = 3
        pic.mime = "image/jpeg"
        pic.data = cover_bytes
        audio["metadata_block_picture"] = [
            base64.b64encode(pic.write()).decode("ascii")
        ]
    audio.save()


def _tag_ogg_vorbis(file_path, title, artist, album, track_number, disc_number, year, cover_bytes):
    audio = OggVorbis(file_path)
    audio["title"] = [title]
    audio["artist"] = [artist]
    audio["album"] = [album]
    audio["tracknumber"] = [str(track_number)]
    audio["discnumber"] = [str(disc_number)]
    if year:
        audio["date"] = [year]
    if cover_bytes:
        pic = Picture()
        pic.type = 3
        pic.mime = "image/jpeg"
        pic.data = cover_bytes
        audio["metadata_block_picture"] = [
            base64.b64encode(pic.write()).decode("ascii")
        ]
    audio.save()


def _tag_mp3(file_path, title, artist, album, track_number, disc_number, year, cover_bytes):
    audio = ID3(file_path)
    audio["TIT2"] = TIT2(encoding=3, text=title)
    audio["TPE1"] = TPE1(encoding=3, text=artist)
    audio["TALB"] = TALB(encoding=3, text=album)
    audio["TRCK"] = TRCK(encoding=3, text=str(track_number))
    if year:
        audio["TDRC"] = TDRC(encoding=3, text=year)
    if cover_bytes:
        audio["APIC"] = APIC(
            encoding=3, mime="image/jpeg", type=3, desc="Cover", data=cover_bytes
        )
    audio.save()


def _tag_flac(file_path, title, artist, album, track_number, disc_number, year, cover_bytes):
    audio = FLAC(file_path)
    audio["title"] = [title]
    audio["artist"] = [artist]
    audio["album"] = [album]
    audio["tracknumber"] = [str(track_number)]
    audio["discnumber"] = [str(disc_number)]
    if year:
        audio["date"] = [year]
    if cover_bytes:
        pic = Picture()
        pic.type = 3
        pic.mime = "image/jpeg"
        pic.data = cover_bytes
        audio.add_picture(pic)
    audio.save()


def _tag_m4a(file_path, title, artist, album, track_number, disc_number, year, cover_bytes):
    audio = MP4(file_path)
    audio["\xa9nam"] = [title]
    audio["\xa9ART"] = [artist]
    audio["\xa9alb"] = [album]
    audio["trkn"] = [(track_number, 0)]
    audio["disk"] = [(disc_number, 0)]
    if year:
        audio["\xa9day"] = [year]
    if cover_bytes:
        audio["covr"] = [MP4Cover(cover_bytes, imageformat=MP4Cover.FORMAT_JPEG)]
    audio.save()
