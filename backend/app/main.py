import asyncio
import json
import os
import re
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

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


# ── External URL kill-switch ───────────────────────────────────────────────────
#
# THIS IS AN INTENTIONAL NUCLEAR OPTION.
#
# We cache all external images locally so the browser never has to reach out to
# wikimedia, archive.org, or any other third-party host. This has burned us
# before: buggy code stored raw external URLs in the DB and they leaked through
# to the frontend, causing the browser to make external requests on every page
# load. To make sure that NEVER happens again, this middleware inspects every
# JSON API response body and crashes the entire server process if it finds an
# http:// or https:// URL in a field that is supposed to hold a local path.
#
# Why os._exit instead of raising an exception?
# - A regular exception would be caught by FastAPI and turned into a 500 — the
#   bug would silently continue serving bad data.
# - os._exit(1) is immediate and ungraceful: it bypasses all exception handlers,
#   context managers, and atexit hooks. The process dies instantly. The dev
#   server (uvicorn --reload) will restart it, but the bad response is never
#   sent. You will see the crash in the terminal and know exactly what happened.
#
# Checked fields (the only ones that should ever hold image paths):
#   - image_url  (Artist)
#   - cover_art_url  (ReleaseGroup)
#
# A valid value is either null or a path starting with /images/. Anything
# starting with http is a bug. We die.

_EXTERNAL_URL_RE = re.compile(r"https?://")
_WATCHED_FIELDS = {"image_url", "cover_art_url"}


class ExternalUrlKillSwitch(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)

        # Only inspect JSON responses from our API routes
        content_type = response.headers.get("content-type", "")
        if not request.url.path.startswith("/api/") or "application/json" not in content_type:
            return response

        # Buffer the response body so we can inspect it
        body_bytes = b""
        async for chunk in response.body_iterator:
            body_bytes += chunk

        # Parse and scan for external URLs in watched fields
        try:
            data = json.loads(body_bytes)
        except Exception:
            # Not valid JSON — pass through unchanged
            pass
        else:
            _scan_for_external_urls(data, request.url.path)

        # Reconstruct the response with the original body
        return Response(
            content=body_bytes,
            status_code=response.status_code,
            headers=dict(response.headers),
            media_type=response.media_type,
        )


def _scan_for_external_urls(obj, path: str) -> None:
    """
    Recursively walk a decoded JSON value and check every watched field.
    If an external URL is found, log it loudly and kill the process.
    """
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key in _WATCHED_FIELDS and isinstance(value, str):
                if _EXTERNAL_URL_RE.match(value):
                    # Log before dying so the dev can see exactly what happened
                    print(
                        f"\n\n"
                        f"╔══════════════════════════════════════════════════════╗\n"
                        f"║  KILL-SWITCH TRIGGERED — EXTERNAL URL IN API RESPONSE ║\n"
                        f"╠══════════════════════════════════════════════════════╣\n"
                        f"║  endpoint : {path}\n"
                        f"║  field    : {key}\n"
                        f"║  value    : {value}\n"
                        f"╚══════════════════════════════════════════════════════╝\n",
                        file=sys.stderr,
                        flush=True,
                    )
                    # Die immediately — no exception, no handler, no mercy.
                    os._exit(1)
            elif isinstance(value, (dict, list)):
                _scan_for_external_urls(value, path)
    elif isinstance(obj, list):
        for item in obj:
            _scan_for_external_urls(item, path)


# ── FastAPI app ────────────────────────────────────────────────────────────────

app = FastAPI(title="TuneHound", version="0.1.0", lifespan=lifespan)

# Kill-switch must be added before CORSMiddleware so it runs on the way out
app.add_middleware(ExternalUrlKillSwitch)

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
os.makedirs(_IMAGES_DIR, exist_ok=True)
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
