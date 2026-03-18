from datetime import datetime

from pydantic import BaseModel

# ── Artist ─────────────────────────────────────────────────────────────────────

class ArtistBase(BaseModel):
    name: str
    sort_name: str | None = None
    disambiguation: str | None = None
    image_url: str | None = None
    wikidata_id: str | None = None
    bio: str | None = None


class ArtistCreate(ArtistBase):
    mbid: str


class ArtistRematch(BaseModel):
    mbid: str


class ArtistOut(ArtistBase):
    id: int
    mbid: str
    folder_name: str | None = None
    subscribed: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Release Group (Album / EP / Single) ────────────────────────────────────────

class ReleaseGroupOut(BaseModel):
    id: int
    mbid: str
    artist_id: int
    title: str
    primary_type: str | None
    secondary_types: str | None
    first_release_date: str | None
    cover_art_url: str | None
    folder_path: str | None = None
    cover_art_hash: str | None = None
    description: str | None = None
    watched: bool
    tracks_fetched: bool
    track_count: int = 0

    model_config = {"from_attributes": True}


class ReleaseGroupUpdate(BaseModel):
    watched: bool | None = None


# ── Track ──────────────────────────────────────────────────────────────────────

class TrackOut(BaseModel):
    id: int
    mbid: str | None
    release_group_id: int
    title: str
    track_number: int | None
    disc_number: int
    duration_ms: int | None
    file_path: str | None
    tag_title: str | None = None
    tag_artist: str | None = None
    tag_album: str | None = None
    tag_track_number: str | None = None
    tag_art_hash: str | None = None
    tags_scanned_at: datetime | None = None

    model_config = {"from_attributes": True}


# ── Download ───────────────────────────────────────────────────────────────────

class DownloadTrackJobOut(BaseModel):
    id: int
    job_id: int
    track_id: int
    status: str
    yt_video_id: str | None
    yt_search_query: str | None
    error_message: str | None
    started_at: datetime | None
    completed_at: datetime | None

    model_config = {"from_attributes": True}


class DownloadJobOut(BaseModel):
    id: int
    release_group_id: int | None
    status: str
    total_tracks: int
    completed_tracks: int
    current_track_title: str | None
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    track_jobs: list[DownloadTrackJobOut] = []

    model_config = {"from_attributes": True}


class DownloadJobCreate(BaseModel):
    release_group_id: int


class DownloadTrackJobCreate(BaseModel):
    track_id: int


# ── Settings ───────────────────────────────────────────────────────────────────

class DownloadSettingsOut(BaseModel):
    id: int
    audio_format: str
    yt_format: str
    delay_min: float
    delay_max: float
    cookies_file: str | None
    rate_limit_bps: int | None
    album_languages: str
    scan_min_confidence: int
    max_retries: int
    concurrent_fragment_downloads: int
    geo_bypass: bool
    proxy: str | None
    sponsorblock_remove: str
    yt_search_results: int
    search_query_template: str
    release_types: str

    model_config = {"from_attributes": True}


class DownloadSettingsUpdate(BaseModel):
    audio_format: str | None = None
    yt_format: str | None = None
    delay_min: float | None = None
    delay_max: float | None = None
    cookies_file: str | None = None
    rate_limit_bps: int | None = None
    album_languages: str | None = None
    scan_min_confidence: int | None = None
    max_retries: int | None = None
    concurrent_fragment_downloads: int | None = None
    geo_bypass: bool | None = None
    proxy: str | None = None
    sponsorblock_remove: str | None = None
    yt_search_results: int | None = None
    search_query_template: str | None = None
    release_types: str | None = None


# ── Library scan / import ─────────────────────────────────────────────────────

class ImportArtist(BaseModel):
    mbid: str
    folder: str


class ImportRequest(BaseModel):
    artists: list[ImportArtist]


class DiskFolder(BaseModel):
    folder_name: str
    folder_path: str
    file_count: int


class MatchedAlbum(BaseModel):
    release_group: "ReleaseGroupOut"
    folder_path: str
    file_count: int


class ArtistDiskStatus(BaseModel):
    matched: list[MatchedAlbum]
    missing: list["ReleaseGroupOut"]
    unmatched_folders: list[DiskFolder]


# ── MusicBrainz search results (not stored) ────────────────────────────────────

class MBArtistCandidate(BaseModel):
    mbid: str
    name: str
    sort_name: str
    disambiguation: str | None
    score: int


# ── Artwork picker ─────────────────────────────────────────────────────────────

class ArtworkOption(BaseModel):
    source: str
    label: str
    url: str
    thumbnail_url: str
    front: bool = False


# ── Tag status ─────────────────────────────────────────────────────────────────

class TagFieldStatus(BaseModel):
    field: str
    expected: str | None
    actual: str | None


class TrackTagStatus(BaseModel):
    track_id: int
    file_path: str | None
    tags_scanned_at: datetime | None
    in_sync: bool
    issues: list[TagFieldStatus]


class AlbumTagStatusOut(BaseModel):
    release_group_id: int
    tracks: list[TrackTagStatus]


# ── Retag jobs ─────────────────────────────────────────────────────────────────

class RetagTrackJobIn(BaseModel):
    track_id: int
    fields: list[str]


class RetagJobIn(BaseModel):
    release_group_id: int
    track_jobs: list[RetagTrackJobIn]


class RetagTrackJobOut(BaseModel):
    id: int
    track_id: int
    fields: list[str]
    status: str
    error_message: str | None
    model_config = {"from_attributes": True}


class RetagJobOut(BaseModel):
    id: int
    release_group_id: int | None
    status: str
    total_tracks: int
    completed_tracks: int
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    track_jobs: list[RetagTrackJobOut] = []
    model_config = {"from_attributes": True}


