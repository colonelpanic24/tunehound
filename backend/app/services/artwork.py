"""
Fetch artwork candidates from external sources and manage local overwrites.
"""
import hashlib
import os
import shutil

import httpx

from app.config import settings
from app.services.image_cache import _CONTENT_TYPE_EXT, _IMAGES_DIR, _find_cached, shrink_if_needed


def hash_file(path: str) -> str | None:
    """Return SHA-256 hex digest of a file's contents, or None if unreadable."""
    try:
        with open(path, 'rb') as f:
            return hashlib.sha256(f.read()).hexdigest()
    except Exception:
        return None


async def fetch_artist_artwork_options(mbid: str, headers: dict) -> list[dict]:
    """
    Return a list of artwork option dicts for an artist.
    Each dict: {source, label, url, thumbnail_url}
    """
    options = []
    async with httpx.AsyncClient(timeout=8, headers=headers) as client:
        # TheAudioDB
        try:
            resp = await client.get(
                "https://www.theaudiodb.com/api/v1/json/2/artist-mb.php",
                params={"i": mbid},
            )
            if resp.status_code == 200:
                artists = resp.json().get("artists") or []
                if artists:
                    a = artists[0]
                    for key, label in [
                        ("strArtistThumb", "Artist photo (TheAudioDB)"),
                        ("strArtistFanart", "Fanart 1 (TheAudioDB)"),
                        ("strArtistFanart2", "Fanart 2 (TheAudioDB)"),
                        ("strArtistFanart3", "Fanart 3 (TheAudioDB)"),
                        ("strArtistBanner", "Banner (TheAudioDB)"),
                        ("strArtistLogo", "Logo (TheAudioDB)"),
                    ]:
                        url = a.get(key)
                        if url:
                            options.append({
                                "source": "theaudiodb",
                                "label": label,
                                "url": url,
                                "thumbnail_url": url,
                            })
        except Exception:
            pass

        # Wikidata P18
        try:
            from app.services import musicbrainz as mb
            artist_data = await mb.get_artist(mbid)
            wikidata_id = None
            for rel in artist_data.get("url-relation-list", []):
                if "wikidata.org/wiki/Q" in rel.get("target", ""):
                    wikidata_id = rel["target"].split("/")[-1]
                    break
            if wikidata_id:
                resp = await client.get(
                    "https://www.wikidata.org/w/api.php",
                    params={"action": "wbgetentities", "ids": wikidata_id, "props": "claims", "format": "json"},
                )
                data = resp.json()
                entity = data.get("entities", {}).get(wikidata_id, {})
                p18 = entity.get("claims", {}).get("P18", [])
                if p18:
                    filename = p18[0]["mainsnak"]["datavalue"]["value"].replace(" ", "_")
                    url = f"https://commons.wikimedia.org/wiki/Special:FilePath/{filename}?width=400"
                    options.append({
                        "source": "wikidata",
                        "label": "Wikipedia image",
                        "url": url,
                        "thumbnail_url": url,
                    })
        except Exception:
            pass

    return options


async def fetch_album_artwork_options(release_group_mbid: str) -> list[dict]:
    """Fetch artwork options from Cover Art Archive for a release group."""
    options = []
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            resp = await client.get(
                f"https://coverartarchive.org/release-group/{release_group_mbid}",
                headers={"Accept": "application/json"},
            )
            if resp.status_code == 200:
                data = resp.json()
                for img in data.get("images", []):
                    types = img.get("types", [])
                    label = ", ".join(types) if types else "Artwork"
                    thumb = img.get("thumbnails", {})
                    options.append({
                        "source": "caa",
                        "label": label,
                        "url": img.get("image", ""),
                        "thumbnail_url": thumb.get("500") or thumb.get("250") or img.get("image", ""),
                        "front": img.get("front", False),
                    })
                # Sort: front cover first
                options.sort(key=lambda x: (0 if x.get("front") else 1))
    except Exception:
        pass
    return options


