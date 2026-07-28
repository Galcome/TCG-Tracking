# Deployment Template Playbook

Use this as the first-pass deployment checklist for new projects built from this template.
It captures the Railway, Supabase, Sentry, Firebase, EAS, CI/CD, and tooling defaults that
should stay the same across similar apps.

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

- Supabase URL, anon key, JWT secret, database password, pooler URL, and direct DB URL.
- Railway project id, service names, public domain, and service env values.
- Sentry project slugs and runtime DSNs. The Sentry auth token can be shared; DSNs cannot.
- Firebase Android app id and `google-services.json`.
- Expo project id, app slug, Android package id, and iOS bundle id.
- `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
  and `EXPO_PUBLIC_SENTRY_DSN`.
- `EAS_WEBHOOK_SECRET`; generate a fresh random value per app.
- CORS origins and Vercel preview regex.

## Supabase

Use Supabase before wiring Railway so all env vars point at one project from day one.

Railway persistent API/worker services should use the Supavisor session pooler on port `5432`
as `DATABASE_URL`:

```text
postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

Keep `DIRECT_DATABASE_URL` blank in Railway production. It is for local/manual maintenance.

Start with conservative pool values:

```text
DB_POOL_SIZE=4
DB_MAX_OVERFLOW=2
DB_POOL_TIMEOUT_SECONDS=15
DB_POOL_RECYCLE_SECONDS=270
```

The backend supports modern asymmetric Supabase JWTs and legacy HS256 tokens when
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_JWT_SECRET` all point at the same project.

## Railway

Root `railway.json` is intentionally service-neutral. Configure Railway services with the
specific config file they need:

- API service: `/railway.api.json`
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
