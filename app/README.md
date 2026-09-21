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
The test export is isolated in `dist-e2e`; ordinary `dist` exports cannot replace it.

CSV exports download in the browser and use a temporary cache file with the native share
sheet on Android/iOS. See [Expo FileSystem](https://docs.expo.dev/versions/latest/sdk/filesystem/)
and [Expo Sharing](https://docs.expo.dev/versions/latest/sdk/sharing/). Temporary files are
removed immediately on failure. Successful shares remain cached so Android recipients
can finish reading; files older than 24 hours are pruned on the next export (or by OS
cache eviction). Native sharing/unavailable-device behavior needs device
acceptance; a successful JavaScript export does not prove those operating-system flows.

`expo-checks.yml` runs isolated compilation and browser checks. It has no deployment or
distribution step. Fixture bundles are deliberately not published as release artifacts.

## Native release gates

Rip photo entry uses the existing authenticated vision API for editable identity suggestions
only. Browser selection and native camera/library adapters cap selection at five photos;
the API enforces the 6 MiB limit even when native file size is unavailable. Permission
denial, cancellation and reader failure leave manual entry available. No microphone
permission is requested. Native photo permission/camera/library behavior needs device acceptance.

EAS profiles retain Household's current local app-version policy. Before distribution,
reconcile the package/bundle ID, Firebase registrations, native Google credential flow,
signing, version increment, telemetry, and environment configuration. Branded iOS and
Android adaptive icons are now wired from `assets/`; regenerate them with
`node scripts/generate-app-icons.mjs` after intentional brand changes. Native
email/password persistence is explicitly initialized with AsyncStorage, but actual
kill/relaunch and token refresh must be verified on devices. Native Google is enabled only
in a validated Android build; installed-device authentication remains unverified.

Android/iOS JavaScript export success is not an APK/IPA build or device acceptance.
Do not run production builds or switch the live website based on this foundation alone.

## Release configuration preflight

Supply the four public values explicitly through shell/EAS and `EXPO_NO_DOTENV=1`, then run
`npm run release:preflight -- --profile preview --platform android` (or production/ios).
The dependency-free `eas-build-pre-install` hook uses `EAS_BUILD_PROFILE` and
`EAS_BUILD_PLATFORM`; missing/conflicting context fails. Explicit development skips release
checks. Custom build workflows must invoke the guard themselves.

The target pins TCG identities and the production API origin documented in
`docs/DEPLOYMENT_TEMPLATE.md`. Fixture/local/wrong-project values, dotenv loading, dynamic
unreviewed app config overrides and partial native activation fail closed. Dormant native
dependencies do not activate ordinary local/web exports. Opted-in Android native builds
validate the registered service app/package/project and Google web client; iOS native
validation remains unsupported. Public-key shape is checked,
not ownership or deployed backend compatibility. Passing validates configuration only;
native Google, telemetry, signing, device acceptance, distribution approval and a
separately approved website cutover are still required. No cloud action is performed.
Ordinary local exports/test fixtures remain unchanged.

## Local Android beta release

Following Household's local Gradle → Firebase process, use
`npm run mobile:android:doctor`, then `npm run mobile:android:build:local`.
The Windows script retrieves missing TCG configs into ignored files, supplies reviewed
public values with dotenv disabled, validates Android configuration, preserves native
state with non-clean prebuild, and runs Gradle `assembleRelease` locally. No EAS Android
credits are used. The generated `android/` directory stays ignored.

The script creates and retains a unique release key in ignored `.native-release/`.
Securely back up both `tcg-release.jks` and `signing-password` before broader testing;
losing them prevents updates signed with this key. Do not commit or upload these files.
Unlike the inspected Household default, this path does not ship Expo's shared debug key.
Signing fingerprints must match the registered TCG Android app for Google sign-in.

After review, device acceptance and release approval, supply an existing TCG Firebase
tester group alias in `FIREBASE_TESTER_GROUPS`, then run
`npm run mobile:android:distribute:local`. Distribution checks a build receipt against
current app sources and APK bytes, verifies APK identity/version, and requires successful
CI for the exact main commit. Only an explicitly approved first internal feature build
may set `TCG_INTERNAL_BRANCH_RELEASE_APPROVED=1`. The website is this app's web export.
App Distribution must be initialized for TCG before upload. iOS will use EAS cloud once
its native configuration/signing is verified. New CI/CD automation follows the first
successful internal deployment, not before it.

## Tracking

See [parity tracker](../docs/requirements/expo-parity-tracker.md) and
[approved migration plan](../docs/requirements/2026-09-08-expo-universal-rewrite.md).
Money and FIFO calculations remain on the backend; estimates never become cost or profit.
