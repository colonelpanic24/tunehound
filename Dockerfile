# ── Stage 1: build the React frontend ─────────────────────────────────────────
FROM node:22-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: production image ──────────────────────────────────────────────────
FROM python:3.12-slim

# ffmpeg is required by yt-dlp for audio post-processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps before copying source so layer is cached
COPY backend/pyproject.toml ./
RUN pip install --no-cache-dir .

# Copy backend source
COPY backend/ ./

# Embed the compiled frontend so FastAPI can serve it
COPY --from=frontend-builder /frontend/dist ./static

# Persistent data lives in a volume at /data
RUN mkdir -p /data

EXPOSE 8000

# Run Alembic migrations then start the server
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
