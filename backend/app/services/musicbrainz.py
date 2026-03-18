"""
Thin async wrapper around musicbrainzngs.

musicbrainzngs is synchronous; we run it in a thread pool so it doesn't block
the event loop.
"""

import asyncio
from functools import partial

import musicbrainzngs

from app.config import settings

musicbrainzngs.set_useragent(
    settings.musicbrainz_app_name,
    settings.musicbrainz_app_version,
    settings.musicbrainz_contact,
)


async def _run(fn, *args, **kwargs):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(fn, *args, **kwargs))


# ── Artist search ──────────────────────────────────────────────────────────────

async def search_artists(query: str, limit: int = 10) -> list[dict]:
    result = await _run(musicbrainzngs.search_artists, artist=query, limit=limit)
    artists = []
    for a in result.get("artist-list", []):
        artists.append(
            {
                "mbid": a["id"],
                "name": a["name"],
                "sort_name": a.get("sort-name", a["name"]),
                "disambiguation": a.get("disambiguation"),
                "score": int(a.get("ext:score", 0)),
            }
        )
    return artists


async def get_artist(mbid: str) -> dict:
    result = await _run(
        musicbrainzngs.get_artist_by_id,
        mbid,
        includes=["url-rels"],
    )
    return result["artist"]


# ── Release groups ─────────────────────────────────────────────────────────────

DISCOGRAPHY_TYPES = ["album", "ep"]


async def _release_group_ids_for_languages(artist_mbid: str, languages: list[str]) -> set[str]:
    """
    Return the set of release group MBIDs that have at least one release whose
    text-representation language is in ``languages`` (ISO 639-3, e.g. "eng").

    Uses browse_releases (which carries text-representation) rather than
    browse_release_groups, because the latter doesn't support a releases include.
    """
    lang_set = {lang.lower() for lang in languages}
    rg_ids: set[str] = set()
    offset = 0
    limit = 100

    while True:
        result = await _run(
            musicbrainzngs.browse_releases,
            artist=artist_mbid,
            includes=["release-groups"],
            limit=limit,
            offset=offset,
        )
        releases = result.get("release-list", [])
        for release in releases:
            lang = release.get("text-representation", {}).get("language", "")
            if lang.lower() in lang_set:
                rg = release.get("release-group", {})
                if rg:
                    rg_ids.add(rg["id"])
        if len(releases) < limit:
            break
        offset += limit

    return rg_ids


async def get_release_groups(
    artist_mbid: str,
    languages: list[str] | None = None,
    release_types: list[str] | None = None,
) -> list[dict]:
    """Return release groups for an artist, handling pagination.

    If ``languages`` is provided (e.g. ``["eng"]``), only release groups that have
    at least one release whose text-representation language matches are returned.
    Language codes are ISO 639-3 (e.g. "eng", "fra", "jpn").

    If ``release_types`` is provided (e.g. ``["album", "ep", "single"]``), only
    those types are fetched. Defaults to DISCOGRAPHY_TYPES (album + ep).
    """
    types = release_types or DISCOGRAPHY_TYPES
    groups = []
    offset = 0
    limit = 100

    while True:
        result = await _run(
            musicbrainzngs.browse_release_groups,
            artist=artist_mbid,
            release_type=types,
            limit=limit,
            offset=offset,
        )
        batch = result.get("release-group-list", [])
        groups.extend(batch)
        if len(batch) < limit:
            break
        offset += limit

    if languages:
        allowed_ids = await _release_group_ids_for_languages(artist_mbid, languages)
        groups = [g for g in groups if g["id"] in allowed_ids]

    return groups


# ── Tracks for a release group ─────────────────────────────────────────────────

async def get_tracks_for_release_group(release_group_mbid: str) -> list[dict]:
    """
    Find the canonical release for this release group and return its tracks.
    Prefers official releases, earliest date, smallest number of discs.
    """
    result = await _run(
        musicbrainzngs.browse_releases,
        release_group=release_group_mbid,
        includes=["recordings", "release-groups"],
        limit=100,
    )
    releases = result.get("release-list", [])
    if not releases:
        return []

    # Pick the best release: prefer status=Official, then earliest date
    def _sort_key(r):
        status_rank = 0 if r.get("status") == "Official" else 1
        date = r.get("date", "9999")
        return (status_rank, date)

    releases.sort(key=_sort_key)
    best = releases[0]

    tracks = []
    for medium in best.get("medium-list", []):
        disc_number = int(medium.get("position", 1))
        for t in medium.get("track-list", []):
            recording = t.get("recording", {})
            length = recording.get("length") or t.get("length")
            tracks.append(
                {
                    "mbid": recording.get("id"),
                    "title": t.get("title") or recording.get("title", ""),
                    "track_number": int(t.get("number", t.get("position", 0))),
                    "disc_number": disc_number,
                    "duration_ms": int(length) if length else None,
                }
            )
    return tracks


