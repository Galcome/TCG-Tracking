# Observability

Keep secrets out of the repo. Store Sentry/Firebase/Railway tokens in `.env`, the shell,
GitHub Secrets, EAS env vars, or Railway Variables only.

## Sentry

Recommended local variables:

```env
SENTRY_AUTH_TOKEN=<local-read-only-or-release-token>
SENTRY_ORG=bestbestsoftware
SENTRY_PROJECT=<project-slug>
```

The same Sentry auth token can be reused across similar projects if its scopes cover the new
Sentry projects. Runtime DSNs are project-specific.

Backend responses include:

- `X-Request-ID`
- `X-Process-Time-Ms`
- security headers
- Sentry request id and route tags when `SENTRY_DSN` is set

## Firebase

Firebase token reuse is account-level. `FIREBASE_ANDROID_APP_ID` and `google-services.json`
are project/app-specific.

Crashlytics and Performance should record app version, route/screen, request id, endpoint, and
status where available. Missing native modules must never break web or local export.

## Railway

Use bounded logs:

```powershell
railway logs --service <service-name> --environment production --lines 200
railway logs --service <service-name> --environment production --since 30m
```

Do not paste raw logs containing secrets, auth headers, database URLs, or PII into docs.
