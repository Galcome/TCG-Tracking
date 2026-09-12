# Expo rewrite parity tracker

Source plan: [approved rewrite](2026-09-08-expo-universal-rewrite.md).
Baseline: `origin/main` c1c21b3; PR73 bucket visuals and PR74 reporting periods are approved
requirements in addition to that baseline. Current production build remains `web/dist`.

## Workflow inventory

Status means verified parity, not just that a route exists. Checkpoints below record evidence;
partial rows retain their explicit unfinished flows and device/release gates.
Each implementation task owns its screen/forms and tests; shared primitives stay with the
foundation owner until its interface is stable.

| Area | Required flows and states | Existing verification reference | Status |
| --- | --- | --- | --- |
| Auth and shell | Email and Google login, restore/refresh session, membership rejection, signout, retry, deep links, global actions, responsive navigation | `web/e2e/nav.spec.ts`, `mobile.spec.ts`; backend auth tests | In progress |
| Dashboard | Profit/cost/cash distinctions, attention flags, recent sales, scoped reports, shared persisted All/YTD/MTD/30/60/90 default60 | `balance.spec.ts`, `reports-chart.spec.ts`; PR74 | Partial: scoped figures/recent sales, shared monthly trend and compact shell verified; device acceptance pending |
| Inventory | Search/game/stock/bucket filters, paging, accessible bucket colours, aligned counts, estimate source/date/status | `buckets.spec.ts`, `bucket-journey.spec.ts`; PR73 | Partial: browser list/buckets/responsiveness and taxonomy/archive flows verified; device acceptance pending |
| Products | Add/edit/archive/delete safeguards; taxonomy, set suggestions, language/collector/variant/slab identity; history | `add-product.spec.ts`, `sets.spec.ts`, `ledger.spec.ts` | Partial: identity/history and archive/delete browser flows verified; native acceptance pending |
| Purchases/stock | Purchase funding and fees, adjustments, bucket moves, edits/void reasons, invalid/unknown/zero costs | `ledger.spec.ts`, `money.spec.ts`, `buckets.spec.ts` | Partial: browser operations and exact split funding verified; device acceptance pending |
| Sales | Search/member/marketplace/period filters, server preview, sale entry/edit/void, proceeds funding, unknown costs, CSV | `sales.spec.ts`, `store-credit.spec.ts`, `exports.spec.ts` | Partial: web flows, CSV and split proceeds verified; device acceptance pending |
| Money | Joint/member/store-credit accounts, postings, transfer, adjustment, void, partial funding/proceeds | `money.spec.ts`, `store-credit.spec.ts`, `balance.spec.ts` | Partial: browser account/movement and split funding/proceeds verified; device acceptance pending |
| Crack | Case/box suggestions and editable child quantities, bucket allocation, original dates/cost lineage, reverse | `crack.spec.ts` | Partial: web journey verified; device acceptance pending |
| Rip | Multiple hits, proportional allocation, empty/bulk writeoff, identity candidates/reuse, photo batches/manual fallback, reverse | `rip.spec.ts` | Partial: manual and browser photo suggestions verified; native photos and allocation preview pending |
| Grading | Send/date/company/fees, outstanding status, return identity and valuation, void safeguards | `grading.spec.ts` | Partial: send/return/reuse/void and optional valuations verified; concurrency review follow-ups in progress |
| Pricing | Catalog discovery/manual confirmation, variants/subtypes, mapping enable/disable, refresh, stale/unavailable, graded exclusions | `pricing.spec.ts` | Partial: controls/unit guards and real mapping writes verified; expanded discovery/device acceptance pending |
| Reports/Vault | Group/filter/month/tier/set/lineage, ageing, attention, manual valuations, appreciation separate from profit, CSV export | `rollups.spec.ts`, `vault.spec.ts`, `reports-chart.spec.ts`, `exports.spec.ts` | Partial: browser reports/Vault/lineage/CSV verified; native sharing and consolidated review pending |
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

Latest checkpoint: isolated `app/` includes inventory/stock, Sales/Money with splits,
transformations, grading/Vault valuations, browser photo suggestions, pricing, reports/CSV,
shared periods and compact navigation. Next: independent concurrency review fixes,
authoritative rip allocation preview, Dashboard trend and native release preparation.
Keep backend integrity fixes isolated and release-blocking. Do not claim device authentication or
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

## 2026-09-12 Bounded Reports checkpoint

Added the Expo Reports route and navigation with grouped performance by game, product,
type, set, channel and seller; game/set/type filters; profit/ROI/profit-per-day/hold-time
sorting; stock-age bands; return-versus-time rankings; and month summaries. Grouped requests
use the shared hydrated period preference. Monthly trends deliberately use the independent
all-time endpoint and are labeled as independent of the selected period. No combined totals
across realized profit, unrealized holdings or lineage are invented.

