# Deployment Playbook

> **This project deviates from the template defaults.** It uses **Neon** for Postgres and
> **Firebase Auth** for identity, not Supabase, and it ships a **web SPA** rather than an
> Expo app. See [GOTCHAS.md](GOTCHAS.md) for the reasoning. The Expo, EAS and mobile
> distribution sections below are inherited template guidance and do not apply here yet.

It captures the Railway, Neon, Firebase, Sentry, CI/CD, and tooling defaults for this app.

## Same By Default

Reuse the same tooling and account access when it already covers the new project:

- Railway login/workspace and bounded CLI usage.
- Sentry org login/API token when scopes cover the new Sentry projects.
- Firebase CLI token when the Google/Firebase account can access the new Firebase project.
- Expo account token when the new app lives under the same Expo account.
- GitHub Actions workflow shape, env var names, and no-watch release pattern.
- Triage flow: request id, route/screen, version, timestamp, Sentry issue, Railway log line.

## Project-Specific Values

Change these every time:

- Neon project id, pooled connection URL, and direct connection URL.
- Firebase project id and web app config (API key, auth domain).
- Railway project id, service names, public domain, and service env values.
- Sentry project slugs and runtime DSNs. The Sentry auth token can be shared; DSNs cannot.
- `VITE_API_URL`, `VITE_FIREBASE_*`, and `VITE_SENTRY_DSN` for the web app.
- CORS origins.

## Neon (Postgres)

Set Neon up before wiring Railway so every env var points at one project from day one.

`DATABASE_URL` is the **pooled** endpoint - the hostname containing `-pooler`:

```text
postgresql://<user>:<password>@ep-xxx-pooler.<region>.aws.neon.tech/<db>?sslmode=require
```

`DIRECT_DATABASE_URL` is the **unpooled** endpoint, used by Alembic and admin tasks. Keep it
blank in Railway production; the deploy command runs migrations through the pooled URL.

**Do not add client-side connection pooling.** `src/database.py` uses `NullPool` on purpose:
Neon suspends compute only when there are zero open connections, so a persistent pool would
hold the compute awake around the clock and consume the free tier's monthly allowance while
nobody is using the app. Neon's own PgBouncer does the real pooling.

Project settings that matter on the free tier:

- Cap autoscaling at **0.25 CU**. The default `max 2` can burn the compute allowance up to 8x
  faster than the floor rate during a burst.
- Leave autosuspend at the plan default (~5 min idle).
- Deploy the Railway service in a **US East** region to sit next to the Neon project; with
  `NullPool` a cross-region round trip is paid on every request, not amortised across a pool.

Watch usage with `neon projects list --org-id <org-id> --output json` and check that
`active_time` and `cpu_used_sec` are not growing around the clock.

## Firebase Auth

The backend verifies Firebase ID tokens against Google's public JWKS. There is **no shared
secret** to configure - only `FIREBASE_PROJECT_ID`, which is both the expected `aud` and the
suffix of the expected `iss`.

Two sign-in methods are enabled: **Email/Password** and **Google**.

Because Google sign-in is on, anyone with a Google account can obtain a valid token for this
project. Membership is therefore decided by **`ALLOWED_MEMBER_EMAILS`**, a comma-separated
list checked on every request. It is required in production - the app refuses to start
without it. The first member to sign in is provisioned as admin; everyone after defaults to
`member`.

Inviting someone is two steps: add their email to `ALLOWED_MEMBER_EMAILS`, and (for
Email/Password sign-in) create their account in the Firebase console. Google users need only
the first.

Before the first deploy, add the production domain under **Authentication -> Settings ->
Authorized domains**, or Google sign-in fails with `auth/unauthorized-domain`.

The frontend project id must match `FIREBASE_PROJECT_ID` exactly, or every request 401s.

## Railway

Root `railway.json` is intentionally service-neutral. Configure Railway services with the
specific config file they need:

- API service: root `/railway.json` (this project only - see `GOTCHAS.md`)
- Worker service: add a worker-specific Railway config only after the project has a real
  worker entrypoint.

Do not put API-only `startCommand` or `healthcheckPath` in root `railway.json` for multi-service
repos. That can force workers to boot the web server or fail HTTP healthchecks.

Use bounded reads:

```powershell
railway logs --service <api-service> --environment production --lines 200
railway logs --service <api-service> --environment production --since 30m --filter "@level:error"
```

Use `railway up --detach` for fire-and-forget manual deploys and `railway up --ci` when CI
should print build output without long interactive watching.

## Firebase Hosting (web app)

Served at `https://tcg-tracking.web.app` (and `tcg-tracking.firebaseapp.com`).

**Chosen over Cloudflare Pages specifically because Firebase pre-authorizes its own hosting
domains for OAuth.** Any other host has to be added to Authentication -> Settings ->
Authorized domains by hand, and every per-deployment preview URL would need adding too or
Google sign-in fails there with `auth/unauthorized-domain`. Hosting the SPA on the same
project as Auth removes that entire class of problem.

### Deploys are automatic

`deploy-web` in `.github/workflows/ci.yml` publishes on every push to `main`, gated on
`tests-required` so nothing ships that has not passed the backend suite, the web build and
the browser suite.

