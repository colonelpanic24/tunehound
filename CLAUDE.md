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
6. **Version bump** — increment the version (patch for bug fixes, minor for new features). Do NOT increment the major version without consulting the user first.
7. **Branch + commit + push** — create a new feature/release branch, commit all changes with a clear message, and push to remote.
8. **Pull request** — open a PR against main using `gh pr create`.
9. **CI** — after posting the PR, keep polling `gh run list --branch <branch>` until the build is green. Fix any CI failures before considering the release done.