Integration and independent review drove corrections for unknown-last sorting and exact CAD
display. Reports uses a string-only money formatter so even `90071992547409.91` retains its
last cent; null stays unknown and zero stays explicit. Other screens' pre-existing shared
`Number`-based formatter remains a separately tracked precision follow-on, not fixed here.
Financial sorting compares monetary decimal strings without floating-point conversion.

Validation: 67 unit tests, TypeScript and ESLint passed. All 17 Expo browser tests passed,
including filtered request propagation/clearing, read rejection and retry, exact large-value
rendering, unknown/zero sorting, the period shared across Dashboard/Sales/Reports and reload,
and overflow checks at 390/768/1536 pixels. Screenshot inspection confirmed responsive report
controls. Terra independently re-reviewed the precision correction with no remaining P1/P2
in this bounded slice; the React checklist was applied.
Android and iOS Hermes JavaScript exports passed in separate output directories; these are
not APK/device acceptance or evidence of native sign-in persistence.

The named coder profile was unavailable; explicit Luna/max with fresh bounded context was
used instead, followed by Terra review. An initial browser run was stopped after an overlapping
plain export replaced the test-configured `app/dist` and disabled sign-in. The final build/run
was serialized and passed. Future exports must use distinct output directories or coordinate
with browser runs; do not treat an overwritten test bundle as an application-auth regression.

Tier/set-holding/aging/attention/lineage reports, CSV/platform sharing, pricing controls,
photo adapters, remaining grading valuation prompts, compact shell/dashboard polish and
native release acceptance remain open. The transactional grading API integrity gate remains
release-blocking. No backend, legacy Vite source, auth, deployment or production data changed.
No push or production cutover occurred.

## 2026-09-12 Tier, holdings, aging and attention checkpoint

Added read-only Tier performance, Set holdings, Stock aging and Data attention sections
to Expo Reports. Tier shows lifetime strategy outcomes with median/range context. Set
holdings keep realized sales, Store at cost and Vault at cost separate. Aging shows current
unsold non-Vault lots (Inventory and Store), including explicit undated and zero-day cases.
Attention shows current unknown-cost and negative-stock warnings with product navigation.
These endpoints ignore the selected period and catalogue filters; that scope is labeled.
No ledger totals are calculated or overlapping strategy/lineage/holding figures summed.

Each section has independent loading, error/retry and honest empty states. A failed refresh
with cached rows explicitly says it is showing last loaded data. Exact string-based CAD
display and null-aware percentages are reused. Age grouping preserves server lot amounts
and uses linear accumulation rather than repeated full-array copying. Self-review corrected
the initial Store-only aging label against the backend's actual Vault-only exclusion.

Browser tests now export to `app/dist-e2e`, and the loopback test server serves only that
directory. Git and ESLint ignore the generated output. Normal `app/dist` exports cannot
replace the browser suite's test-configured bundle. This is test-only isolation, not a
production Hosting or CI/deployment change.

Validation: 70 unit tests, TypeScript, ESLint and focused Python ruff checks passed. Android
and iOS Hermes JavaScript exports passed in separate output directories; installed-device
acceptance remains open. Both new browser cases passed, covering empty states, independent
read rejection/retry, separate holding costs, large exact values, zero/unknown ages and
390/768/1536 overflow checks. Mobile screenshot capture was tightened to wait for the set
heading in the viewport after resize, and the targeted three-test rerun passed.

The first full browser run had 18 passes and one existing purchase-correction refresh failure:
the PATCH returned 200 and the disposable database contained the edited 2000 cents, but
the screen retained the previous total. The case passed on targeted rerun with no ledger
implementation changes. Keep this as an intermittent refresh follow-on, not a confirmed fix.
The final serial full-suite rerun passed all 19 browser tests (exit 0).

Luna/max implemented this bounded slice with fresh context. Independent review could not
start because the conversation reached the agent-thread limit; root self-review and browser
verification do not replace that gate. No independent-review pass is claimed for this slice.
The React checklist was applied. Lineage, CSV/native sharing, pricing controls, photos,
remaining grading valuations, compact shell/dashboard polish and native release acceptance
remain open, along with the existing transactional grading API release blocker. No backend,
legacy Vite source, authentication, production deployment or production data changed.

## 2026-09-12 CSV, lineage and photo checkpoint

