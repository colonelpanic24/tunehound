import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api import albums, artists, downloads, library, retag, stats, ws
from app.api.ws import manager as ws_manager
from app.config import settings
from app.database import AsyncSessionLocal
from app.services import downloader as dl_service
from app.services.library_watcher import start_library_watcher, stop_library_watcher

# ── Background download worker ─────────────────────────────────────────────────

download_queue: asyncio.Queue = asyncio.Queue()
_cancel_events: dict[int, asyncio.Event] = {}


def _signal_cancel(job_id: int) -> bool:
    ev = _cancel_events.get(job_id)
    if ev:
        ev.set()
        return True
    return False


async def _download_worker():
    """
    Single-worker coroutine. Processes one download job at a time so we don't
    hammer YouTube with parallel requests.
    """
    while True:
        job_id = await download_queue.get()
        cancel_event = asyncio.Event()
        _cancel_events[job_id] = cancel_event
        try:
            await dl_service.run_download_job(
                job_id=job_id,
                db_session_factory=AsyncSessionLocal,
                broadcast=ws_manager.broadcast,
                cancel_event=cancel_event,
            )
        except Exception as exc:
            # Should not normally reach here — run_download_job handles its own errors
            print(f"[worker] Unhandled error for job {job_id}: {exc}")
        finally:
            _cancel_events.pop(job_id, None)
            download_queue.task_done()


# ── App lifespan ───────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Wire queue and cancel fn into downloads router
    downloads.set_queue(download_queue)
    downloads.set_cancel_fn(_signal_cancel)

    # Start background worker
    worker_task = asyncio.create_task(_download_worker())

    # Ensure data directories exist
    os.makedirs(_IMAGES_DIR, exist_ok=True)

    # Start filesystem watcher
    loop = asyncio.get_event_loop()
    if os.path.isdir(settings.music_library_path):
        start_library_watcher(settings.music_library_path, loop, AsyncSessionLocal)

    yield

    # Cleanup
    stop_library_watcher()
    worker_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass


# ── FastAPI app ────────────────────────────────────────────────────────────────

app = FastAPI(title="TuneHound", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # fine for a self-hosted local app
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
app.include_router(artists.router, prefix="/api")
app.include_router(albums.router, prefix="/api")
app.include_router(downloads.router, prefix="/api")
app.include_router(library.router, prefix="/api")
app.include_router(stats.router, prefix="/api")
app.include_router(retag.router, prefix="/api")
app.include_router(ws.router)  # /ws (no /api prefix — WebSocket)

# ── Serve locally cached images ────────────────────────────────────────────────

_IMAGES_DIR = os.path.join(settings.data_dir, "images")
app.mount("/images", StaticFiles(directory=_IMAGES_DIR), name="images")

# ── Serve React SPA ────────────────────────────────────────────────────────────

_STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "static")

if os.path.isdir(_STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(_STATIC_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        """Catch-all: return index.html so React Router handles client-side routing."""
        index = os.path.join(_STATIC_DIR, "index.html")
        return FileResponse(index)
