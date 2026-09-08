# Expo rewrite parity tracker

Source plan: [approved rewrite](2026-09-08-expo-universal-rewrite.md).
Baseline: `origin/main` c1c21b3; PR73 bucket visuals and PR74 reporting periods are approved
requirements in addition to that baseline. Current production build remains `web/dist`.

## Workflow inventory

Status means verified parity, not just that a route exists. All feature rows begin pending.
Each implementation task owns its screen/forms and tests; shared primitives stay with the
foundation owner until its interface is stable.

| Area | Required flows and states | Existing verification reference | Status |
| --- | --- | --- | --- |
| Auth and shell | Email and Google login, restore/refresh session, membership rejection, signout, retry, deep links, global actions, responsive navigation | `web/e2e/nav.spec.ts`, `mobile.spec.ts`; backend auth tests | In progress |
| Dashboard | Profit/cost/cash distinctions, attention flags, recent sales, scoped reports, shared persisted All/YTD/MTD/30/60/90 default60 | `balance.spec.ts`, `reports-chart.spec.ts`; PR74 | Pending |
| Inventory | Search/game/stock/bucket filters, paging, accessible bucket colours, aligned counts, estimate source/date/status | `buckets.spec.ts`, `bucket-journey.spec.ts`; PR73 | Pending |
| Products | Add/edit/archive/delete safeguards; taxonomy, set suggestions, language/collector/variant/slab identity; history | `add-product.spec.ts`, `sets.spec.ts`, `ledger.spec.ts` | Pending |
| Purchases/stock | Purchase funding and fees, adjustments, bucket moves, edits/void reasons, invalid/unknown/zero costs | `ledger.spec.ts`, `money.spec.ts`, `buckets.spec.ts` | Pending |
| Sales | Search/member/marketplace/period filters, server preview, sale entry/edit/void, proceeds funding, unknown costs, CSV | `sales.spec.ts`, `store-credit.spec.ts`, `exports.spec.ts` | Pending |
| Money | Joint/member/store-credit accounts, postings, transfer, adjustment, void, partial funding/proceeds | `money.spec.ts`, `store-credit.spec.ts`, `balance.spec.ts` | Pending |
| Crack | Case/box suggestions and editable child quantities, bucket allocation, original dates/cost lineage, reverse | `crack.spec.ts` | Pending |
| Rip | Multiple hits, proportional allocation, empty/bulk writeoff, identity candidates/reuse, photo batches/manual fallback, reverse | `rip.spec.ts` | Pending |
| Grading | Send/date/company/fees, outstanding status, return identity and valuation, void safeguards | `grading.spec.ts` | Pending |
| Pricing | Catalog discovery/manual confirmation, variants/subtypes, mapping enable/disable, refresh, stale/unavailable, graded exclusions | `pricing.spec.ts` | Pending |
| Reports/Vault | Group/filter/month/tier/set/lineage, ageing, attention, manual valuations, appreciation separate from profit, CSV export | `rollups.spec.ts`, `vault.spec.ts`, `reports-chart.spec.ts`, `exports.spec.ts` | Pending |
| Platform adapters | Native photo URI/browser File, CSV download/native sharing, safe area/keyboard, denied permissions, app relaunch | New Expo device and browser tests | Pending |
| Release/cutover | Separate exports/preview, production env validation, native identifiers/signing/telemetry, exact-version checks, website rollback | Approved plan stage8/9 | Pending |

## Acceptance evidence

- Baseline route/flow inventory recorded above. Baseline screenshots and equivalence tests
  at 390, 768 and 1536 pixels remain pending.
- Dedicated local Postgres container `tcg-expo-e2e-postgres` binds only 127.0.0.1:55438.
  `tcg_expo_test_e2e` is disposable rewrite test data. Migrations through 0012 applied.
  Credentials are local test values supplied at command time, never production credentials.
- Preserve backend FIFO/integer-cents behavior and all existing web workflows. Test writes
  target only the dedicated local test database.
- No production deployment, auth project change, source PR merge or website cutover performed.

## Current assignment

Foundation: new `app/`, Expo Router, environment checks, theme/shell, Firebase platform
adapters, session/query isolation, typed transport and protected member/dashboard vertical
slice. Do not claim device authentication acceptance based only on bundle compilation.

## 2026-09-08 checkpoint

- Expo 57 / React Native 0.86 / Router 57 selected as a compatible maintained package set;
  lockfile committed with the app. `expo install --check` passed. EAS keeps local version
  sourcing to match the inspected Household configuration. Web is a static SPA (`single`)
  export so arbitrary authenticated product UUID deep links do not need prerendering.
- Implemented email/password auth, browser Google adapter, native AsyncStorage persistence,
  per-request tokens, membership gating, account-scoped caches and stale-response guards.
  Terra reviewed the auth boundary; sign-out error handling was corrected. Native adapter
  resolution was verified against Metro (an initial finding was withdrawn).
- Implemented inventory filters/paging/bucket colours and read-only market estimates;
  product identity/history; add/edit/archive product, purchase, move, adjustment, transaction
  edit and void forms. Writes preserve decimal strings and invalidate server queries.
  Explicit no-funding selection is distinct from the initial member-account default.
- Local checks: 17 unit tests passed, TypeScript and ESLint passed; Expo web and Android/iOS
  JavaScript exports passed. Six real-browser tests passed: Firebase SDK session restore and
  sign-out, denied membership, product deep links at 390/768/1536 widths, and a create/edit/
  purchase/move/void journey preserving exact $94.33 server cost and bucket quantities.
- Real API tests use only the dedicated test databases. Backend regression run: 786 passed,
  one failed, 100% coverage. Existing `test_vault_keeps_manual_valuation_separate_from_market_estimate`
  seeds a 2026-08-28 quote and expects fresh; by September 8 the API correctly marks it stale.
  No backend source or test was changed to hide this unrelated baseline failure.
- Added isolated `expo-checks.yml`: no deployment, production secrets or release artifacts.
  Existing Hosting/deployment configuration is untouched. Remote CI has not run yet.
- `npm audit` currently reports 13 moderate transitive advisories, no high/critical findings;
  dependency remediation/release review remains open. No forced major downgrade applied.
- Terra's independent **forms** review was blocked by its usage limit. Root integration and
  browser checks completed; do not treat that as independent review acceptance.

Still incomplete in this slice: set-record suggestions/derived names, combined identity and
purchase editing convenience, product deletion, pricing mapping UI, global actions, the full
Dashboard, Sales/Money and remaining matrix rows. A route or form does not mean full parity.
Sales is the next bounded implementation assignment. Real-device auth/relaunch, Google native,
telemetry, signing/assets and cutover remain explicit release gates.
