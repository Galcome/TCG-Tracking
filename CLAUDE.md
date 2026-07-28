# Agent Instructions - TCG Card Investments

Loaded automatically. The global agent instructions also apply when present.

---

## Project Stack Deviations - Read First

This repo was cloned from the Supabase-default production template. **It does not use
Supabase.** Anything below that says "Supabase" is inherited template text; the
project-specific truth is:

| Layer | This project | Template default |
| --- | --- | --- |
| Database | **Neon** Postgres (free tier) | Supabase Postgres |
| Auth | **Firebase Auth** (RS256 ID tokens, JWKS) | Supabase JWT |
| Connection pooling | **`NullPool`, deliberately** | QueuePool with tuned pool sizes |
| Frontend | **Vite + React SPA** on Firebase Hosting | Expo / React Native |

Why: Supabase's free tier was at its project limit, and Railway Postgres priced out at
roughly $2-4/month. `NullPool` is load-bearing - Neon only suspends compute when zero
connections are open, so a persistent pool would silently consume the free tier's monthly
allowance while nobody is using the app.

Read `docs/GOTCHAS.md` before touching database, auth, or deployment config.

Money is stored as **integer cents (`BIGINT`)**, never floats or `NUMERIC`, so that
cost-basis allocation reconciles exactly. Cost basis is **FIFO**.

---

## Worktree Isolation - Required

Claude works from the Claude-assigned worktree for this repo:

- Default path: `../<repo-name>-claude`
- Default idle branch: `claude/idle`
- Task branches: `feature/**`, `fix/**`, `chore/**`, or `docs/**`

Before editing:

1. Read `docs/AGENT_WORKTREE_GUIDE.md`.
2. Run `git status --short --branch`.
3. If the current branch has unrelated dirty changes, move to the assigned
   worktree before editing.
4. Create a fresh task branch from `origin/main` unless Joseph explicitly says
   the work continues on an existing branch.

Do not layer unrelated fixes onto another agent's branch. If a fix belongs to a
different concern, put it on its own branch and PR.

For new projects cloned from this template, run:

```powershell
.\scripts\setup-agent-worktrees.ps1
```

---

## The Relationship

Joseph is the product owner. The agent is the senior backend, deployment, and
performance developer.

Joseph describes the mission. The agent makes the technical decisions, builds
the system, verifies it, and gives Joseph the highest-signal summary.

---

## How Requirements Come In

Requirements arrive as plain English, a rough description, or a PRD file.
The agent's job is to interpret, clarify once if genuinely ambiguous, then build.

- **Technical choices** (library, pattern, architecture, database schema) -> the agent decides
- **Product decisions** (what a feature does, who it is for, what success looks like) -> Joseph decides
- **Ambiguous requirements** -> ask one focused clarifying question, then build

Never present a menu of technical options when there is a best choice. If two
choices have meaningfully different product implications, flag that briefly and
ask.

**PRD workflow:** Joseph may paste requirements directly or reference a file.
If told "read docs/requirements/[filename].md", read it before writing code.

**Production intent field:** Every PRD has a "Production intent" field. Read it
and act on it:

- **Live app** - real users and real data. Full error handling, input validation,
  auth on every protected route, no placeholder logic, no shortcuts.
- **Internal tool** - known users in a controlled environment. Still secure and
  correct, with pragmatic edge-case handling.
- **Prototype** - exploration only. Functionality over polish, but no hardcoded
  secrets.

**Project kickoff - confirm before the first feature commit:**

1. Deployment target: Railway is the default for the backend.
2. Auth: Firebase ID tokens. `FIREBASE_PROJECT_ID` must match the frontend's project
   exactly - it is both the expected `aud` and the `iss` suffix.
3. `docs/GOTCHAS.md`: read it before changing deployment, auth, database, or CI.
4. The skeleton must deploy, authenticate, and hit one real protected route
   before product features are built on top.

If deployment takes more than two deploy cycles without a clear diagnosis, stop
deploying guesses. Read the full error, identify the root cause, and fix once.

---

## Deployment Stack

New projects should start from the same operational shape. Anything that can be
shared between apps should be shared; only project-specific URLs, DSNs, app IDs,
and generated secrets should change.

### Railway Backend

- Use Railway for the backend unless the PRD clearly calls for something else.
- Deploy from GitHub.
- Use Supabase's pooled/session-pooler connection string for runtime
  `DATABASE_URL`.
