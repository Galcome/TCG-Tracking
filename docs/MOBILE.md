# Mobile packaging

TCG Investments remains one Vite/React application. The browser build is deployed to
Firebase Hosting as it is today; Capacitor packages the same compiled `web/dist` assets in
native iOS and Android shells. Both shells call the existing FastAPI API and Firebase Auth,
so there is no second mobile database or business-logic implementation to keep in sync.

```text
web/src + web/dist
       ├── Firebase Hosting (web/PWA)
       ├── Capacitor Android (web/android)
       └── Capacitor iOS (web/ios)
                  │
                  └── existing API + Firebase Auth + Neon database
```

## Prerequisites

- Node.js 22 or newer (the current Capacitor 8 CLI requires it).
- Android Studio 2025.2.1 or newer with Android SDK API 36, build tools, an emulator or
  device, and platform support for Android API 24 or newer.
- iOS development requires macOS with Xcode 26. The iOS project can be generated on
  Windows, but it cannot be built or run there.
- A local copy of the repository and `npm ci` run from `web/`.

Android's SDK location is kept in the developer's ignored `web/android/local.properties`; no
machine-specific paths are committed. Signing keys and release credentials stay outside Git.

## Environment setup

Copy `web/.env.example` to `web/.env` and fill in the existing Vite variables. Native builds
need the same values as the browser build, especially `VITE_API_URL` pointing to the reachable
HTTPS API and the Firebase web configuration. Vite variables are public client configuration;
do not put API secrets in them.

The native shells load bundled assets and deliberately do not use Capacitor's
`server.url`. `web/capacitor.config.ts` keeps the secure defaults explicit:

- Android local origin: `https://localhost`.
- iOS local origin: `capacitor://localhost`.
- Android mixed content and cleartext traffic: disabled.
- Native release logging: disabled by Capacitor's `debug` logging policy; debug builds remain
  inspectable during development.

Append both native origins to the API's existing production `ALLOWED_ORIGINS` value before
testing authenticated API calls from a device:

```text
ALLOWED_ORIGINS=https://tcg-tracking.web.app,https://localhost,capacitor://localhost
```

Keep the Firebase Hosting origin and any approved custom web origin in that list too. This is
an API deployment setting; this foundation does not mutate production environments.

## Commands

Run these from `web/`:

```powershell
npm ci
npm run dev                 # normal browser development
npm run build               # web production build, including the PWA service worker
npm run preview             # preview the web production build

npm run mobile:build        # production bundle without PWA service-worker generation
npm run mobile:sync         # mobile bundle, then copy it into both native projects
npm run mobile:open:android # open Android Studio
npm run mobile:open:ios     # open Xcode (macOS)
npm run mobile:run:android # build/install on a connected Android device or emulator
npm run mobile:run:ios      # build/install on a configured iOS device (macOS)
npx cap doctor
```

`npm run build` is still the normal web deployment path. `mobile:build` uses the `mobile`
Vite mode, which leaves the browser PWA manifest/service worker out of the native bundle;
`main.tsx` also refuses to register a browser service worker from a native WebView. The PWA
precaches only immutable app-shell assets and has no runtime cache for API, auth, uploads, or
ledger data.

## Firebase native registration

The web Firebase app remains the runtime configuration for this beta. Before a store release,
register platform apps in the same Firebase project:

1. Add an Android app with package `com.galcome.tcgtracking` and place the downloaded
   `google-services.json` at `web/android/app/google-services.json` locally or in CI. It is
   ignored and must never be committed.
2. Add an iOS app with bundle identifier `com.galcome.tcgtracking` and place the downloaded
   `GoogleService-Info.plist` in the iOS target through Xcode locally or via the release
   pipeline. It is ignored and must never be committed.
3. Confirm the native app registrations use the same Firebase project as
   `VITE_FIREBASE_PROJECT_ID` and the API's `FIREBASE_PROJECT_ID`.

Email/password is the supported native beta sign-in path. Native Google sign-in is a release
gate: the current Google popup/redirect flow is intentionally hidden in a Capacitor WebView
until a native Google provider implementation, URL-scheme return path, Firebase platform
configuration, and real-device tests are complete. The web Google button remains unchanged.

## Camera and device checklist

The existing photo input is used; no second card-reading implementation is introduced.
Validate on real devices before distributing a build:

- First photo capture prompts for camera access and the app explains why it is needed.
- Denying camera access gives a recoverable file-picker/error path; granting it allows the
  rear-camera capture flow on the rip screen.
- Selecting an existing photo still works without granting camera access.
- A captured photo reaches the API and the card suggestions remain editable before saving.
- Large/missing-length upload protection still returns a readable 413 response.
- Sign in with email/password, sign out, and token refresh work after relaunch.
- API calls succeed from both `https://localhost` (Android) and `capacitor://localhost` (iOS)
  after the CORS allowlist is updated.
- Notch/home-indicator safe areas, keyboard focus, scrolling, back navigation, rotation, and
  dark surfaces behave correctly.
- Offline or sleeping-API failures remain recoverable; no stale ledger data is shown by a
  native service worker.

## Web deployment remains unchanged

The Firebase Hosting workflow continues to build and deploy `web/dist` with `npm run build`.
Do not use `mobile:build` as the web deployment artifact, because that mode intentionally
omits the browser PWA service worker and generated manifest. Native sync copies a separate
mobile bundle into ignored platform asset directories and never changes Firebase Hosting.

## Version and release workflow

Keep the web package and native display versions aligned before a release. Update
`web/package.json` as the source version, then update Android `versionName`/`versionCode` and
iOS `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` in the native projects. A version code must
increase for every Android upload; iOS build numbers must also be unique.

Native release work happens only from the exact CI-green `main` commit:

1. Verify backend migrations, API CORS origins, Firebase platform registrations, and release
   secrets outside Git.
2. Run web lint/typecheck/build and `npm run mobile:sync`.
3. Run `npx cap doctor`, device checks, and the platform release build in Android Studio/Xcode.
4. Sign outside the repository and submit through Google Play/TestFlight/App Store Connect.

This initial foundation does not include signing keys, service files, native Google auth,
push notifications, background jobs, or generated build output.
