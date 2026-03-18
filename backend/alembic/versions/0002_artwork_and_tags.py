"""artwork and tag snapshot

Revision ID: 0002
Revises: 0001_squashed
Create Date: 2026-03-17
"""
from alembic import op
import sqlalchemy as sa

revision = '0002'
down_revision = '0001_squashed'
branch_labels = None
depends_on = None

def upgrade():
    # folder_path and cover_art_hash on release_groups
    op.add_column('release_groups', sa.Column('folder_path', sa.String(), nullable=True))
    op.add_column('release_groups', sa.Column('cover_art_hash', sa.String(), nullable=True))

    # tag snapshot columns on tracks
    op.add_column('tracks', sa.Column('tag_title', sa.String(), nullable=True))
    op.add_column('tracks', sa.Column('tag_artist', sa.String(), nullable=True))
    op.add_column('tracks', sa.Column('tag_album', sa.String(), nullable=True))
    op.add_column('tracks', sa.Column('tag_track_number', sa.String(), nullable=True))
    op.add_column('tracks', sa.Column('tag_art_hash', sa.String(), nullable=True))
    op.add_column('tracks', sa.Column('tags_scanned_at', sa.DateTime(), nullable=True))

    # retag_jobs table
    op.create_table(
        'retag_jobs',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('release_group_id', sa.Integer(), sa.ForeignKey('release_groups.id'), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='queued'),
        sa.Column('total_tracks', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('completed_tracks', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('error_message', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
    )

    # retag_track_jobs table
    op.create_table(
        'retag_track_jobs',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('job_id', sa.Integer(), sa.ForeignKey('retag_jobs.id'), nullable=False),
        sa.Column('track_id', sa.Integer(), sa.ForeignKey('tracks.id'), nullable=False),
        sa.Column('fields', sa.String(), nullable=False),  # JSON array
        sa.Column('status', sa.String(), nullable=False, server_default='queued'),
        sa.Column('error_message', sa.String(), nullable=True),
    )

def downgrade():
    op.drop_table('retag_track_jobs')
    op.drop_table('retag_jobs')
    op.drop_column('tracks', 'tags_scanned_at')
    op.drop_column('tracks', 'tag_art_hash')
    op.drop_column('tracks', 'tag_track_number')
    op.drop_column('tracks', 'tag_album')
    op.drop_column('tracks', 'tag_artist')
    op.drop_column('tracks', 'tag_title')
    op.drop_column('release_groups', 'cover_art_hash')
    op.drop_column('release_groups', 'folder_path')
