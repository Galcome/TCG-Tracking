# Pre-Ship Check

Run this before declaring any feature done. Go through every item. Do not skip.

## 1 — Code Quality
```bash
uv run ruff check .
```
Fix any errors before continuing. Warnings are acceptable, errors are not.

## 2 — Tests
```bash
uv run pytest --cov=src --cov-report=term-missing --cov-fail-under=100
```
All tests must pass and coverage must be 100%. No tests = blocker. Do not ship.

## 3 — Environment Variables
- Open `.env.example`
- Confirm every variable used in `src/config.py` is listed there
- If a new var was added during this build, add it to `.env.example` now

## 4 — No Hardcoded Values
Search for anything that should be an env var but isn't:
```bash
grep -r "localhost" src/
grep -r "password" src/
grep -r "secret" src/
```
Investigate any matches.

## 5 — Migrations Applied
```bash
uv run alembic current
uv run alembic heads
```
`current` and `heads` should match. If not, run `uv run alembic upgrade head`.

## 6 — .env Not Committed
```bash
git status
```
Confirm `.env` does not appear in staged or untracked files.

## 7 — Summary
Report back:
- Items that passed ✓
- Items that failed or were flagged ✗
- Any gaps noted (e.g. no tests yet)
- Whether the feature is ready to ship or needs more work

**Do not tell Joseph it's done until all items are green or gaps are acknowledged.**
