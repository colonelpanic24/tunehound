"""
Shared test fixtures.

- in-memory SQLite engine / session
- httpx AsyncClient wired to the FastAPI app with the DB dependency overridden
- temporary directory helpers
"""
import os

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_db
from app.models import Artist, ReleaseGroup, Track

# ── In-memory database ────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def engine():
    eng = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def db_session(engine):
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session


# ── Test client ───────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def client(engine):
    """
    httpx.AsyncClient pointed at the FastAPI app with:
    - DB dependency swapped for in-memory SQLite
    - lifespan events skipped (no background worker, no file watcher)
    """
    from app.main import app

    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def _override_get_db():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db

    # Seed the DownloadSettings row so endpoints that read it don't explode
    async with factory() as session:
        from app.models import DownloadSettings
        session.add(DownloadSettings(id=1))
        await session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


# ── Seed helpers ──────────────────────────────────────────────────────────────

async def seed_artist(db: AsyncSession, **kwargs) -> Artist:
    defaults = dict(mbid="a1b2c3d4-0000-0000-0000-000000000001", name="Test Artist")
    defaults.update(kwargs)
    a = Artist(**defaults)
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return a


async def seed_release_group(db: AsyncSession, artist_id: int, **kwargs) -> ReleaseGroup:
    defaults = dict(
        mbid="rg000001-0000-0000-0000-000000000001",
        artist_id=artist_id,
        title="Test Album",
    )
    defaults.update(kwargs)
    rg = ReleaseGroup(**defaults)
    db.add(rg)
    await db.commit()
    await db.refresh(rg)
    return rg


async def seed_track(db: AsyncSession, release_group_id: int, **kwargs) -> Track:
    defaults = dict(
        release_group_id=release_group_id,
        title="Test Track",
        track_number=1,
        disc_number=1,
    )
    defaults.update(kwargs)
    t = Track(**defaults)
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return t
