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
| Crack | Case/box suggestions and editable child quantities, bucket allocation, original dates/cost lineage, reverse | `crack.spec.ts` | Partial: web journey verified; device acceptance pending |
| Rip | Multiple hits, proportional allocation, empty/bulk writeoff, identity candidates/reuse, photo batches/manual fallback, reverse | `rip.spec.ts` | Partial: manual quantity/identity/retry verified; photos and preview pending |
| Grading | Send/date/company/fees, outstanding status, return identity and valuation, void safeguards | `grading.spec.ts` | Partial: send/return/reuse/void verified; valuations and API concurrency guards pending |
| Pricing | Catalog discovery/manual confirmation, variants/subtypes, mapping enable/disable, refresh, stale/unavailable, graded exclusions | `pricing.spec.ts` | Pending |
| Reports/Vault | Group/filter/month/tier/set/lineage, ageing, attention, manual valuations, appreciation separate from profit, CSV export | `rollups.spec.ts`, `vault.spec.ts`, `reports-chart.spec.ts`, `exports.spec.ts` | Partial: Vault and manual valuations implemented; reports/CSV pending |
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

Latest checkpoint: isolated `app/` now includes foundation, inventory/stock, Sales, Money,
manual transformations and grading. Next: photo adapters, grading/Vault valuations, pricing
controls, reports/exports and dashboard preferences, with the API grading integrity follow-on
below kept as a separate release-blocking concern. Do not claim device authentication or
workflow acceptance based only on bundle compilation. Full parity is not yet achieved.

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

Still incomplete at the first checkpoint: set-record suggestions/derived names, combined identity and
purchase editing convenience, product deletion, pricing mapping UI, global actions, the full
Dashboard, Sales/Money and remaining matrix rows. A route or form does not mean full parity.
Sales is the next bounded implementation assignment. Real-device auth/relaunch, Google native,
telemetry, signing/assets and cutover remain explicit release gates.

## Sales and correction follow-up

- Added Sales navigation, product-level recording, paginated/filterable Sales, server-side
  fee/FIFO previews, edit/void actions and account/store-credit proceeds. No CSV or shared
  60/90-day preference yet; only current backend-supported periods are offered.
- Added game-slug-scoped set selection with explicit suggestions and “did you mean” correction.
  Free-text entry remains available; no suggestion silently overwrites product identity.
- Independent review resumed after the usage reset. It caught an omitted-funding semantic
  mismatch: no-account purchases must send `[]`, not omit the field. Corrected and verified
  by both payload and unchanged member-balance assertions. The set picker UUID/slug mismatch
  was also corrected and verified by selecting a real seeded set and reading back identity.
- Expanded the browser journey to purchase edits, adjustment/void restoration, $25 sale
  profit, and actual store-credit balances ($75 after sale, $0 after void). Seven browser
  tests passed after these corrections. Screenshots are local ignored verification artifacts.
- Sales seller/proceeds default received a further independent review finding. Corrected:
  untouched proceeds follow the selected seller; explicit account/store/no-account choices
  remain fixed. Terra verified both this and the game-slug fix with no remaining targeted
  findings, and independently ran 24 passing unit tests. Broader device/parity gates remain.
- Next major slice: Money account/posting/transfer/adjustment screens, then transformations,
  grading, pricing/Vault, reports/CSV and shared dashboard period preferences. None of these
  pending rows are waived, and the production website still serves `web/dist`.

## 2026-09-09 Money checkpoint

Money owns separate cash/owed/store-credit account summaries, movement filtering and paging,
transfers, balance adjustments and independent-movement voids. Purchase/sale-linked money
must be corrected through its source transaction, never voided on the Money screen alone.

The current backend has a deliberate wire exception: transfers use decimal-dollar strings,
but `AdjustmentCreate.amount` is signed **integer cents**, bounded to 100,000,000,000 cents.
The new client must parse adjustment input exactly (digit splitting/BigInt before bounded
Number conversion), never `Number(dollars) * 100`. Backend membership, sign conversion and
ledger arithmetic remain unchanged. Movement offset already exists server-side; only the
new app's typed client needs its optional offset parameter exposed.