async def overwrite_cached_image(kind: str, key: str, remote_url: str) -> str | None:
    """
    Download remote_url and OVERWRITE the cached file (unlike cache_image which skips if exists).
    Returns local URL path or None on failure.
    """
    kind_dir = os.path.join(_IMAGES_DIR, kind)
    os.makedirs(kind_dir, exist_ok=True)

    # Remove any existing cached file for this key
    existing = _find_cached(kind_dir, key)
    if existing:
        try:
            os.remove(os.path.join(kind_dir, existing))
        except Exception:
            pass

    headers = {"User-Agent": f"TuneHound/0.1 ({settings.musicbrainz_contact})"}
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers=headers) as client:
            resp = await client.get(remote_url)
            if resp.status_code != 200:
                return None
            content_type = resp.headers.get("content-type", "").split(";")[0].strip()
            if content_type not in _CONTENT_TYPE_EXT:
                return None
            image_data, ext = shrink_if_needed(resp.content, content_type)
            dest = os.path.join(kind_dir, f"{key}.{ext}")
            with open(dest, "wb") as fh:
                fh.write(image_data)
            return f"/images/{kind}/{key}.{ext}"
    except Exception:
        return None


async def save_uploaded_image(kind: str, key: str, data: bytes, content_type: str) -> str | None:
    """Save uploaded image bytes to the cache, overwriting any existing entry."""
    kind_dir = os.path.join(_IMAGES_DIR, kind)
    os.makedirs(kind_dir, exist_ok=True)

    existing = _find_cached(kind_dir, key)
    if existing:
        try:
            os.remove(os.path.join(kind_dir, existing))
        except Exception:
            pass

    image_data, ext = shrink_if_needed(data, content_type)
    dest = os.path.join(kind_dir, f"{key}.{ext}")
    with open(dest, "wb") as fh:
        fh.write(image_data)
    return f"/images/{kind}/{key}.{ext}"


def write_folder_image(folder_path: str, image_cache_url: str, filename: str = "cover.jpg") -> bool:
    """
    Copy the cached image to folder_path/filename.
    image_cache_url is like /images/covers/abc.jpg
    Returns True on success.
    """
    rel = image_cache_url.lstrip("/")  # "images/covers/abc.jpg"
    # _IMAGES_DIR is {data_dir}/images, so cache file is at {data_dir}/{rel}
    src = os.path.join(os.path.dirname(_IMAGES_DIR), rel)
    if not os.path.isfile(src):
        # Try resolving relative to images dir directly
        sub = rel.replace("images/", "", 1)
        src = os.path.join(_IMAGES_DIR, sub)
    if not os.path.isfile(src):
        return False
    dest = os.path.join(folder_path, filename)
    try:
        shutil.copy2(src, dest)
        return True
    except Exception:
        return False


def find_local_folder_image(folder_path: str) -> str | None:
    """
    Look for a standard folder image file in the given directory.
    Returns the full path if found, else None.
    """
    candidates = [
        "folder.jpg", "folder.png", "folder.webp",
        "cover.jpg", "cover.png", "cover.webp",
        "front.jpg", "front.png",
        "Folder.jpg", "Cover.jpg",  # case variants
    ]
    for name in candidates:
        p = os.path.join(folder_path, name)
        if os.path.isfile(p):
            return p
    return None


def find_local_artist_image(folder_path: str) -> str | None:
    """Look for artist.jpg / folder.jpg in artist root directory."""
    candidates = [
        "artist.jpg", "artist.png", "artist.webp",
        "folder.jpg", "folder.png",
        "Artist.jpg", "Folder.jpg",
    ]
    for name in candidates:
        p = os.path.join(folder_path, name)
        if os.path.isfile(p):
            return p
    return None


def write_artist_image(folder_path: str, image_cache_url: str) -> bool:
    """
    Write an artist image to the music folder using the appropriate filename:
    - Overwrites artist.jpg if one already exists there.
    - Overwrites folder.jpg if one already exists there (and no artist.jpg).
    - Otherwise writes folder.jpg as the new file.
    """
    for candidate in ("artist.jpg", "artist.png", "artist.webp",
                       "folder.jpg", "folder.png", "folder.webp",
                       "Artist.jpg", "Folder.jpg"):
        if os.path.isfile(os.path.join(folder_path, candidate)):
            return write_folder_image(folder_path, image_cache_url, filename=candidate)
    return write_folder_image(folder_path, image_cache_url, filename="folder.jpg")
