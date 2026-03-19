"""Add file_count to release_groups and index on tracks.release_group_id

Revision ID: 0004
Revises: 0003
Create Date: 2026-03-18
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("release_groups", sa.Column("file_count", sa.Integer(), nullable=True))
    op.create_index("ix_tracks_release_group_id", "tracks", ["release_group_id"])


def downgrade() -> None:
    op.drop_index("ix_tracks_release_group_id", table_name="tracks")
    op.drop_column("release_groups", "file_count")