# ── TheAudioDB bio / description lookup ───────────────────────────────────────

async def get_artist_bio(mbid: str) -> str | None:
    """Fetch artist biography (EN) from TheAudioDB."""
    import httpx
    headers = {"User-Agent": f"{settings.musicbrainz_app_name}/{settings.musicbrainz_app_version} ({settings.musicbrainz_contact})"}
    try:
        async with httpx.AsyncClient(timeout=10, headers=headers) as client:
            resp = await client.get(
                "https://www.theaudiodb.com/api/v1/json/2/artist-mb.php",
                params={"i": mbid},
            )
            if resp.status_code == 200:
                artists = resp.json().get("artists") or []
                if artists:
                    return artists[0].get("strBiography") or artists[0].get("strBiographyEN") or None
    except Exception:
        pass
    return None


async def get_release_group_description(mbid: str) -> str | None:
    """Fetch album description (EN) from TheAudioDB."""
    import httpx
    headers = {"User-Agent": f"{settings.musicbrainz_app_name}/{settings.musicbrainz_app_version} ({settings.musicbrainz_contact})"}
    try:
        async with httpx.AsyncClient(timeout=10, headers=headers) as client:
            resp = await client.get(
                "https://www.theaudiodb.com/api/v1/json/2/album-mb.php",
                params={"i": mbid},
            )
            if resp.status_code == 200:
                albums = resp.json().get("album") or []
                if albums:
                    return albums[0].get("strDescription") or albums[0].get("strDescriptionEN") or None
    except Exception:
        pass
    return None


# ── Artist image lookup ────────────────────────────────────────────────────────

async def get_artist_image_url(artist_data: dict) -> str | None:
    """
    Return a URL for the artist's photo.

    Strategy:
      1. TheAudioDB — uses MusicBrainz IDs, has curated artist thumbnail photos.
         Free API key "2" is their public/non-commercial key.
      2. Wikidata P18 — fallback; encyclopedic "main image", often lower quality.
    """
    import httpx

    mbid = artist_data.get("id")
    headers = {"User-Agent": f"{settings.musicbrainz_app_name}/{settings.musicbrainz_app_version} ({settings.musicbrainz_contact})"}

    # 1. TheAudioDB
    if mbid:
        try:
            async with httpx.AsyncClient(timeout=10, headers=headers) as client:
                resp = await client.get(
                    "https://www.theaudiodb.com/api/v1/json/2/artist-mb.php",
                    params={"i": mbid},
                )
                if resp.status_code == 200:
                    artists = resp.json().get("artists") or []
                    if artists and artists[0].get("strArtistThumb"):
                        return artists[0]["strArtistThumb"]
        except Exception:
            pass

    # 2. Wikidata P18 fallback
    wikidata_id = None
    for rel in artist_data.get("url-relation-list", []):
        url = rel.get("target", "")
        if "wikidata.org/wiki/Q" in url:
            wikidata_id = url.split("/")[-1]
            break

    if not wikidata_id:
        return None

    try:
        async with httpx.AsyncClient(timeout=10, headers=headers) as client:
            resp = await client.get(
                "https://www.wikidata.org/w/api.php",
                params={"action": "wbgetentities", "ids": wikidata_id, "props": "claims", "format": "json"},
            )
            resp.raise_for_status()
            data = resp.json()

        entity = data.get("entities", {}).get(wikidata_id, {})
        p18 = entity.get("claims", {}).get("P18", [])
        if p18:
            filename = p18[0]["mainsnak"]["datavalue"]["value"].replace(" ", "_")
            return f"https://commons.wikimedia.org/wiki/Special:FilePath/{filename}?width=400"
    except Exception:
        pass

    return None