Implemented and connected the Money route, account cards, transfer/adjustment/void forms,
offset-aware filters and movement history. Linked purchase/sale entries have no independent
void action. Raw posting cash-flow signs are labelled separately from member amounts owed.

Validation: 31 app unit tests passed; typecheck, ESLint and ruff passed. Eight Expo browser
tests passed, with a further focused pass proving that voiding the $19.99 adjustment restores
the original balance after a $0.29 transfer and reversal. Android/iOS JavaScript exports
passed. These are bundle checks, not installed-device acceptance. Independent review found
no High issues and caught negative store-credit wording; corrected with positive/zero/negative
unit coverage. Terra confirmed the fix and independently reran 31 unit tests, typecheck
and lint successfully; no remaining finding in that targeted scope.

The Money browser run uses `tcg_expo_money_e2e` on the same loopback-only test container,
separate from the legacy Vite suite's `tcg_expo_test_e2e`. This prevents either suite's reset
from affecting the other. The legacy Vite regression run subsequently completed: all 111
tests passed (exit 0). No production data changed.

Next implementation milestone: crack/rip/grading workflows and their photo/lineage adapters.
Full Reports/Vault/pricing controls, split funding/proceeds UI, CSV, shared 60/90-day periods,
native device/release gates and cutover remain open. The rewrite is not production-ready.

## 2026-09-09 Transformation and grading checkpoint

This slice adds manual cracking/ripping and grading send/return/void flows to the isolated
Expo client. Product history shows the server's source/output costs, inherited purchase date,
bulk write-off, grading status and days away, with linked products and audited reversals.
Inline product creation must retain successful child IDs after a later operation fails,
and refresh cached lists even after a partial write. Identity edits must invalidate a reuse
choice; no candidate is silently selected and no client computes authoritative ledger cost.

Photo capture/upload adapters, before/after grading valuations, live rip allocation preview,
and a recursive lineage report remain explicit follow-ons, not completed parity. Manual rip
values are human-entered estimates, never AI-generated prices or realized profit. No changes
to backend, production Hosting, authentication or deployment are part of this slice.

Implemented manual case/box and generic-container cracking, explicit rip identity decisions
(candidate reuse or inline creation), per-hit quantity and decimal per-unit estimates, and
grading send/return/cancellation. New-child retries reuse the successful child ID; product
lists refresh even when only identity creation succeeded. Generic containers require an
explicit output type/count rather than inventing a box-size default. Duplicate rip rows for
the same product/bucket are refused with guidance to use quantity instead of client-side
averaging. A no-hit rip requires a separate complete bulk-write-off confirmation.

Independent review caught and drove fixes for generic-container support, selected-type
name suggestions, partial-create cache refresh, rip quantities, and grading availability/date
guards. Sending subtracts outstanding same-product/bucket submissions; returning rejects a
date before send, already-completed submissions, or insufficient stock in the original bucket.
The mutation re-reads stock/submissions before writing. Terra independently re-verified the
corrections with no remaining P1/P2 in that bounded scope. Cross-client integrity remains the
explicit backend gate below, not a waived finding.

Validation: 51 unit tests, TypeScript and ESLint pass. All 13 Expo browser tests pass against
the loopback disposable database. They cover exact $900.01 split cost and inherited dates,
$150.01 across two rip copies (not estimated profit), $590.59 grading cost including fees,
existing-slab reuse with no child creation, cancellation, whole-chain undo, and deliberately
rejected crack/rip/return requests followed by retries with only one child creation. Existing
Sales/Money/auth/responsive tests remain in this run. Android and iOS Hermes JavaScript
exports also pass; these are not installed-device acceptance. The unchanged Vite suite previously
completed all 111 tests. Backend and production data were not modified.

### Release-blocking backend follow-on discovered during review