Added grouped/inventory/Sales CSV exports with every page collected, explicit filter scope,
UTF-8 BOM, quoted cells and spreadsheet-formula neutralization. Incomplete, duplicate or
changing pages refuse a misleading partial download. Unknown amounts stay blank, zero stays
explicit, and export-only unit cost/ROI use exact integer-cents arithmetic, never ledger inputs.
Browser downloads and native sharing use separate platform adapters. Android chooser completion
does not prove the recipient has read the file: successful shares remain cached for 24-hour
next-export cleanup of only our named files; failed shares remove their owned file immediately.
Native file reading/sharing and denied/unavailable/cancel behavior still need device acceptance.

Product lineage shows server root cost, realized profit, remaining cost, write-offs and ROI
without adding overlapping Tier totals. Flattened preorder cards cap indentation, preserving
deep-tree readability at mobile widths. No-hit complete write-offs remain visible even without
children or sales. Root also replaced the shared floating-point CAD formatter with the existing
exact string formatter, so precision improvements now cover all screens, not only Reports.

Photo-assisted Rip uses existing authenticated backend identity recognition, not a new AI SDK
or client provider credentials. Five-photo batches upload sequentially; prior suggestions survive
a later failure, manual input is preserved, and set/collector/variant/language are editable.
No suggestion sets a value, selects a reuse/create decision or writes inventory. Permission denial,
reader failure and cancellation retain manual entry; no microphone permission is requested.

Validation before Dashboard/pricing additions: 22 browser tests passed; the additional photo
multipart/manual-preservation/no-write browser test passed. Typecheck, ESLint and 84 current
unit tests passed. Native exports passed before the photo addition; final expanded browser/native
checks are recorded in the next checkpoint. Expo-compatible SDK patch updates were applied,
and `expo install --check` then passed. Audit retains 14 moderate transitive advisories;
no forced major upgrade/downgrade was applied. Independent review remains blocked by the
agent-thread limit; root self-review and the React checklist do not replace that gate.

Pricing/Dashboard expanded checks, split funding/proceeds, grading valuation prompts,
compact shell, backend transactional grading integrity, native device/release acceptance and
approved cutover remain open. Existing production continues serving `web/dist`; no push,
deployment, production data changes or live website switch occurred.

### Expanded Dashboard/pricing validation

Dashboard now includes period purchases/cost-of-sales/average sale, scoped game performance
and recent sales. Lifetime invested/cash/store-credit/fees and bulk write-offs are explicitly
separate; backend inspection confirmed bulk write-offs ignore the selected period. No client
subtracts overlapping amounts or turns unrealized estimates into profit.

Product pricing controls provide bounded catalogue discovery or manual exact IDs, explicit
printing confirmation, enable/disable and global all-confirmed refresh with honest status/errors.
Eligibility mirrors the server's strict free raw-card/box/case boundary; slabs stay manual.
Mutation inputs are snapshots, synchronous guards prevent duplicate submissions, and selecting
a listing only fills a draft. Provider requests remain on the existing authenticated backend.

All 25 browser tests passed (exit 0), including actual mapping create/disable/re-enable with
unchanged $10.01 ledger cost/stock, intercepted provider-failure display, precise large Dashboard
values, multipart photo suggestions and prior CSV/lineage/accounting/auth journeys. The first
expanded run had 24 passes and one fixture failure: Dashboard's new game query consumed the
rejection intended for Reports. Scoping that fixture to the Reports route fixed the test, without
changing retry behavior. Android/iOS Hermes exports passed with photo/pricing included;
these are not installed app builds. SDK compatibility check passed. No Android devices were
listed by `adb devices -l`; real-device acceptance remains open. Independent review still
cannot start at the agent-thread limit. No push, deployment or production cutover occurred.

## 2026-09-12 Catalogue, grading valuations and allocation checkpoint

Catalogue management now offers confirmed archive/restore and typed `DELETE` confirmation.
The API remains the deletion authority, including voided history. Browser checks prove
archive preserves stock and $10.01 cost, restore works, history blocks deletion, and an
empty mistaken product can be deleted. Inventory includes type/archive filters; global
New product reuses the existing authenticated form. Browser photo selection also restores
after cancellation on older browsers using a scoped focus fallback.

Optional manual valuation prompts are explicitly opted into before grading send/return;
defaults preserve the existing fast workflow. Prompts open only after the grading transaction
commits and use that operation's date/product. Valuation rejection/retry/skip never repeats
send/return, and zero remains valid. Provider estimates do not supply slab values. Synchronous
submit guards cover grading, valuation and shared stock/sale forms.

Added complete multi-account funding and mixed account/store-credit proceeds. Exact integer
cents validate input sums only: landed funding includes shipping/tax/fees, whereas proceeds
match the server's net preview. Every allocation carries an explicit decimal amount; duplicate
destinations and incomplete splits are rejected. Server accounting/access checks remain final.
The browser proves $10.01 + $0.29 shipping posts as -$5.10/-$5.20, and a $20 sale split $10
account/$10 store credit preserves server realized profit $9.70. Corrections still rescale
existing splits through backend behavior rather than silently replacing them with one account.

