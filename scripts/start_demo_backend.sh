#!/usr/bin/env bash
# Start a demo backend instance pointed at the demo data directory.
# Runs on port 8001 so it doesn't conflict with your real backend on 8000.
#
# Usage:
#   scripts/start_demo_backend.sh
#
# Override the demo data dir:
#   DEMO_DATA_DIR=/tmp/tunehound-demo scripts/start_demo_backend.sh

set -e

DEMO_DATA_DIR="${DEMO_DATA_DIR:-$HOME/.local/share/tunehound-demo}"
PORT=8001

cd "$(dirname "$0")/.."

export DATA_DIR="$DEMO_DATA_DIR"
export DATABASE_URL="sqlite+aiosqlite:///$DEMO_DATA_DIR/tunehound.db"
export MUSIC_LIBRARY_PATH="/music"

echo "Starting demo backend on http://localhost:$PORT"
echo "  DATA_DIR=$DATA_DIR"
echo ""
echo "Press Ctrl+C to stop."
echo ""

backend/.venv/bin/python3 -m uvicorn app.main:app \
    --host 127.0.0.1 \
    --port "$PORT" \
    --app-dir backend \
    --no-access-log
