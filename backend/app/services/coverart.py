"""
Fetch cover art from the MusicBrainz Cover Art Archive.
https://coverartarchive.org/
"""

import httpx


async def get_cover_art_url(release_group_mbid: str) -> str | None:
    """Return a direct image URL for a release group, or None if unavailable."""
    url = f"https://coverartarchive.org/release-group/{release_group_mbid}/front"
    async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
        resp = await client.get(url)
        if resp.status_code in (307, 302, 301):
            return resp.headers.get("location")
        if resp.status_code == 200:
            return url
    return None


async def fetch_cover_art_bytes(release_group_mbid: str) -> bytes | None:
    """Download cover art bytes for embedding into audio files."""
    url = f"https://coverartarchive.org/release-group/{release_group_mbid}/front"
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.get(url)
        if resp.status_code == 200:
            return resp.content
    return None
