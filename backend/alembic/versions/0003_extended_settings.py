"""Extended download and search settings

Revision ID: 0003
Revises: 0002
Create Date: 2026-03-17
"""
from alembic import op
import sqlalchemy as sa

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('download_settings', sa.Column('max_retries', sa.Integer(), nullable=False, server_default='3'))
    op.add_column('download_settings', sa.Column('concurrent_fragment_downloads', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('download_settings', sa.Column('geo_bypass', sa.Boolean(), nullable=False, server_default='0'))
    op.add_column('download_settings', sa.Column('proxy', sa.String(), nullable=True))
    op.add_column('download_settings', sa.Column('sponsorblock_remove', sa.String(), nullable=False, server_default=''))
    op.add_column('download_settings', sa.Column('yt_search_results', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('download_settings', sa.Column('search_query_template', sa.String(), nullable=False, server_default='{artist} {title} {album}'))
    op.add_column('download_settings', sa.Column('release_types', sa.String(), nullable=False, server_default='album,ep'))


def downgrade():
    op.drop_column('download_settings', 'release_types')
    op.drop_column('download_settings', 'search_query_template')
    op.drop_column('download_settings', 'yt_search_results')
    op.drop_column('download_settings', 'sponsorblock_remove')
    op.drop_column('download_settings', 'proxy')
    op.drop_column('download_settings', 'geo_bypass')
    op.drop_column('download_settings', 'concurrent_fragment_downloads')
    op.drop_column('download_settings', 'max_retries')