`src/routes/grading.py` checks stock when sending but does not subtract other outstanding
submissions. Its return path lacks a fresh stock/date check, and the shared transformation
writer can represent negative stock. Client guards reduce accidental repeats but **cannot
enforce integrity across simultaneous clients**. Before release, separately harden the API
with transactional concurrency protection for send/return, cumulative outstanding quantities,
current-bucket stock and chronology validation, plus concurrency/regression tests. Keep this
separate from the frontend-only rewrite; do not mistake the new UI checks for a server fix.

## 2026-09-09 Manual valuation and Vault slice (in progress)

Add a dedicated Vault route and product/Vault manual valuation entry using the existing
authenticated endpoints. Valuations are dated, per-unit CAD estimates, including zero; an
unvalued holding stays unknown rather than falling back to cost. Slabs remain manually
valued. The Vault API's `value` is per unit, while `cost` and `appreciation` describe the
holding; display these server fields with explicit labels and do not recalculate them.
Provider market quotes remain a separate per-unit display and never replace manual values.

Keep the baseline annual manual-review indicator (older than 365 days) distinct from market
quote freshness. No scheduler, pricing provider, backend, auth or deployment changes in this
slice. Inline pre/post-grading valuation prompts, photo adapters, reports/exports and shared
60/90-day preferences remain tracked follow-ons.

Implemented `/vault` with local search, explicit manual/provider cards, quantities, server
cost/appreciation, holding age and Store history, annual review indicators, error/retry/empty
states, and product links. Product detail and Vault both open the reusable valuation form.
Its inputs start blank for value, retain exact decimal strings, and use a synchronous submit
guard as well as pending UI guards. Only the valuation endpoint is written.

Independent review found no P1/P2 in this bounded slice. Typecheck, ESLint and 55 unit tests
pass. All 15 Expo browser tests pass, including manual zero/older-date semantics, rejected
write recovery, market/manual separation, local search, report retry, and overflow checks at
390/768/1536 pixels. Android and iOS Hermes exports pass. Screenshot inspection confirmed the
Vault cards reflow without horizontal overflow; compact-navigation polish remains part of the
shared shell work rather than this report slice. No production data, Vite source, backend,
authentication or deployment setup changed.

## 2026-09-12 Shared reporting-period checkpoint

Cherry-picked the approved configurable-period work from PR #74 locally as `f386948`;
the PR itself remains unmerged. The API and legacy web client support All/YTD/MTD and
30/60/90 days, with a 60-day default. Focused backend reporting/sales validation passed
93 tests. Legacy web tracked-source ESLint, typecheck and build passed; the broad lint
command also scanned unrelated untracked Capacitor-generated files, which were preserved.

Expo Dashboard and Sales now share an AsyncStorage-backed preference with the same six
choices. Queries wait for hydration. Invalid saved values fall back safely, storage failures
retain the in-session choice, and serialized writes wait for invalid-value cleanup so rapid
changes cannot leave an older selection on disk. This is a device/browser-local preference,
not an account-synchronized setting.

Validation: TypeScript, ESLint and all 61 unit tests passed. All 16 Expo browser tests passed
against the disposable loopback database, including default 60 days, shared navigation state
and reload persistence. The React checklist was applied. No installed-device acceptance or
independent review is claimed for this slice.

Token-conscious delegation used fresh bounded implementation contexts. Both period and
Reports agents then hit the account usage limit (reported reset September 15, 07:14).
The partial period implementation was integrated and its hydration race/test timing fixed
locally; no replacement agents were launched into the same limit. Reports produced no screen,
and its unfinished navigation link was removed. Resume with a bounded Reports implementation
and consolidated independent review when delegation is available.

Reports/CSV, pricing controls, photo adapters, remaining grading valuation prompts, shared
shell/dashboard polish and native release gates remain open. The transactional grading API
integrity gate above remains release-blocking. No push, deployment, cutover or production data
changes occurred; the existing website stays on its current deployed implementation.
