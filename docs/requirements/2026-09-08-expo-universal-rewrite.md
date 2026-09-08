# Expo universal application rewrite

## Production intent and status

Live app. Reviewed migration plan dated 2026-09-08. Application implementation is pending.
Joseph owns product decisions and production cutover approval; Astra owns technical acceptance.
The existing website must continue serving throughout development of the replacement.

## Reference standard and findings

Household's inspected application uses Expo ~54.0.34, React Native 0.81.5, Expo Router
~6.0.23, React Native Web ^0.21.0 and TypeScript. Its web output is a Metro static export.
It uses themed React Native primitives, responsive desktop/sidebar and mobile/tab layouts,
and EAS development, preview/internal APK and production profiles. EAS version sourcing
is currently local. Native release scripts support local Android builds and distribution.

Reference files in `C:/Users/josep/Git/Household/`:

- `app/package.json`, `app/app.json`, `app/eas.json`: framework and build contracts.
- `app/components/household-shell.tsx`, `app/context/ThemeContext.tsx`: layout and theme.
- `app/hooks/useApi.ts`, `app/lib/supabase.ts`: centralized transport and platform storage.
- `app/scripts/mobile/android-local-release.mjs`: operational release pattern.

Adopt the framework and operating patterns. Household's Supabase identity system, project
IDs, fonts, dependency overrides and business components are specific to that application.
Select and lock a maintained, compatible Expo package set during scaffolding; the observed
Household versions are evidence of its current configuration, not a mandatory version pin.
Official references: [Expo Router](https://docs.expo.dev/router/introduction/) and
[Firebase with Expo](https://docs.expo.dev/guides/using-firebase/).

TCG remains Vite/React on Firebase Hosting (`web/dist`). Firebase Auth, FastAPI on Railway,
Neon with deliberate NullPool, FIFO accounting and pricing jobs remain authoritative.
See [API contracts](../../web/src/api.ts), [hosting](../../firebase.json),
[product requirements](excel-replacement.md) and [deployment constraints](../GOTCHAS.md).

## Architecture

Build a sibling `app/` containing Expo Router screens, React Native components, a theme
provider and responsive layout helpers. It will eventually serve Android, iOS and web.
Keep `web/` and its production build/deployment intact until the final cutover.

- Preserve the current Firebase project, UIDs, membership allowlist and versioned API.
- Keep TanStack Query for server state; clear user-specific caches on sign-out/account change.
- Define a platform-neutral typed client with injected base URL, token provider and transport.
  It must not import React, Firebase globals or browser-only types. Start in the new app;
  extract a shared package only where it removes actual duplication. Vite adoption gets a
  separate compatibility change with its existing tests intact.
- Keep money as decimal strings over the API. Server calculations retain cost basis,
  quantities, proceeds, profit, unknown-versus-zero semantics and pricing/valuation separation.
- Rewrite DOM/Tailwind components using React Native primitives and StyleSheet/theme tokens.
  Share contracts and product behavior; provide platform adapters for camera multipart
  uploads, CSV download/share, navigation, keyboard and safe areas.
- Use the same Firebase identity through platform auth adapters. Prove native persistence
  across process kill/relaunch and refresh tokens per request. Google sign-in must produce
  a Firebase credential for the same project; native provider configuration/account-linking
  errors require device tests. Expo Go cannot prove native Google or telemetry integrations.

No backend rewrite, database migration, auth-provider migration or offline write queue is
required. Any necessary API additions must remain compatible with both clients.

## Existing open work

As checked on 2026-09-08, PR75 (Capacitor) is open and unmerged. This plan supersedes its
architecture; keep it out of the Expo dependency chain. No PR is closed or merged here.
PR73 and PR74 also remain open. Their user-approved requirements belong in the parity matrix:

- Accessible Inventory/Store/Vault colours and aligned quantity columns.
- Shared, persisted Dashboard/Sales/Reports period selection: All/YTD/MTD and exact
  30/60/90-day windows, with 60 days on first use. Track source PR disposition during the port.

## Implementation sequence and acceptance

All implementation stages are pending. Each slice records changed files, tests, evidence and
remaining limitations so subsequent agents can continue without re-exploring the repository.

| Stage | Deliverable | Acceptance gate |
| --- | --- | --- |
| 1 | Baseline route/workflow matrix from current web and open approved changes | Every read, mutation, correction, export and loading/error state accounted for |
| 2 | Independent Expo scaffold, theme, responsive shell, routes and validated configuration | Web and native exports pass; existing Vite build and hosting output unchanged |
| 3 | Firebase auth, typed transport and protected `/api/v1/members/me` vertical slice | Allowed user succeeds; non-member denied; persistence, sign-out, expiry and retry behavior tested on web and Android |
| 4 | Inventory/product search, filters, paging, purchases, moves, adjustments, product history and pricing mappings | Bucket counts, identity and server-derived costs match; mutations and corrections invalidate affected queries |
| 5 | Sales and money: previews, entry/edit/void, accounts, funding/proceeds, store credit, transfers | Same test fixtures produce matching balances, quantities and profit in both clients |
| 6 | Cracking, ripping/hits/bulk, grading, lineage, photos and valuations | Original dates and cost lineage preserved; denied/failed photo access recovers to manual entry |
| 7 | Dashboard, reporting, Vault, period configuration and CSV | Report/filter parity; correct unknown/zero values; downloads work on web and sharing works on native |
| 8 | Native release configuration, observability, icons, device testing and isolated web preview | Android APK and iOS native acceptance recorded; web workflows verified at 390/768/1536 widths |
| 9 | Dedicated website cutover and retirement after a soak period | Joseph approves evidence; known-good Vite artifact available and rollback procedure verified |

The baseline includes `/`, `/inventory`, `/sales`, `/money`, `/products/:productId`,
`/reports`, global add-product/record-sale actions, grading/transformation reversals,
manual Vault valuations, catalog matching/refresh, and filtered exports. Preserve the PRD's
financial invariants and current backend behavior. Do not quietly drop a workflow while porting.

## Keeping the website available

Keep Firebase Hosting serving `web/dist` throughout stages 1-8. Build Expo web to a separate
output and preview destination. Configure the exact preview domain in Firebase Auth and
API CORS when needed; React Native does not inherit Capacitor's local web origins.
Use dedicated test data/environments for mutation tests. Production comparisons are read-only
unless a specific test write is authorized. Both clients use the same API contracts.

Existing backend/Vite checks remain active. Add scoped Expo typechecking, tests, web/native
exports and equivalent workflow tests. Test sign-in/refresh/relaunch, membership rejection,
deep links, camera denial/capture, upload limits, CSV and financial correction paths.
Reconcile preview/prod environment values and Firebase/native IDs before device distribution.
Never copy Household project IDs or signing/service credentials. Keep secrets out of Git.

Use Android internal beta first, with iOS acceptance through macOS/Xcode or an appropriate
EAS build and actual device testing. Native Google and required observability are release
gates; email/password can validate the first internal vertical slice.

The final hosting switch requires a separately reviewed deployment change and Joseph's
approval. Verify release mechanics because a normal main push can also trigger API deployment.
Retain the last good Vite source/artifact through the soak period. A website rollback restores
that hosting artifact without restoring the database. Mobile rollback needs its own tested
release path; store-installed apps generally require a new higher-version corrective build.
Only use OTA updates when compatible with the installed native runtime.

## Agent and token budget discipline

Astra owns the acceptance matrix and integration. Sol handles architecture at material
boundaries. Luna implements one bounded slice at a time with explicit file ownership and
fresh context. Terra independently reviews meaningful implementation diffs; Luna fixes
confirmed findings. Parallelize only independent work with little coordination overhead.
Reuse this specification and recorded evidence; avoid full-history forks, repeated broad
scans, duplicate tests after unchanged results, and long CI/EAS polling. Each milestone ends
with a concise status and next task. Framework standardization does not require identical
project IDs, credentials, backend providers or copying unrelated Household features.

## Decisions resolved during implementation

Choose compatible SDK versions at scaffold time, reconcile local/remote EAS version policy,
and record the TCG preview host, native Firebase registrations and release identities.
These are technical implementation choices; production cutover remains a final user decision.
