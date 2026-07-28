# TCG Card Investments

A shared inventory, sales and profit ledger for a small TCG resale group. All inventory
belongs to the store; members are recorded on transactions as operators, never as owners.

Current inventory, cost basis and realized profit are always **derived from transactions**,
never stored as editable totals.

## Current State

Phase 0 (foundation) is built: members, games, product types, products, and forgiving
trigram search, behind Firebase-authenticated routes.

Phase 1 (purchases, sales, FIFO cost basis) is next. See
[the plan](docs/requirements/) and `docs/GOTCHAS.md` for the stack decisions.

## Stack

- FastAPI backend with **Firebase Auth** ID token verification.
- SQLAlchemy + Alembic + **Neon** PostgreSQL (`NullPool` - see `docs/GOTCHAS.md`).
- Money stored as integer cents; cost basis is FIFO.
- Sentry backend hooks, request IDs, process timing, and security headers.
- Railway service-specific API config.
- CI for lint, migrations, and tests at 100% coverage.

## Start Here

- [Deployment playbook](docs/DEPLOYMENT_TEMPLATE.md): Railway, Neon, Firebase, Sentry,
  shared-vs-project-specific values, and no-watch CI/CD flow.
- [Release guards](docs/RELEASE_GUARDS.md): release checks and mobile distribution rules.
- [Observability](docs/OBSERVABILITY.md): Sentry, Firebase, Railway log triage.
- [Gotchas](docs/GOTCHAS.md): known deployment mistakes and fixes.
- [Agent worktree guide](docs/AGENT_WORKTREE_GUIDE.md): per-agent worktrees and branch
  isolation for Codex, Claude, Gemini, and Antigravity.

## Requirements

- Python 3.11+
- [uv](https://docs.astral.sh/uv/getting-started/installation/)
- Docker Desktop for local Postgres

## Quick Start

```bash
uv sync
copy .env.example .env
docker compose up -d
make db-upgrade
make run
```

If a native PostgreSQL service already owns port 5432 (common on Windows), set
`POSTGRES_HOST_PORT=5433` in `.env` and point `DATABASE_URL` at that port. See
[Gotchas](docs/GOTCHAS.md) — the failure looks like a password error, not a port clash.

For multi-agent work, create the standard local worktrees once after cloning:

```powershell
.\scripts\setup-agent-worktrees.ps1
```

## Common Commands

```bash
make install
make run
make test
make lint
make db-upgrade
make db-revision message="add users"
```

## Deployment Defaults

- Backend hosting: Railway (US East, to sit next to Neon)
- Database: Neon, pooled endpoint for runtime, direct endpoint for Alembic
- Auth: Firebase Auth; accounts are created in the Firebase console
- Backend observability: Sentry

Root `railway.json` is service-neutral. Use `/railway.api.json` for API services. Add a
worker-specific Railway config only after the project has a real worker entrypoint.

## Environment Variables

See `.env.example`. Never commit `.env`, Firebase config files, session files, Railway
variable dumps, or raw logs.

When adding a backend env var, update all of these in the same commit:

- `src/config.py`
- `.env.example`
- `tests/conftest.py`
- `.github/workflows/ci.yml`
