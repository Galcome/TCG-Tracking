# Known Deployment Gotchas

Issues we've hit before. Check here before debugging anything deployment-related.
When you hit a new one, add it.

---

## Supabase Auth - HS256 vs Asymmetric JWTs

**Symptom:** JWT verification fails in production with `InvalidTokenError` or `DecodeError`.

**Cause:** Newer Supabase projects often issue asymmetric JWTs. Older projects may still use
HS256 with `SUPABASE_JWT_SECRET`.

**Fix:** The template supports both. Verify `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_JWT_SECRET`, and frontend `EXPO_PUBLIC_SUPABASE_*` values all point at the same
Supabase project. After moving Supabase projects, clear stale app/browser sessions.

---

## Supabase Pooler - Railway + SQLAlchemy Mode Mismatch

**Symptom:** Railway gets database timeouts, prepared statement errors, or intermittent
`OperationalError`.

**Cause:** Supabase has direct, session-pooler, and transaction-pooler connection strings.
Railway persistent services should usually use the Supavisor session pooler on port `5432`.
Transaction mode on port `6543` does not support prepared statements and should not be combined
with normal app-side SQLAlchemy pooling unless the engine is configured for it.

**Fix:**
- Set Railway `DATABASE_URL` to the Supavisor session pooler URL:
  `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require`
- Keep `DIRECT_DATABASE_URL` blank in Railway production.
- Keep `DB_POOL_SIZE` and `DB_MAX_OVERFLOW` conservative across API and worker services.
- If using transaction mode intentionally, switch SQLAlchemy to `NullPool` and keep psycopg
  prepared statements disabled.

---

## Railway - One `railway.json` For API And Worker Services

**Symptom:** A worker starts Uvicorn, or Railway probes `/health` on a service with no HTTP server.

**Cause:** Railway config-as-code overrides service settings. A root `railway.json` with API-only
`startCommand` or `healthcheckPath` applies to every service that uses it.

**Fix:** Keep root `railway.json` service-neutral. Configure service-specific files:

- API: `/railway.api.json`
- Worker: add a worker-specific config only after the project has a real worker entrypoint.

---

## Railway - Procfile vs railway.json Conflict

**Symptom:** Railway runs the wrong start command, or migrations do not run before startup.

**Cause:** Defining process commands in both a Procfile and Railway config can conflict.

**Fix:** Use one approach. This template uses Railway config files.

---

## Secret Artifacts - Browser Sessions And Variable Dumps

**Symptom:** Git search shows cookies, auth tokens, Railway variable dumps, local sessions, or
Firebase config files.

**Fix:**
- Keep `.env`, `.sessions.json`, `railway_vars.txt`, `google-services.json`, `.qa-*`, and raw
  logs ignored.
- If a secret artifact was tracked, remove it from Git and rotate the affected secret before
  launch.

---

## Docker Desktop on Windows - Port 5432 Conflict

**Symptom:** `docker compose up` starts but the app cannot connect to Postgres locally.

**Cause:** Native PostgreSQL service is already running on port 5432.

**Fix:**

```powershell
Stop-Service postgresql-x64-18
Stop-Service pgagent-pg18
```

---

## Alembic - Migration Not Found in CI

**Symptom:** CI passes but Railway deploy fails with `relation does not exist`.

**Cause:** A migration was generated locally but not committed.

**Fix:**
- Always commit migration files before pushing.
- Run `uv run alembic current` and `uv run alembic heads`; they must match before deploying.

---

## Coverage Fails In CI But Passes Locally

**Symptom:** Coverage fails only in CI.

**Cause:** Test env vars differ from `tests/conftest.py`.

**Fix:** New backend env vars must be added to `src/config.py`, `.env.example`,
`tests/conftest.py`, and `.github/workflows/ci.yml` together.
