"""
Read audio file tags and compute a snapshot for comparison.
Uses mutagen (same library as tagger.py).
"""
import hashlib
from dataclasses import dataclass
from dataclasses import field as dc_field
from datetime import datetime


@dataclass
class TagSnapshot:
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    track_number: str | None = None
    art_hash: str | None = None
    recording_mbid: str | None = None
    scanned_at: datetime = dc_field(default_factory=datetime.utcnow)


def _hash_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_tags(file_path: str) -> TagSnapshot | None:
    """Read tags from an audio file. Returns None if the file can't be read."""
    try:
        from mutagen import File as MutaFile
        audio = MutaFile(file_path, easy=False)
        if audio is None:
            return TagSnapshot()

        snap = TagSnapshot()
        tags = audio.tags

        if tags is None:
            return snap

        file_lower = file_path.lower()
        if file_lower.endswith('.mp3'):
            snap.title = _first(tags.get('TIT2'))
            snap.artist = _first(tags.get('TPE1'))
            snap.album = _first(tags.get('TALB'))
            snap.track_number = _first(tags.get('TRCK'))
            # MusicBrainz recording ID (stored as UFID frame)
            ufid = tags.get('UFID:http://musicbrainz.org')
            if ufid:
                snap.recording_mbid = ufid.data.decode('utf-8', errors='ignore').strip() or None
            # Cover art
            for key in tags.keys():
                if key.startswith('APIC'):
                    apic = tags[key]
                    snap.art_hash = _hash_bytes(apic.data)
                    break

        elif file_lower.endswith('.flac'):
            snap.title = _first(tags.get('title'))
            snap.artist = _first(tags.get('artist'))
            snap.album = _first(tags.get('album'))
            snap.track_number = _first(tags.get('tracknumber'))
            snap.recording_mbid = _first(tags.get('musicbrainz_trackid'))
            pics = audio.pictures
            if pics:
                snap.art_hash = _hash_bytes(pics[0].data)

        elif file_lower.endswith(('.m4a', '.mp4', '.aac')):
            snap.title = _first(tags.get('\xa9nam'))
            snap.artist = _first(tags.get('\xa9ART'))
            snap.album = _first(tags.get('\xa9alb'))
            trk = tags.get('trkn')
            if trk:
                snap.track_number = str(trk[0][0]) if trk[0] else None
            mb_trk = tags.get('----:com.apple.iTunes:MusicBrainz Track Id')
            if mb_trk:
                v = mb_trk[0]
                snap.recording_mbid = (v.decode('utf-8') if isinstance(v, (bytes, bytearray)) else str(v)).strip() or None
            covr = tags.get('covr')
            if covr:
                snap.art_hash = _hash_bytes(bytes(covr[0]))

        elif file_lower.endswith(('.ogg', '.opus')):
            snap.title = _first(tags.get('title'))
            snap.artist = _first(tags.get('artist'))
            snap.album = _first(tags.get('album'))
            snap.track_number = _first(tags.get('tracknumber'))
            snap.recording_mbid = _first(tags.get('musicbrainz_trackid'))
            # Vorbis cover art (METADATA_BLOCK_PICTURE in base64)
            import base64
            pics = tags.get('metadata_block_picture') or tags.get('METADATA_BLOCK_PICTURE')
            if pics:
                try:
                    from mutagen.flac import Picture
                    pic = Picture(base64.b64decode(pics[0]))
                    snap.art_hash = _hash_bytes(pic.data)
                except Exception:
                    pass

        return snap
    except Exception:
        return None


def _first(val) -> str | None:
    """Extract first string value from a mutagen tag."""
    if val is None:
        return None
    if isinstance(val, list):
        val = val[0] if val else None
    if val is None:
        return None
    return str(val).strip() or None
