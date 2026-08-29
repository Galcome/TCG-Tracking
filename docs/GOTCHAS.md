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

**Symptom:** Google sign-in works on localhost, then fails once deployed. The login screen
now names the code: `auth/unauthorized-domain`.

**Cause:** Firebase only allows OAuth flows from domains on its authorized list. `localhost`,
`<project>.web.app` and `<project>.firebaseapp.com` are there by default. Nothing else is.

**This is why the SPA is on Firebase Hosting.** It was briefly deployed to Cloudflare Pages
and Google sign-in failed immediately. Per-deployment preview URLs make it worse: Cloudflare
mints a new subdomain per deploy, and each one would need adding by hand.

**Fix:** Deploy the SPA to Firebase Hosting so the domain is authorized for free. If a custom
domain is ever added, register it in Firebase Console -> Authentication -> Settings ->
Authorized domains **and** in the API's `ALLOWED_ORIGINS`, before pointing anyone at it.

Email/password sign-in does not use the OAuth flow and is unaffected by this list.

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

## Railway - API and pricing Cron use separate config files

The repository now has a real second service definition: a private daily pricing Cron. Root
`railway.json` deliberately remains an API-safe fallback until the existing service has an
explicit dashboard path; removing its commands first could stop migrations or the API on the
next deploy. Set the service-specific config paths in the Railway dashboard:

1. API service -> `/railway.api.json`. It owns `uv run alembic upgrade head` and the Uvicorn
   health check.
2. Pricing Cron service -> `/railway.pricing-refresh.json`. It runs
   `uv run python -m src.jobs.pricing_refresh`, has no health check, and exits after one run.
3. Keep the Cron service private with no public domain. Give it the same secret Neon pooled
   `DATABASE_URL` and `APP_ROLE=worker`; the process refuses to run under any other role.

Do not create the Cron service from root config and do not neutralize root `railway.json`
until the API's `/railway.api.json` path is confirmed in Railway. The CLI cannot reliably
make that dashboard-only rollout decision for an existing service.

Railway Cron schedules are UTC, may run a few minutes late, and skip an invocation while a
previous one is still active. The job's PostgreSQL transaction advisory lock is a second
overlap guard, and its bounded retries make a transient lock/DB/provider failure visible.
See [PRICING_REFRESH.md](PRICING_REFRESH.md) for the runbook.

---

## Railway - Nixpacks Build Fails On `pip install uv==`

**Symptom:** The build dies immediately with
`ERROR: Could not find a version that satisfies the requirement uv==`, followed by a listing
of every uv release ever published.

**Cause:** Nixpacks' Python provider runs `pip install uv==$NIXPACKS_UV_VERSION`. When that
variable is unset the command becomes a literal `pip install uv==`, which is not a valid
specifier. Nothing in the repo is wrong - the builder just has no default.

**Fix:** Set `NIXPACKS_UV_VERSION` on the service to the uv version that generated
`uv.lock`, so `uv sync --frozen` stays reproducible:

```powershell
uv --version                                              # read the local version
railway variables --service api --set "NIXPACKS_UV_VERSION=0.10.4"
```

Bump it whenever the local uv used to regenerate `uv.lock` changes.

---

## Railway - Procfile vs railway.json Conflict

**Symptom:** Railway runs the wrong start command, or migrations do not run before startup.

**Cause:** Defining process commands in both a Procfile and Railway config can conflict.

**Fix:** Use one approach. This template uses Railway config files.

---

## Railway - The Serverless Toggle Is Erased By The Next Deploy

**Symptom:** "Enable Serverless" is on in the service settings, but the container never sleeps.
Deploy logs show a single `Starting Container` spanning days, straight through idle gaps of
sixteen hours, and you keep paying for an always-on service.

**Cause:** `railway.json` is config-as-code, and its `deploy` block is authoritative for the
deployment built from it. `sleepApplication` was not in the file, so every code deploy resolved
it to `false` and silently overwrote whatever the dashboard said. Flipping the toggle creates a
deployment with sleeping on; the next push to `main` replaces it with one that has sleeping off.
We lost it in 83 seconds this way.

**Fix:** `railway.json` now sets `"sleepApplication": true`. Set it in the file, not the
dashboard - the dashboard value does not survive a deploy. This applies to *any* deploy setting:
if it is not in `railway.json`, a deploy resets it.

**Verify the running deployment rather than the toggle.** The settings page shows intent; the
deployment manifest shows what is actually running:

```bash
railway deployment list --json | grep -m1 sleepApplication
```

That reads the top entry, which is the live deployment. `true` means it is genuinely armed.
`serviceManifest.deploy` in the same record is the resolved config; `fileServiceManifest.deploy`
is only what the file asked for. When they disagree, the service manifest wins.

Do not diagnose this by latency alone, and **do not use connect time as the tell**. Railway's
edge terminates TLS and queues the request while the container starts, so `%{time_connect}` was
73ms whether the container was asleep or awake - measured both ways on this service.

