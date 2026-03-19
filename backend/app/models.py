from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Artist(Base):
    __tablename__ = "artists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mbid: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    sort_name: Mapped[str | None] = mapped_column(String)
    disambiguation: Mapped[str | None] = mapped_column(String)
    image_url: Mapped[str | None] = mapped_column(String)
    wikidata_id: Mapped[str | None] = mapped_column(String)
    bio: Mapped[str | None] = mapped_column(Text)
    folder_name: Mapped[str | None] = mapped_column(String)
    subscribed: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    release_groups: Mapped[list["ReleaseGroup"]] = relationship(
        "ReleaseGroup", back_populates="artist", cascade="all, delete-orphan"
    )


class ReleaseGroup(Base):
    """Represents a MusicBrainz release group (an album, EP, single, etc.)."""

    __tablename__ = "release_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mbid: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    artist_id: Mapped[int] = mapped_column(ForeignKey("artists.id"), nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    # Album, Single, EP, Broadcast, Other
    primary_type: Mapped[str | None] = mapped_column(String)
    # Compilation, Soundtrack, Spokenword, Interview, Audiobook, Live, Remix, DJ-mix, Mixtape/Street
    secondary_types: Mapped[str | None] = mapped_column(String)  # comma-separated
    first_release_date: Mapped[str | None] = mapped_column(String)  # YYYY, YYYY-MM, or YYYY-MM-DD
    cover_art_url: Mapped[str | None] = mapped_column(String)
    folder_path: Mapped[str | None] = mapped_column(String)
    file_count: Mapped[int | None] = mapped_column(Integer)
    cover_art_hash: Mapped[str | None] = mapped_column(String)
    description: Mapped[str | None] = mapped_column(Text)
    watched: Mapped[bool] = mapped_column(Boolean, default=True)
    tracks_fetched: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    artist: Mapped["Artist"] = relationship("Artist", back_populates="release_groups")
    tracks: Mapped[list["Track"]] = relationship(
        "Track", back_populates="release_group", cascade="all, delete-orphan"
    )
    download_jobs: Mapped[list["DownloadJob"]] = relationship(
        "DownloadJob", back_populates="release_group"
    )


class Track(Base):
    __tablename__ = "tracks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mbid: Mapped[str | None] = mapped_column(String)  # recording MBID
    release_group_id: Mapped[int] = mapped_column(
        ForeignKey("release_groups.id"), nullable=False
    )
    title: Mapped[str] = mapped_column(String, nullable=False)
    track_number: Mapped[int | None] = mapped_column(Integer)
    disc_number: Mapped[int] = mapped_column(Integer, default=1)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    # Null if not present on disk
    file_path: Mapped[str | None] = mapped_column(String)

    # Tag snapshot — populated after scanning file tags
    tag_title: Mapped[str | None] = mapped_column(String)
    tag_artist: Mapped[str | None] = mapped_column(String)
    tag_album: Mapped[str | None] = mapped_column(String)
    tag_track_number: Mapped[str | None] = mapped_column(String)
    tag_art_hash: Mapped[str | None] = mapped_column(String)
    tags_scanned_at: Mapped[datetime | None] = mapped_column(DateTime)

    release_group: Mapped["ReleaseGroup"] = relationship(
        "ReleaseGroup", back_populates="tracks"
    )


class DownloadJob(Base):
    __tablename__ = "download_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    release_group_id: Mapped[int | None] = mapped_column(ForeignKey("release_groups.id"))
    # queued | running | completed | failed | cancelled
    status: Mapped[str] = mapped_column(String, default="queued")
    total_tracks: Mapped[int] = mapped_column(Integer, default=0)
    completed_tracks: Mapped[int] = mapped_column(Integer, default=0)
    current_track_title: Mapped[str | None] = mapped_column(String)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)

    release_group: Mapped["ReleaseGroup | None"] = relationship(
        "ReleaseGroup", back_populates="download_jobs"
    )
    track_jobs: Mapped[list["DownloadTrackJob"]] = relationship(
        "DownloadTrackJob", back_populates="job", cascade="all, delete-orphan"
    )


class DownloadTrackJob(Base):
    __tablename__ = "download_track_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("download_jobs.id"), nullable=False)
    track_id: Mapped[int] = mapped_column(ForeignKey("tracks.id"), nullable=False)
    # queued | downloading | completed | failed
    status: Mapped[str] = mapped_column(String, default="queued")
    yt_video_id: Mapped[str | None] = mapped_column(String)
    yt_search_query: Mapped[str | None] = mapped_column(String)
    error_message: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)

    job: Mapped["DownloadJob"] = relationship("DownloadJob", back_populates="track_jobs")
    track: Mapped["Track"] = relationship("Track")


class RetagJob(Base):
    __tablename__ = "retag_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    release_group_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("release_groups.id"))
    status: Mapped[str] = mapped_column(String, default="queued")
    total_tracks: Mapped[int] = mapped_column(Integer, default=0)
    completed_tracks: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    track_jobs: Mapped[list["RetagTrackJob"]] = relationship(
        "RetagTrackJob", back_populates="job", cascade="all, delete-orphan"
    )


class RetagTrackJob(Base):
    __tablename__ = "retag_track_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(Integer, ForeignKey("retag_jobs.id"))
    track_id: Mapped[int] = mapped_column(Integer, ForeignKey("tracks.id"))
    fields: Mapped[str] = mapped_column(String)  # JSON array of field names
    status: Mapped[str] = mapped_column(String, default="queued")
    error_message: Mapped[str | None] = mapped_column(String)
    job: Mapped["RetagJob"] = relationship("RetagJob", back_populates="track_jobs")
    track: Mapped["Track"] = relationship("Track")


class DownloadSettings(Base):
    """Single-row table for user-configurable download settings."""

    __tablename__ = "download_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    audio_format: Mapped[str] = mapped_column(String, default="mp3")
    # yt-dlp format selector
    yt_format: Mapped[str] = mapped_column(String, default="bestaudio")
    delay_min: Mapped[float] = mapped_column(Float, default=5.0)
    delay_max: Mapped[float] = mapped_column(Float, default=15.0)
    # Optional path to a Netscape cookies file for YouTube Premium
    cookies_file: Mapped[str | None] = mapped_column(String)
    # Optional bytes-per-second cap (None = unlimited)
    rate_limit_bps: Mapped[int | None] = mapped_column(Integer)
    # Comma-separated ISO 639-3 language codes to restrict album fetching (e.g. "eng,fra"). Empty = no filter.
    album_languages: Mapped[str] = mapped_column(String, default="eng")
    scan_min_confidence: Mapped[int] = mapped_column(Integer, default=80)
    # yt-dlp retry / performance
    max_retries: Mapped[int] = mapped_column(Integer, default=3)
    concurrent_fragment_downloads: Mapped[int] = mapped_column(Integer, default=1)
    geo_bypass: Mapped[bool] = mapped_column(Boolean, default=False)
    proxy: Mapped[str | None] = mapped_column(String)
    # Comma-separated SponsorBlock categories to cut (e.g. "music_offtopic,sponsor"). Empty = disabled.
    sponsorblock_remove: Mapped[str] = mapped_column(String, default="")
    # Search behaviour
    yt_search_results: Mapped[int] = mapped_column(Integer, default=1)
    search_query_template: Mapped[str] = mapped_column(String, default="{artist} {title} {album}")
    # Comma-separated MusicBrainz release types to index per artist (e.g. "album,ep,single")
    release_types: Mapped[str] = mapped_column(String, default="album,ep")
