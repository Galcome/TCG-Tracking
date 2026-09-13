# First native Android internal release

Production intent: live app; internal Android beta first. Joseph approved native Firebase
registration and local Gradle → Firebase distribution, with iOS using EAS cloud.
CI/CD automation is deferred until the first app is distributed. Existing Vite Hosting
and production data remain unchanged; no main merge/cutover is implied.

## Implementation and gates

- Registered Android `1:304233430839:android:75a3507eda63cefe3b64b2` and iOS
  `1:304233430839:ios:c1b31c756ff1e22f3b64b2` in existing `tcg-tracking`, both
  `com.galcome.tcgtracking`. Matching configs are ignored local files, not Git content.
- Android-only native build opt-in validates project/app/package/Google OAuth client.
  Ordinary exports retain dormant native configuration and platform-separated adapters.
- Google ID tokens become credentials for existing JS Firebase Auth/AsyncStorage;
  Firebase-first signout keeps failed persistence visible. Lazy native telemetry adds
  allowlisted screen and app-version attributes without copying IDs/tokens/API errors.
- Local release commands mirror Household operationally, with a unique retained TCG
  release signing key rather than its default Expo debug key. Signing artifacts stay
  ignored and require secure backup. No Android EAS build is needed.
- Distribution requires an unchanged source/APK receipt, package/version verification,
  explicit tester aliases and exact-main green CI. An explicit first-internal-build
  feature exception was requested asynchronously; it is not inferred from release intent.
- Firebase group listing returns HTTP404 `NOT_FOUND`. Browser automation failed twice
  during initialization, so first-time App Distribution setup cannot be inspected here.
  Joseph was asked to initialize it and provide TCG tester aliases. No upload occurred.
- iOS native plist/plugins/OAuth/signing validation and EAS project/build remain pending;
  the existing EAS account is authenticated, but no cloud build was launched.

Validation and final review/build outcome are recorded in the parity tracker. APK build
success does not prove email/Google login, token refresh, kill/relaunch, camera permissions,
CSV sharing, keyboard/safe areas or Crashlytics receipt on an installed device. Never
distribute a forced-crash-on-launch build merely to satisfy telemetry verification.

September 13 outcome: final local Android APK packaged and verified against its source/byte
receipt, approved certificate, package/version and embedded production/native configuration.
Work is pushed to draft PR #82. Expo CI passes 107 units and 31 browser tests plus fixture
bundle exports. A deterministic backend coverage test is pushed for CI validation; local DB
auth blocks that test locally. No App Distribution upload or production deployment occurred.

September 13 follow-on: Joseph authorized the normal main release path and conditional
website cutover. PR #82's final checks passed and it merged as `1850890`; its Railway API
deployment succeeded. Firebase now lists `alpha` with one tester. Android upload awaits
exact-main green CI; no branch exception is used. Expo web has an isolated production-config
preview, but live Hosting remains Vite until authenticated parity and a separate reviewed
deploy/rollback change pass. See the parity tracker's approved rollout checkpoint.

Distribution completed: exact-main CI passed and verified Android **0.1.0 (1)** was
uploaded/distributed to **`alpha`**, Firebase release **`6g3rouq688fb0`**. No Android EAS
build was used. Installed-device acceptance and secure signing-key backup remain pending.
Dependency availability fixes and authenticated preview parity are required before broad
Expo distribution or live website cutover. CI/CD follow-up starts after this checkpoint.
