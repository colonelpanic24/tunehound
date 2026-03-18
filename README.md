# TuneHound

Self-hosted music library manager. Subscribe to artists, automatically discover their discography via MusicBrainz, download audio from YouTube with yt-dlp, and keep your local library organized and tagged.

## Features

- Subscribe to artists and track their full discography (albums, EPs, singles)
- Match existing local folders to MusicBrainz releases on import
- Download albums or individual tracks from YouTube
- Real-time download progress via WebSocket
- Tag files with MusicBrainz metadata and Cover Art Archive artwork
- Browse your library by artist or album with cover art
- SponsorBlock support, cookies for YouTube Premium, proxy support

## Quick Start

Create a `.env` file:

```env
MUSIC_DIR=/path/to/your/music
PORT=8000
```

Then run:

```bash
docker compose up -d
```

Open `http://localhost:8000`.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MUSIC_DIR` | `/mnt/media/music` | Path to your music directory on the host |
| `PORT` | `8000` | Host port to expose |

### Application Settings

All other settings are configured via the **Settings** page in the UI and stored in the database.

**Library & Metadata**

| Setting | Description |
|---------|-------------|
| Album languages | ISO 639-3 language codes to filter releases (e.g. `eng`) |
| Release types | Which release types to track: albums, EPs, singles, broadcasts |
| Min import confidence | MusicBrainz match score threshold (0–100) for bulk library import |

**Downloads**

| Setting | Description |
|---------|-------------|
| Audio format | Output codec: `opus`, `vorbis`, `mp3`, `flac`, `m4a` |
| yt-dlp format | Format selector passed to yt-dlp (presets or custom string) |
| Delay between tracks | Random delay range (seconds) between downloads to avoid rate limits |
| Max retries | Retry attempts per failed track |
| Concurrent fragments | Parallel fragment downloads for DASH/HLS streams |
| Rate limit | Bytes/sec cap (0 = unlimited) |
| Cookies file | Path to a Netscape-format `cookies.txt` for YouTube Premium auth |
| Proxy | SOCKS5 proxy URL |
| Geo-bypass | Enable yt-dlp geo-restriction bypass |
| Search results | Number of YouTube results to try per track (1–10) |
| Search query template | Template with `{artist}`, `{title}`, `{album}` variables |

**SponsorBlock**

Select which SponsorBlock categories to remove from downloaded audio: `music_offtopic`, `sponsor`, `intro`, `outro`, `selfpromo`, `interaction`.

## YouTube Premium / Cookies

To download at higher quality or access region-restricted content, provide a `cookies.txt` in Netscape format (exported from a logged-in YouTube session using a browser extension).

Mount it into the container:

```yaml
# docker-compose.yml
volumes:
  - ./cookies.txt:/data/cookies.txt:ro
```

Then set the cookies file path to `/data/cookies.txt` in Settings → Downloads.

## Development

Requires Python 3.11+, Node 22+, and ffmpeg.

```bash
./dev.sh
```

This starts a tmux session with the backend (port 8000, hot-reload) and frontend dev server (port 5173) in separate windows.

Or use Docker with the dev override:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

## Stack

- **Backend**: Python, FastAPI, SQLAlchemy (async), SQLite, Alembic, yt-dlp
- **Frontend**: React 19, TypeScript, Vite, TanStack Query, Tailwind CSS 4
- **Metadata**: MusicBrainz, Cover Art Archive, TheAudioDB
