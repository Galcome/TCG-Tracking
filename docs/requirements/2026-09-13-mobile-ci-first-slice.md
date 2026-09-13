# Post-alpha mobile CI

Production intent: live. Android 0.1.0 (1) was distributed locally through Gradle and
Firebase to `alpha` (release `6g3rouq688fb0`) after exact-main CI passed for PR #82.
Joseph asked for CI/CD work after that checkpoint; Android must remain local Gradle,
Firebase distribution remains deliberate, and iOS builds use EAS cloud.

## First slice

- Run the existing non-deploying Expo checks on every `main`/`dev` push, not just
  feature pushes. Keep scoped pull-request checks and manual dispatch.
- Remove duplicate feature-push/PR Expo runs; cancel superseded runs for the same
  branch or PR. Main checks intentionally have no path filter so even docs-only
  merge commits have an exact-commit validation result.
- Retain Node 22, pinned actions, lint/types, unit/browser checks, and native fixture
  exports. No real service credentials or release artifacts enter these checks.
- Do not change Vite Hosting, start cloud builds, upload another APK, or weaken the
  local source/byte/signature/main-CI guards in this slice.

## Remaining work / gates

Wire exact-main Expo success into the mobile release guard with focused tests, including
superseded/cancelled/missing runs. Make source fingerprint ordering runtime-independent
without rewriting existing receipts; changed app sources require a new higher-version
APK and receipt. Resolve PyJWT and Expo decoder availability advisories before broad
Expo rollout. Device login/persistence/camera/share/telemetry and authenticated preview
parity still need acceptance. A separately reviewed Hosting/CI switch with Vite rollback
must precede an Expo live-site promotion. Native iOS configuration/signing validation
must precede any EAS-cloud release workflow; never copy Household credentials or its
historical Android EAS workflow. Keep this first CI PR separate from dependency fixes.