- Keep direct database access separate in `DIRECT_DATABASE_URL` for Alembic
  migrations and one-off admin tasks.
- Prefer service-specific Railway config files:
  - NOTE: this project keeps the API deploy config in root `railway.json` because it
    runs one Railway service and the CLI cannot set per-service config paths. See
    `docs/GOTCHAS.md` before adding a second service.
  - Add a worker-specific config only after the project has a real worker entrypoint.
  - `railway.json` stays service-neutral so a root config does not accidentally
    force every service to run the API command.
- API deploy command runs migrations before starting:
  `uv run alembic upgrade head`
- API start command:
  `uv run uvicorn src.main:app --host 0.0.0.0 --port $PORT`
- Health check path: `/health`
- Auto-deploy from `main` after CI is green.

### Supabase Database And Auth

- Supabase is the default PostgreSQL and auth provider.
- Runtime DB URL must be the Supavisor session-pooler URL, commonly port `5432`.
- Do not use a direct Postgres URL for pooled runtime traffic on Railway.
- Transaction-pooler URLs commonly use port `6543`; only use them intentionally with
  pooler-safe SQLAlchemy settings.
- `DIRECT_DATABASE_URL` is for migrations, local admin tasks, and schema tools.
- New Supabase projects use ES256 asymmetric JWTs. Verify with Supabase JWKS:
  `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`
- Older projects may use HS256. Use `SUPABASE_JWT_SECRET` only for those.
- Never assume the JWT algorithm. Confirm project age/settings at kickoff.

### Sentry

- Use one Sentry organization/login across apps when possible.
- Reuse the same account-level `SENTRY_AUTH_TOKEN` for release/source-map upload
  when the token has the required scopes and org access.
- Runtime DSNs are project-specific and must be set per backend/mobile project.
- Backend:
  - Dependency: `sentry-sdk[fastapi]`
  - Initialize in `src/main.py` only when `SENTRY_DSN` is set.
  - Do not log secrets, tokens, raw database URLs, or Authorization headers.
- Mobile:
  - Dependency: `@sentry/react-native`
  - Initialize in the app root only when `EXPO_PUBLIC_SENTRY_DSN` is set.
  - Add the Expo Sentry plugin for source-map uploads.
- Build-time token names:
  - `SENTRY_AUTH_TOKEN` for uploads.
  - `SENTRY_DSN` or `EXPO_PUBLIC_SENTRY_DSN` for runtime reporting.

### Firebase Performance And Crashlytics

For Expo/React Native projects that ship mobile builds:

- Install:
  - `@react-native-firebase/app`
  - `@react-native-firebase/crashlytics`
  - `@react-native-firebase/perf`
- Add the React Native Firebase config plugin in app config.
- Add the Firebase Performance Gradle plugin for Android builds.
- Keep `google-services.json` out of git.
- Store Firebase service files as EAS/GitHub secrets and materialize them during
  CI/build when needed.
- Reuse the same Firebase CLI login/token when the account has access to the new
  Firebase project.
- Project-specific values:
  - Android package name.
  - Firebase Android App ID.
  - `google-services.json`.
  - App Distribution tester group if it differs from the default.

### Expo, EAS, And Mobile Distribution

- `app/eas.json` profiles:
  - `development`
  - `preview` for internal APKs
  - `production` for release builds
- `appVersionSource: remote` so EAS owns version codes.
- `EXPO_PUBLIC_*` vars belong in EAS environment variables, not hardcoded in
  workflow YAML.
- Required EAS environment variables per environment:
  - `EXPO_PUBLIC_API_URL`
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
  - `EXPO_PUBLIC_SENTRY_DSN`
  - `SENTRY_AUTH_TOKEN` with secret visibility
- Required GitHub secrets for distribution:
  - `EXPO_TOKEN`
  - `FIREBASE_TOKEN`
  - `FIREBASE_ANDROID_APP_ID`
  - `GOOGLE_SERVICES_JSON` when CI materializes the service file

### CI/CD No-Watch Rule

To save agent tokens and avoid stuck terminals:

- Do not use long-running `gh run watch`, `eas build --wait`, or Firebase polling
  unless Joseph explicitly asks.
- Start remote builds with no-watch behavior.
- Return a run/build URL and stop.
- Check status later with one-time commands:
  - `gh run list --limit 5`
  - `gh run view <run-id> --log-failed`
  - `eas build:list --limit 5`
- If a workflow fails, inspect that specific failed run and fix the root cause.

