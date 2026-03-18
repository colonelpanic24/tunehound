"""squashed initial schema

Revision ID: 0001_squashed
Revises:
Create Date: 2026-03-16

"""
from alembic import op
import sqlalchemy as sa

revision = "0001_squashed"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "artists",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("mbid", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("sort_name", sa.String(), nullable=True),
        sa.Column("disambiguation", sa.String(), nullable=True),
        sa.Column("image_url", sa.String(), nullable=True),
        sa.Column("wikidata_id", sa.String(), nullable=True),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("folder_name", sa.String(), nullable=True),
        sa.Column("subscribed", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("mbid"),
    )
    op.create_table(
        "download_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("audio_format", sa.String(), nullable=False),
        sa.Column("yt_format", sa.String(), nullable=False),
        sa.Column("delay_min", sa.Float(), nullable=False),
        sa.Column("delay_max", sa.Float(), nullable=False),
        sa.Column("cookies_file", sa.String(), nullable=True),
        sa.Column("rate_limit_bps", sa.Integer(), nullable=True),
        sa.Column("album_languages", sa.String(), nullable=False, server_default="eng"),
        sa.Column("scan_min_confidence", sa.Integer(), nullable=False, server_default="80"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "release_groups",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("mbid", sa.String(), nullable=False),
        sa.Column("artist_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("primary_type", sa.String(), nullable=True),
        sa.Column("secondary_types", sa.String(), nullable=True),
        sa.Column("first_release_date", sa.String(), nullable=True),
        sa.Column("cover_art_url", sa.String(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("watched", sa.Boolean(), nullable=False),
        sa.Column("tracks_fetched", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["artist_id"], ["artists.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("mbid"),
    )
    op.create_table(
        "download_jobs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("release_group_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("total_tracks", sa.Integer(), nullable=False),
        sa.Column("completed_tracks", sa.Integer(), nullable=False),
        sa.Column("current_track_title", sa.String(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["release_group_id"], ["release_groups.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "tracks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("mbid", sa.String(), nullable=True),
        sa.Column("release_group_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("track_number", sa.Integer(), nullable=True),
        sa.Column("disc_number", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("file_path", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["release_group_id"], ["release_groups.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "download_track_jobs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("job_id", sa.Integer(), nullable=False),
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("yt_video_id", sa.String(), nullable=True),
        sa.Column("yt_search_query", sa.String(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["job_id"], ["download_jobs.id"]),
        sa.ForeignKeyConstraint(["track_id"], ["tracks.id"]),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("download_track_jobs")
    op.drop_table("tracks")
    op.drop_table("download_jobs")
    op.drop_table("release_groups")
    op.drop_table("download_settings")
    op.drop_table("artists")
