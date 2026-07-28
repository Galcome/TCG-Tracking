# production-projects

Starter template for production-grade apps. Clone this for each new project and keep the
deployment, monitoring, and CI/CD shape consistent unless the PRD clearly calls for something
else.

## What This Template Provides

- FastAPI backend with Supabase JWT verification.
- SQLAlchemy + Alembic + PostgreSQL.
- Supabase/Railway pooler-safe database defaults.
- Sentry backend hooks, request IDs, process timing, and security headers.
- Railway service-specific API config, with worker guidance for projects that add one.
- CI for lint, migrations, and tests.
- Mobile/EAS/Firebase deployment guidance for projects that include an Expo app.
  The template does not ship an active mobile distribution workflow because it has no app to build.

## Start Here

- [Deployment template](docs/DEPLOYMENT_TEMPLATE.md): Railway, Supabase, Sentry, Firebase,
  EAS, shared-vs-project-specific values, and no-watch CI/CD flow.
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

- Backend hosting: Railway
- Auth/database: Supabase
- Production database URL: Supavisor session pooler, port `5432`
- Backend observability: Sentry
- Mobile delivery when an Expo app exists: async EAS build -> Railway webhook -> Firebase
  App Distribution

Root `railway.json` is service-neutral. Use `/railway.api.json` for API services. Add a
worker-specific Railway config only after the project has a real worker entrypoint.

## Environment Variables

See `.env.example` and `app/.env.example`. Never commit `.env`, Firebase config files, session
files, Railway variable dumps, or raw logs.

When adding a backend env var, update all of these in the same commit:

- `src/config.py`
- `.env.example`
- `tests/conftest.py`
- `.github/workflows/ci.yml`
