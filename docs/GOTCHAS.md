# Known Deployment Gotchas

Issues we've hit before. Check here before debugging anything deployment-related.
When you hit a new one, add it.

---

## This Project Does Not Use Supabase

This repo was built from a Supabase-default template but runs on **Neon** (Postgres) and
**Firebase Auth**. Supabase's free tier was already at its project limit, and Railway Postgres
priced out at roughly $2-4/month.

Do not "restore" Supabase config when you see `SUPABASE_*` referenced in older template docs.

---

## Neon - A Connection Pool Silently Burns The Free Tier

**Symptom:** Neon compute hours are consumed around the clock even though two or three people
use the app occasionally. `active_time` and `cpu_used_sec` climb while nobody is signed in.

**Cause:** Neon suspends compute only when there are **zero open connections**. SQLAlchemy's
default `QueuePool` holds idle connections open indefinitely, so the compute never suspends.

**Fix:** `src/database.py` uses `NullPool` deliberately - a connection per request, closed at
the end of it. Neon's own PgBouncer does the real pooling, so this costs a handshake, not a
backend spawn. Do not add `pool_size`, `max_overflow`, or `pool_recycle` back without moving
to an always-on database first.

Related: do not point an uptime monitor at `/health`. It touches the database and would hold
the compute awake permanently. Railway only polls it during deploys.

---

## Firebase Auth - A Valid Token Is Not Membership

**Symptom:** A stranger signs in and appears in the members list.

**Cause:** Google sign-in is enabled on this Firebase project, so *anyone with a Google
account* can obtain a structurally valid, correctly-signed ID token for it. Verifying the
token proves who someone is; it says nothing about whether they belong to this store.

**Fix:** `ALLOWED_MEMBER_EMAILS` gates provisioning *and* ongoing access, checked on every
request. It is **required in production** - `Settings` refuses to start without it, because
an empty list would silently mean "admit everyone".

Adding a person = add their email to that variable. Removing them = take it out; the change
revokes access on the next request, which is the only "remove access" lever until an admin UI
exists. A token carrying no email at all fails closed.

---

## Firebase Auth - Google Sign-In Breaks On A New Domain

**Symptom:** Google sign-in works on localhost, then fails with `auth/unauthorized-domain`
once deployed.

**Cause:** Firebase only allows OAuth flows from domains on its authorized list. `localhost`
is there by default; your Cloudflare Pages domain is not.

**Fix:** Firebase Console -> Authentication -> Settings -> Authorized domains, and add the
production domain. Do this before the first real deploy, not after.

---

## Firebase Auth - Project ID Mismatch

**Symptom:** Every authenticated request returns 401 `Invalid token`, but sign-in works fine
in the browser.

**Cause:** The backend verifies that a token's `aud` equals `FIREBASE_PROJECT_ID` and its `iss`
is `https://securetoken.google.com/<FIREBASE_PROJECT_ID>`. A frontend pointed at a different
Firebase project produces perfectly valid tokens that this backend correctly rejects.

**Fix:** Confirm `FIREBASE_PROJECT_ID` on the API and `VITE_FIREBASE_PROJECT_ID` on the web app
name the same project. There is no shared secret to compare - the project id *is* the binding.

---

## Railway - This Project Puts The API Config In Root `railway.json`

The template's rule is that root `railway.json` stays service-neutral and each service points
at its own file (`railway.api.json`, etc.), because a root config with an API-only
`startCommand` or `healthcheckPath` applies to *every* service and will make a worker boot
Uvicorn or fail an HTTP health check.

**This project deliberately breaks that rule**, because:

- It deploys exactly **one** service to Railway. The web SPA goes to Cloudflare Pages.
- The per-service "Railway config file" path is **dashboard-only** - the CLI cannot set it.
  With the config in `railway.api.json`, a CLI- or GitHub-created service silently falls back
  to the neutral root config, which has no `preDeployCommand`. **Migrations would never run**,
  and the failure looks like a mysterious `relation does not exist` at runtime.

**Reverse this the moment a second Railway service appears** (a worker, a scheduler):

1. Move the `deploy` block from `railway.json` back into `railway.api.json`.
2. Return root `railway.json` to build-only plus restart policy.
3. Set each service's config file path in the Railway dashboard.

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

**Symptom:** `docker compose up` reports the container is healthy, but connecting fails with
`password authentication failed for user "myapp_user"` - which looks like a credentials
problem and is not one.

**Cause:** A native PostgreSQL service is already bound to `0.0.0.0:5432` and wins the IPv4
address, so the connection reaches the wrong database entirely. The container's
`POSTGRES_HOST_AUTH_METHOD: trust` would have accepted any password, which is the tell.

**Fix:** Move the container's host port instead of stopping the machine's own database. In
`.env`:

```text
POSTGRES_HOST_PORT=5433
DATABASE_URL=postgresql://myapp_user:localdev@localhost:5433/myapp
```

`docker-compose.yml` reads `${POSTGRES_HOST_PORT:-5432}`, so this changes nothing for anyone
without the conflict. Stopping `postgresql-x64-18` also works but takes the rest of your local
databases down with it.

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