Time to first byte is the honest signal, and only against a known warm baseline:

| State | connect | ttfb |
| --- | --- | --- |
| Warm container | 0.073s | 0.94s |
| Slept container waking | 0.073s | 4.38s |

The warm case is not free either: about a second of that is **Neon** resuming its own compute,
which reads like a container wake and is not one. Only the ~3.4s difference is Railway.

The unambiguous check is the log, not the stopwatch - a wake always emits `Starting Container`:

```bash
railway logs -d --lines 200 | grep -E "Starting Container|Stopping Container"
```

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

---

## End-To-End Tests Poison The Development Database

**Symptom:** `npm run test:e2e` passes, then `uv run pytest` fails ~56 tests on
store-wide aggregates that were right five minutes ago.

**Cause:** The suite drives the real app, so it writes real rows. Anything asserting on a
dashboard or report total then sees browser-test data.

**Fix:** Already handled - `tests/e2e/prepare.py` creates and migrates a separate
database, `<your db>_e2e`, and refuses to manage any name that does not say `e2e`.
Override with `E2E_DATABASE_URL` if you need it elsewhere. If a run does land in the
development database, reset it:

```bash
uv run alembic downgrade base && uv run alembic upgrade head
```

---

## Overriding DATABASE_URL At Runtime Silently Does Nothing

**Symptom:** You set `os.environ["DATABASE_URL"]` before importing the app, and it still
connects to the old database.

**Cause:** `src/config.py` exposes `settings` as a module-level instance, and
`src/database.py` builds the engine from that object at import time. Once anything has
imported `src.config`, the environment is no longer consulted - and importing a helper
that itself imports `src.config` is enough to lock it in.

**Fix:** Mutate the object, not the environment, and do it before importing
`src.main`/`src.database`:

```python
from src.config import settings
settings.database_url = "..."
from src.main import app  # noqa: E402
```

`tests/e2e/server.py` does exactly this.

---

## Playwright Reuses A Server Pointed At The Wrong Database

**Symptom:** The e2e suite passes but writes end up in the development database anyway.

**Cause:** `reuseExistingServer: true` makes Playwright probe the port, find *something*
answering, and carry on. A server left running from an earlier run is configured however
it was configured then.

**Fix:** The config sets `reuseExistingServer: false` for both servers. If a port is
already taken the run fails loudly, which is the outcome you want.

## Gemini - A Pinned Model Expires, And The Tests Cannot See It

The photo reader on the rip screen shipped hardcoded to `gemini-2.0-flash`. Google retired
that entire generation. The live API answers:

```text
404 NOT_FOUND - This model models/gemini-2.0-flash is no longer available.
```

So every photo raised `VisionUnavailable` and the screen fell back to typing - which is the
designed behaviour on failure, and therefore looks like nothing is wrong. The feature would
have been quietly dead.

**No test could have caught it.** Every test in `tests/test_vision.py` monkeypatches
`httpx.post`. Mocks assert the shape of the conversation, never that the other end still
exists. A green suite says the parsing, throttling and fallbacks are correct; it says
nothing about whether the endpoint is real.

The fix is `GEMINI_MODEL` in config, defaulting to a `-latest` alias, which tracks the
current generation instead of pinning a version that ages out. A bad rollout is now an env
var away from being fixed rather than a deploy.

**Check what a key can actually see before trusting a model name:**

```bash
curl -H "x-goog-api-key: $GEMINI_API_KEY" \
  https://generativelanguage.googleapis.com/v1beta/models
```

The general rule: anything that depends on a third party still existing needs one real call
against it, once, by hand. The suite covers our logic. It does not cover their inventory.

## Firebase Hosting - A `/index.html` Header Rule Does Not Cover `/`

`firebase.json` set `Cache-Control: no-cache` on `/index.html` and it worked - but nobody
requests that path. A person opens `/`, and the app's own links are `/inventory`,
`/money`, `/products/<id>`. Those are served the same file **through the SPA rewrite**, and
header rules match the **request path**, not the file that ends up being served:

```text
/index.html   no-cache, must-revalidate    <- the rule everybody writes
/             max-age=3600                 <- what a person actually gets
/inventory    max-age=3600
```

The result: every deploy was invisible for up to an hour to anyone who had visited before.
Three separate features were reported as "I don't see any changes" while being live and
correct on the server, and each time the answer looked like a deploy problem.

The fix is to put the cache rule on the **catch-all** `**` block. Ordering does the rest:
`/assets/**` is listed first and keeps its immutable year, which is safe because Vite
content-hashes those filenames - a new build produces a new name, so a stale one can never
be served under the same URL.

**Verify with the paths a person actually uses, never `/index.html`:**

```bash
curl -sI https://tcg-tracking.web.app/ | grep -i cache-control
curl -sI https://tcg-tracking.web.app/inventory | grep -i cache-control
```

The general rule, and it is the same one as the retired Gemini model above: a config that
is correct in the file can still be wrong in production. Check the thing the user touches.