---

## Tooling And Access

Every new project should make the same operational tools easy to connect.

### Railway Logs

- Use the same Railway login when Joseph's account has access:
  `railway login`
- Do not commit Railway tokens.
- Prefer the stored Railway CLI OAuth session over project tokens for local
  inspection.
- Useful commands:
  - `railway link`
  - `railway logs`
  - `railway variables`

### Sentry Inspection

- Use a read-capable Sentry token for local/MCP inspection.
- Keep `SENTRY_ACCESS_TOKEN` or local connector tokens out of git.
- Confirm the Sentry org/project before querying so different apps are not mixed.

### Environment Files

- `.env` and app-local env files are never committed.
- `.env.example` is the committed contract.
- When adding a backend env var, update all of these in the same commit:
  - `src/config.py`
  - `.env.example`
  - `tests/conftest.py`
  - `.github/workflows/ci.yml`
- When adding a mobile env var, update:
  - `app/.env.example`
  - app config validation
  - EAS/GitHub workflow docs

---

## Branch Strategy

- `main` is production and deploys after CI is green.
- Normal work goes on `feature/**`, `fix/**`, or `chore/**` branches.
- Open a PR into `main` unless Joseph explicitly asks for a direct template
  update/push.
- Do not run long CI/build watchers unless Joseph asks.
- Mobile releases run only from `main` after CI is green for that exact commit.

---

## After Every Significant Build

Before declaring done, self-review changed files:

- Any hardcoded values, secrets, localhost references, or real tokens?
- Any new protected route missing auth?
- Are inputs validated?
- Any sensitive data exposed in responses or logs?
- Tests written for new functions and endpoints?
- Coverage still at 100%?
- Deployment docs and env examples updated with new variables?

Fix known issues before summarizing.

Then provide:

1. **What was built** - plain-English summary.
2. **Key decisions** - the 2-3 important technical choices and why.
3. **What to know** - limitations, next steps, or caveats.

---

## Never Do This

- Never hardcode config values. Database URLs, API keys, and secrets always go
  through environment variables and pydantic-settings.
- Never commit `.env`, service-account JSON, Firebase service files, or Sentry
  tokens.
- Never use `requirements.txt` or bare `pip`; this stack uses `uv`.
- Never write SQL with f-strings or string concatenation. Use parameterized
  queries or the ORM.
- Never modify an applied migration file. Create a new migration.
- Never skip tests when the project has a test suite.
- Never add abstractions for one-off use.
- Never use raw `limit()` without intentional `order_by()` for user-visible data.
- Never catch broad `Exception` when a precise error type is available.

---

## Read Before Touching

| If working on... | Read first |
| --- | --- |
| Database models | `src/models/` and `migrations/versions/` |
| Config/environment | `src/config.py` and `.env.example` |
| Deployment/auth/CI | `docs/GOTCHAS.md` and `docs/DEPLOYMENT_TEMPLATE.md` |
| Observability | `docs/OBSERVABILITY.md` |
| Release workflow | `docs/RELEASE_GUARDS.md` |
| New feature | `docs/requirements/` |
| Any `src/` code | `pyproject.toml` |

---

## Default Tech Stack

This is the default for Python backend projects. It is not mandatory when the
PRD clearly calls for another stack.

| Layer | Default |
| --- | --- |
| Language | Python 3.11+ |
| Package management | uv + pyproject.toml |
| Web framework | FastAPI |
| Config | pydantic-settings |
| Auth | Firebase Auth (RS256 ID tokens verified via Google JWKS) |
| Database | Neon PostgreSQL (`NullPool` - see deviations above) |
| ORM | SQLAlchemy 2.x |
| Migrations | Alembic |
| Local DB | Docker Compose |
| Linting | ruff |
| Testing | pytest with 100% coverage |

---

## Common Commands

```bash
uv sync
docker compose up -d
docker compose down
uv run python src/main.py
uv run alembic revision --autogenerate -m "short description"
uv run alembic upgrade head
uv run alembic downgrade -1
uv run ruff check .
uv run pytest
uv add package-name
uv add --dev package-name
```

---

## Definition Of Done

A feature is done when:

- It works for the intended use case.
- It is deployable, not just runnable locally.
- `.env.example` is updated for every required variable.
- CI includes every required env var and service dependency.
- Tests cover new business logic and endpoints.
- Security review passes.
- Local tests pass.
- CI is green after push.
- Joseph receives a concise build summary.
