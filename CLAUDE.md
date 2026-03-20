# TuneHound – Claude Code notes

## Environment

- Always use `python3`, never `python`.
- The backend virtualenv is at `backend/.venv/`. Run Python as `backend/.venv/bin/python3`.
- The DB is at `/home/stefan/tunehound-data/tunehound.db` (SQLite).
- Music library is mounted at `/mnt/media/music` (configurable via `MUSIC_LIBRARY_PATH`).
- The app runs in Docker in production; the `.env` file in `backend/` points at the local dev paths above.

## Stack

- **Backend**: FastAPI + SQLAlchemy async (aiosqlite), Python 3.11
- **Frontend**: React + TypeScript (Vite)
- **Linter**: `ruff` — run as `ruff check <file>` (installed globally, not in the venv)
- **Tests**: run as `DATA_DIR=/tmp/tunehound-test backend/.venv/bin/python3 -m pytest backend/tests/ -q` from the repo root. `DATA_DIR` must point to a writable directory. Required packages (`pytest`, `pytest-asyncio`, `pytest-mock`, `httpx`) are in the `test` extra: `backend/.venv/bin/pip install -e "backend[test]"`.

## Task workflow

When tasks are queued (e.g. via TaskCreate) and the current task finishes:
- Remind the user how many tasks remain waiting.
- Do NOT automatically start the next task.
- Wait for the user to explicitly prompt you to continue.

## Release workflow

When the user says "ready for a new release", "cut a release", "make a PR", or similar, follow these steps in order:

1. **Clean up** — review all changed code for redundant, debug, dead, or test/throwaway code and remove it.
2. **Tests** — add or update specs to cover any new functionality introduced since the last release.
3. **Lint** — run `ruff check` on all changed backend files and `npx tsc --noEmit` on the frontend. Fix any violations before running tests.
4. **Run tests** — run the full test suite and get all tests passing before proceeding.
5. **Docs** — update the README and any inline code comments that are now stale or missing context.
6. **Screenshots** — if any frontend pages changed, retake screenshots using `backend/.venv/bin/python3 scripts/capture_screenshots.py` (assumes dev servers are already running on their default ports). Also:
   - If a major new feature was added that has no screenshot, add a new entry to `PAGES` in `capture_screenshots.py` and include it in the README.
   - If a feature or page was removed, delete the corresponding screenshot file and remove it from the README.
   - Run ESLint (`npx eslint src/`) before taking screenshots to catch any lint errors that would cause CI to fail.
   - Screenshots use the demo database seeded by `scripts/seed_screenshots.py`. If screenshots show availability, make sure the seed data has `on_disk: True` for a realistic mix of albums so availability bars/percentages are non-zero. The `folder_path` on each `ReleaseGroup` is what drives availability in the UI — the seed sets it automatically for `on_disk: True` albums.
7. **Version bump** — increment the version (patch for bug fixes, minor for new features). Do NOT increment the major version without consulting the user first.
8. **Branch + commit + push** — create a new feature/release branch, commit all changes with a clear message, and push to remote.
9. **Pull request** — open a PR against main using `gh pr create`.
10. **CI** — after posting the PR, keep polling `gh run list --branch <branch>` until the build is green. Fix any CI failures before considering the release done.
