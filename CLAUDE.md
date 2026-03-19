# Claude Code guidelines for TuneHound

## Before creating a PR or release

Run through this checklist in order — do not skip steps or ask the user to do them:

1. **Test coverage** — Review all changed files. Add or update tests for any new behaviour, changed endpoints, or modified components. Run the full suites and confirm they pass.
2. **Lint** — Run `ruff check app/ tests/` (backend) and `npx eslint src/` (frontend). Fix all violations before committing.
3. **Version bump** — Increment `version` in both `backend/pyproject.toml` and `frontend/package.json`. Use semver: patch for bug fixes, minor for new features, major for breaking changes.
4. **README** — Update `README.md` if any user-facing features were added, changed, or removed. The README is a feature reference, not a changelog — rewrite sections to reflect current behaviour rather than appending notes.
5. **Commit, push, open PR** — Stage all changed files explicitly (never `git add -A`), write a clear commit message, push to a feature branch, and open a PR against `main`.

## Git / GitHub

- Remote: `git@github-colonel-panic:colonelpanic24/tunehound.git`
- GitHub account: `colonelpanic24`
- `gh` CLI is authenticated as `colonelpanic24`
- Always use the `github-colonel-panic` SSH host alias — never plain `github.com` for this repo

## Running tests

```bash
# Backend (from backend/)
python3 -m pytest

# Frontend (from frontend/)
npx vitest run
```

## Running linters

```bash
# Backend (from backend/)
ruff check app/ tests/

# Frontend (from frontend/)
npx eslint src/
```