It was not always so. The API has auto-deployed from `main` since day one and the web app
never did, so six merges once landed a backend nobody could see - every new screen was
live in the API and absent from the app. If you find yourself explaining that a feature is
"merged" while somebody is looking at a page that does not have it, this is the first place
to check.

**What has to be configured, once:**

| Where | Name | Value | Status |
| --- | --- | --- | --- |
| Secret | `FIREBASE_SERVICE_ACCOUNT_TCG_TRACKING` | Service-account JSON with Firebase Hosting access | Set |
| Variable | `VITE_API_URL` | The Railway API URL | Set |
| Variable | `VITE_FIREBASE_API_KEY` | Firebase web API key | Set |
| Variable | `VITE_FIREBASE_AUTH_DOMAIN` | `tcg-tracking.firebaseapp.com` | Set |
| Variable | `VITE_FIREBASE_PROJECT_ID` | `tcg-tracking` | Set |
| Variable | `VITE_SENTRY_DSN` | Optional; unset disables Sentry | Unset, deliberately |

`VITE_SENTRY_DSN` is left **unset** rather than set to an empty string, because GitHub
rejects a variable with an empty value (`422: missing required key: value`). An unset
variable resolves to `""`, which is what the app wants when Sentry is off — so the
required-values check below deliberately does not include it. The four it does check are
the ones whose absence produces a bundle that builds fine and fails in the browser.

The `VITE_*` values are repository **variables**, not secrets. Every one of them is
compiled into the bundle and served to any browser that loads the site, so hiding them
would be theatre - and a secret that silently resolves to an empty string is worse than a
visible one. The service account is the only real credential.

The quickest way to create the secret is to let Firebase do it:

```powershell
firebase init hosting:github
```

It creates the service account, grants it hosting access and writes the secret to the repo
under exactly the name above. It also writes two workflows of its own - delete both; the
job in `ci.yml` supersedes them and is gated on the tests, which theirs are not.

### Deploying by hand

Still works, and is the fallback when Actions is down or you need to publish something that
is not on `main`:

```powershell
cd web
$env:VITE_API_URL = "https://api-production-6ea5.up.railway.app"
npm run build
cd ..
firebase deploy --only hosting --project tcg-tracking
```

Setting `VITE_API_URL` on the command line is not optional. `web/.env` points at
`localhost:8000` for local development, and a build that picks that up produces a site that
looks perfectly normal and talks to nothing. The CI job greps the built bundle for
`localhost:8000` and refuses to publish if it finds it; by hand, you are the check.

`VITE_*` values are baked in **at build time**, not read at runtime. Building with the wrong
`VITE_API_URL` produces a bundle that quietly talks to the wrong backend, so set them on the
build command rather than relying on a local `web/.env` (which points at localhost).

`firebase.json` holds the SPA rewrite - without it any deep link such as `/products/new` 404s
on refresh - plus cache headers. Fingerprinted assets are immutable for a year; `index.html`
is `no-cache` so a deploy is picked up immediately instead of serving a stale bundle.

The Railway API's `ALLOWED_ORIGINS` must list these domains or the browser blocks every call
as a CORS failure.

## Sentry

Create separate runtime projects when the app has separate runtimes:

- backend API/worker
- web frontend
- native mobile

Backend defaults:

- `sentry-sdk[fastapi]`
- `SENTRY_DSN`
- `send_default_pii=False`
- request id and route tags

Mobile/web defaults:

- `@sentry/react-native`
- `EXPO_PUBLIC_SENTRY_DSN`
- `SENTRY_AUTH_TOKEN` for source map upload
- root wrapped with `Sentry.wrap()`

## Firebase Crashlytics And Performance

For Expo native apps:

```bash
cd app
npx expo install @react-native-firebase/app @react-native-firebase/crashlytics @react-native-firebase/perf
```

Use `app.config.js` to add Firebase config plugins only when `google-services.json` exists.
GitHub should fetch the Android config and upload it to EAS as secret file env
`GOOGLE_SERVICES_JSON`. Runtime helpers should dynamically import Firebase native modules so
web/local export remains safe.

## CI/CD

Backend CI:

- `uv sync --all-groups`
- `uv run ruff check .`
- `uv run alembic upgrade head`
- `uv run pytest`

Mobile release for Expo apps:

Add these workflows only after the child project has a real Expo app, Firebase project, and
EAS project. The backend template itself must not run mobile distribution on push.
Use the inert examples in `docs/workflow-templates/` as the copy source, then place the
customized copies in the child app's `.github/workflows/` directory.

1. Dispatch `Mobile - Start EAS Android Build` from `main`.
2. Confirm CI passed for the exact commit.
3. Validate version, lockfile, and `eas.json`.
4. Fetch Firebase Android config and upload EAS `GOOGLE_SERVICES_JSON`.
5. Run Android JS bundle export.
6. Start EAS with `--no-wait` and exit after saving build metadata.
7. EAS calls Railway's signed webhook when complete.
8. Railway dispatches the short GitHub distribution workflow.
9. GitHub downloads the APK, stores a short-retention artifact, and distributes through Firebase.

Agents should not run long `gh run watch`, EAS polling, Firebase polling, or Railway streaming
logs by default. Use one-time status commands and hand off links unless active watching is
explicitly requested.
