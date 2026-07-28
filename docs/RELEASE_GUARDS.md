# Release Guards

Mobile release is the packaging step after CI and bundle preflight pass. It is not the first
test.

## No-Watch EAS Pattern

For Expo apps, use this sequence:

```text
main commit
  -> CI green
  -> release guard
  -> Android JS bundle preflight
  -> EAS build --no-wait
  -> GitHub runner exits
  -> EAS signed webhook to Railway
  -> short GitHub distribution workflow
  -> APK artifact and Firebase App Distribution
```

Do not reintroduce `eas build --wait` or long `gh run watch` polling unless Joseph explicitly
asks to watch a specific build.

The base template keeps workflow examples in `docs/workflow-templates/` only. Copy them into a
child app's `.github/workflows/` directory after that app has Expo, EAS, Firebase, and Sentry
configured.

## Required Mobile Secrets

GitHub Actions:

- `EXPO_TOKEN`
- `FIREBASE_TOKEN`
- `FIREBASE_ANDROID_APP_ID`
- `SENTRY_AUTH_TOKEN`
- frontend public env vars needed for bundle export

EAS preview environment:

- `EXPO_PUBLIC_API_URL`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_SENTRY_DSN`
- `GOOGLE_SERVICES_JSON` as a secret file variable

Railway backend:

- `EAS_WEBHOOK_SECRET`
- `GITHUB_RELEASE_DISPATCH_TOKEN`
- `GITHUB_RELEASE_REPO`
- `GITHUB_RELEASE_WORKFLOW`

## Firebase Crashlytics And Performance

The Firebase Android app package must match the Expo Android package. Keep
`google-services.json` out of Git. Fetch it in GitHub with Firebase CLI and write it to EAS as
`GOOGLE_SERVICES_JSON` before building.

## Backend Release Checks

Before merging backend changes:

- env vars added in `src/config.py`, `.env.example`, `tests/conftest.py`, and CI
- migrations committed
- `uv run ruff check .`
- `uv run alembic upgrade head`
- `uv run pytest`
