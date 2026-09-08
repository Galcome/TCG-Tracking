# TCG universal app (rewrite in progress)

This sibling Expo Router application is under development. The production website still
builds from `../web`; nothing here switches Firebase Hosting or changes the database.

## Local development

Use Node 22.13 or newer, run `npm ci`, and supply the four public variables in
`.env.example` through your local ignored `.env` or shell. Use the existing TCG Firebase
project and a matching API environment; do not copy Household's identity configuration.
These public Firebase values are not service-account credentials.

Run `npm run web` for browser development. The API must allow the exact browser origin.
Android emulator API access uses `http://10.0.2.2:8001`; a physical device needs a reachable
HTTPS development API. Never distribute a bundle containing local or fixture configuration.

Web uses Expo's single-page static export so authenticated, arbitrary product UUID deep
links can resolve through a Hosting SPA fallback. It requires no Node rendering server.
The actual Hosting switch and cache rules are a separate, approval-gated release task.

## Verification

- `npm run lint`, `npm run typecheck`, `npm test`
- `npx expo install --check`
- `npm run export:web -- --clear`
- `npx expo export --platform android --platform ios --output-dir dist-native --clear`
- With a dedicated local Postgres URL in `DATABASE_URL` and an explicitly named
  disposable `E2E_DATABASE_URL`: `npx playwright install chromium`, then
  `npx playwright test --reporter=line`.

The browser harness starts the existing test-only FastAPI server on 8101 and the Expo
static export on 5373. It refuses to reuse running servers. It uses real database/API
behavior and Firebase's real browser SDK with intercepted identity-service test fixtures;
it does not prove production Google configuration or genuine native authentication.
The Metro cache is cleared to prevent previous environment values entering test builds.

`expo-checks.yml` runs isolated compilation and browser checks. It has no deployment or
distribution step. Fixture bundles are deliberately not published as release artifacts.

## Native release gates

EAS profiles retain Household's current local app-version policy. Before distribution,
reconcile the package/bundle ID, Firebase registrations, native Google credential flow,
signing, version increment, telemetry, app icons, and environment configuration. Native
email/password persistence is explicitly initialized with AsyncStorage, but actual
kill/relaunch and token refresh must be verified on devices. Google is currently web-only.

Android/iOS JavaScript export success is not an APK/IPA build or device acceptance.
Do not run production builds or switch the live website based on this foundation alone.

## Tracking

See [parity tracker](../docs/requirements/expo-parity-tracker.md) and
[approved migration plan](../docs/requirements/2026-09-08-expo-universal-rewrite.md).
Money and FIFO calculations remain on the backend; estimates never become cost or profit.
