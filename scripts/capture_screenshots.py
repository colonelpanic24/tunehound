"""
Capture README screenshots using Playwright.

Assumes:
  - The demo backend is running on port 8001:
      scripts/start_demo_backend.sh
  - The frontend dev server is running on port 5173 and proxying to :8001:
      VITE_API_BASE=http://localhost:8001 npm run dev   (from frontend/)
    OR just point TUNEHOUND_URL at the backend directly:
      TUNEHOUND_URL=http://localhost:8001 backend/.venv/bin/python3 scripts/capture_screenshots.py

Usage:
    backend/.venv/bin/pip install playwright
    backend/.venv/bin/playwright install chromium
    backend/.venv/bin/python3 scripts/capture_screenshots.py

Screenshots are saved to docs/screenshots/.
"""

import asyncio
import os
from pathlib import Path

BASE_URL = os.environ.get("TUNEHOUND_URL", "http://localhost:5173")
OUT_DIR = Path(__file__).parent.parent / "docs" / "screenshots"
VIEWPORT = {"width": 1440, "height": 900}

PAGES = [
    {
        "name": "library",
        "path": "/",
        "wait_for": "text=Last scan",
        "description": "Library management hub — Import tab with last scan result",
    },
    {
        "name": "artists",
        "path": "/artists",
        "wait_for": "text=Pale Harbor",
        "description": "Artists grid",
    },
    {
        "name": "artist-detail",
        "path": "/artists/1",
        "wait_for": "text=Tidal Architecture",
        "description": "Artist detail — discography and bio",
    },
    {
        "name": "albums",
        "path": "/albums",
        "wait_for": "text=Tidal Architecture",
        "description": "Albums grid",
    },
    {
        "name": "album-detail",
        "path": "/albums/1",
        "wait_for": "text=Breakwater",
        "description": "Album detail — track listing",
    },
    {
        "name": "downloads",
        "path": "/downloads",
        "wait_for": "text=Narrowband",
        "description": "Downloads page — completed and failed jobs",
    },
]


async def capture() -> None:
    from playwright.async_api import async_playwright

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context(
            viewport=VIEWPORT,
            color_scheme="dark",
        )
        page = await context.new_page()

        for spec in PAGES:
            url = f"{BASE_URL}{spec['path']}"
            print(f"  {spec['name']}: {url}")

            await page.goto(url)
            try:
                await page.get_by_text(spec["wait_for"], exact=False).first.wait_for(
                    state="visible", timeout=10_000
                )
            except Exception:
                print(f"    Warning: '{spec['wait_for']}' not found — screenshot may be empty")

            # Settle time for images and animations
            await asyncio.sleep(0.8)

            out_path = OUT_DIR / f"{spec['name']}.png"
            await page.screenshot(path=str(out_path), full_page=False)
            print(f"    -> {out_path}")

        await browser.close()

    print(f"\nDone. {len(PAGES)} screenshots saved to {OUT_DIR}/")


if __name__ == "__main__":
    asyncio.run(capture())
