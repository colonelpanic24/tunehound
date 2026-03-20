#!/usr/bin/env bash
set -e

REPO="$(cd "$(dirname "$0")" && pwd)"
SESSION="tunehound"
DATA_DIR="$HOME/.local/share/tunehound"

# Create local data dir and write a dev .env if one doesn't exist
mkdir -p "$DATA_DIR"
ENV_FILE="$REPO/backend/.env"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
DATABASE_URL=sqlite+aiosqlite:///$DATA_DIR/tunehound.db
DATA_DIR=$DATA_DIR
MUSIC_LIBRARY_PATH=/mnt/media/music
EOF
  echo "Created $ENV_FILE"
fi

# Kill existing session so re-running dev.sh always does a clean restart
tmux kill-session -t "$SESSION" 2>/dev/null || true

tmux new-session -d -s "$SESSION" -x 220 -y 50

# Backend
VENV="$REPO/backend/.venv"
tmux rename-window -t "$SESSION:0" "backend"
tmux send-keys -t "$SESSION:0" "cd '$REPO/backend' && ([ ! -d .venv ] && python3 -m venv .venv; true) && source .venv/bin/activate && pip install -e . -q && alembic upgrade head && uvicorn app.main:app --reload --port 8000" Enter

# Frontend
tmux new-window -t "$SESSION" -n "frontend"
tmux send-keys -t "$SESSION:1" "cd '$REPO/frontend' && npm install --silent && npm run dev" Enter

# Open browser once the frontend dev server is ready
tmux new-window -t "$SESSION" -n "browser"
tmux send-keys -t "$SESSION:2" "echo 'Waiting for frontend...'; until curl -s http://localhost:5174 > /dev/null; do sleep 1; done; xdg-open http://localhost:5174; tmux kill-window -t '$SESSION:2'" Enter

tmux select-window -t "$SESSION:0"

# prefix+R to restart: detaches and reruns this script in the original terminal
tmux bind-key R detach-client -E "cd '$REPO' && '$REPO/dev.sh'"

tmux attach -t "$SESSION"