Validation: 86 unit tests, typecheck and ESLint passed. The final serial full browser suite
passed all 28 tests (exit 0); Android/iOS Hermes exports passed. An earlier run had 27 passes
and one test timing failure: search was still debouncing when the newly added sale made the
generic Void selector ambiguous. Waiting for the filtered response fixed the fixture without
changing ledger behavior. The first valuation rejection fixture also used the wrong URL;
corrected to the actual `/api/v1/valuations` endpoint, then retry/zero/skip passed.

Luna hit its usage limit during the grading slice (reported retry 12:44 PM); root completed
integration and verification locally. Independent review is not claimed. Backend grading
integrity is now being handled separately in `fix/grading-transaction-integrity`, worktree
`TCG-Tracking-codex-grading`, based on `origin/main`, not mixed into frontend source.
Allocation preview, full shell polish/global sale action, native IDs/Google/telemetry/assets,
actual device/signing/distribution/preview and final approved Hosting cutover remain open.
No push, deployment, production data change or website switch occurred.

### Compact shell checkpoint

Mobile navigation now uses a labeled horizontal scroll strip rather than a tall wrapping
button grid; desktop retains the sidebar. Global New product and New sale reuse the protected
forms, and signout closes their local state. Sheet uses native KeyboardAvoidingView while web
behavior remains unchanged. See [React Native documentation](https://reactnative.dev/docs/keyboardavoidingview).
Keyboard, safe-area and accessibility acceptance on actual devices remains required.

Typecheck and ESLint passed; all 29 browser tests passed (exit 0), including global form
opening/cancellation, mobile navigation reachability and no overflow. Android/iOS Hermes
exports passed again. Production continues using the unchanged Vite deployment. Backend
grading integrity is separately committed locally as `3615f8b`; final combined API regression
and independent review remain acceptance gates. No push or deployment occurred.

## 2026-09-12 Combined regression and native prerequisites

Combined rewrite/backend regression passed: **811 API tests, 100% source coverage**, ruff,
and all **29 Expo browser tests**. Current app checks remain 86 unit tests, TypeScript,
ESLint and successful Android/iOS Hermes exports. Exports are not installed-device tests.
The static-date pricing fixture repair is isolated in `chore/date-stable-pricing-test`
(`fc89689`, integrated as `c34f28f`); provider stale behavior is unchanged.

An existing independent reviewer resumed and found three concrete follow-ups: sale-edit
stock preflight must participate in the product lock, rip allocation must use consumed FIFO
cost under the transformation locks, and transformation void must refresh/recheck its status
under lock. Those fixes are in progress; this regression pass does not waive them. Runtime
profile metadata was unavailable, so Terra/high routing could not be independently verified.

Read-only Firebase CLI inspection (`firebase-tools` 15.30.0) confirmed the existing
`tcg-tracking` project has **one WEB app and no Android/iOS app registrations**. No app,
provider, OAuth client, project configuration or deployment was created/changed. Native
Google remains disabled, rather than borrowing Household credentials or claiming completion.

Before native integration/distribution, authorize/register the approved
`com.galcome.tcgtracking` Android package and iOS bundle, reconcile signing fingerprints,
retrieve matching service configuration into ignored files, and supply the matching public
Google OAuth client IDs. Actual Google/email login, kill/relaunch, token refresh, permissions,
keyboard and CSV share acceptance require installed builds and devices. `adb devices -l`
currently lists no connected devices. Firebase setup/auth skills informed this prerequisite
check; missing registrations pause native configuration only, not safe local feature work.

No push, merge, production data change, deployment or live Vite website cutover occurred.

### Dashboard monthly trend

Dashboard and Reports now share one server-backed monthly trend component and query cache.
It preserves all twelve calendar months in oldest-first server order, explicitly independent
of the selected period. Exact decimal formatting keeps large cents, zero revenue and negative
profit intact. It displays distinct spending/revenue/profit and bought/sold unit counts,
with loading, empty, error and retry states; no new chart dependency or client financial
calculation was introduced. React checklist informed the shared component/query structure.

TypeScript, ESLint and 86 unit tests passed. All 29 browser tests passed, including exact
large monthly spending, zero revenue, negative one-cent profit and 390/768/1536-width checks.
Android and iOS Hermes exports passed again. Independent targeted review found no concrete
P1/P2 issues and confirmed per-UID query-cache isolation, exact decimal formatting and
period-independent fetching. Runtime profile metadata remains unavailable; broader rewrite
and native acceptance are not implied by this bounded review.
The authoritative rip preview design is recorded in [its decision record](2026-09-12-rip-fifo-preview.md).
