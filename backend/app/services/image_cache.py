"""
Local image cache — downloads remote images to disk so they can be served
as static files instead of being proxied from external sources every request.

Layout on disk:
    {data_dir}/images/covers/{mbid}.jpg   ← release group cover art
    {data_dir}/images/artists/{mbid}.jpg  ← artist photos

Served by FastAPI at:
    /images/covers/{mbid}.jpg
    /images/artists/{mbid}.jpg
"""

import io
import os

import httpx
from PIL import Image

from app.config import settings

_IMAGES_DIR = os.path.join(settings.data_dir, "images")

_CONTENT_TYPE_EXT: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}


_MAX_IMAGE_BYTES = 2 * 1024 * 1024  # 2 MB
_MAX_IMAGE_DIMENSION = 1500


def shrink_if_needed(data: bytes, content_type: str) -> tuple[bytes, str]:
    """Returns (possibly-shrunk bytes, file extension)."""
    ext = _CONTENT_TYPE_EXT.get(content_type, "jpg")
    if len(data) <= _MAX_IMAGE_BYTES:
        return data, ext
    try:
        with Image.open(io.BytesIO(data)) as img:
            img = img.convert("RGB")
            img.thumbnail((_MAX_IMAGE_DIMENSION, _MAX_IMAGE_DIMENSION), Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85, optimize=True)
            return buf.getvalue(), "jpg"
    except Exception:
        return data, ext


def _find_cached(kind_dir: str, key: str) -> str | None:
    """Return the filename (without directory) if any cached file exists for key."""
    try:
        for f in os.listdir(kind_dir):
            name, ext = os.path.splitext(f)
            if name == key and ext:
                return f
    except FileNotFoundError:
        pass
    return None


def get_cached_url(kind: str, key: str) -> str | None:
    """Return the local URL path if already cached, else None."""
    kind_dir = os.path.join(_IMAGES_DIR, kind)
    cached = _find_cached(kind_dir, key)
    if cached:
        return f"/images/{kind}/{cached}"
    return None


async def cache_image(kind: str, key: str, remote_url: str) -> str | None:
    """
    Download *remote_url* and save it under {data_dir}/images/{kind}/{key}.{ext}.

    Returns the local URL path (e.g. /images/covers/abc123.jpg) on success,
    or None if the download fails.  Subsequent calls for the same key return
    the cached URL without re-downloading.
    """
    kind_dir = os.path.join(_IMAGES_DIR, kind)
    os.makedirs(kind_dir, exist_ok=True)

    # Return immediately if already on disk
    cached = _find_cached(kind_dir, key)
    if cached:
        return f"/images/{kind}/{cached}"

    try:
        headers = {"User-Agent": "TuneHound/0.1 (https://github.com/; music-library-app)"}
        async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers=headers) as client:
            resp = await client.get(remote_url)
            if resp.status_code != 200:
                return None
            content_type = resp.headers.get("content-type", "").split(";")[0].strip()
            if content_type not in _CONTENT_TYPE_EXT:
                return None  # not an image — don't save
            image_data, ext = shrink_if_needed(resp.content, content_type)
            dest = os.path.join(kind_dir, f"{key}.{ext}")
            with open(dest, "wb") as fh:
                fh.write(image_data)
            return f"/images/{kind}/{key}.{ext}"
    except Exception:
        return None
