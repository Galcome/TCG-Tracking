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

## Railway - This Project Puts The API Config In Root `railway.json`

The template's rule is that root `railway.json` stays service-neutral and each service points
at its own file (`railway.api.json`, etc.), because a root config with an API-only
`startCommand` or `healthcheckPath` applies to *every* service and will make a worker boot
Uvicorn or fail an HTTP health check.

**This project deliberately breaks that rule**, because:

- It deploys exactly **one** service to Railway. The web SPA goes to Firebase Hosting.
- The per-service "Railway config file" path is **dashboard-only** - the CLI cannot set it.
  With the config in `railway.api.json`, a CLI- or GitHub-created service silently falls back
  to the neutral root config, which has no `preDeployCommand`. **Migrations would never run**,
  and the failure looks like a mysterious `relation does not exist` at runtime.

**Reverse this the moment a second Railway service appears** (a worker, a scheduler):

1. Move the `deploy` block from `railway.json` back into `railway.api.json`.
2. Return root `railway.json` to build-only plus restart policy.
3. Set each service's config file path in the Railway dashboard.

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
