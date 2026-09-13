# Installed mobile parity corrections

Production intent: live Vite website, isolated Expo internal beta. Joseph approved the
[audit correction plan](../reviews/2026-09-13-expo-parity-and-mobile-ux.md) after reporting
installed-app name-autofill, design and navigation regressions. Keep Vite live; no cutover
or broad Expo release is implied by implementation of this slice.

## First slice / ownership

- Luna: sealed name derivation with permanent manual-edit protection; identity-first entry;
  optional product/purchase details collapsed, grading fields appropriate to slabs;
  game-scoped inline set suggestions; focused behavior regression tests.
- Astra: fixed bottom navigation with direct Store access, visible labels and active bucket
  state; persistent Add/Sell; contextual stock actions through existing forms; login insets;
  keyboard-aware mobile sheets with anchored form footer and desktop compact presentation;
  control variants, surface hierarchy, branded card mark and tabular-number text.
- Astra: negative-stock dashboard links, gross sales by channel and recent-sale correction.
- Terra: independent correctness/accessibility/regression review before publication.

Preserve all existing API payloads/accounting invariants, funding/proceeds and retry guards.
The stock-place bucket switcher and separate Vault valuation route must both remain available.
Small screens/larger text may wrap navigation rather than hiding destinations horizontally.
Do not suppress font scaling or shrink touch targets to make the layout fit.

## Verification and remaining acceptance

Update browser assertions to check actual navigation bounds without auto-scrolling, set ->
name wiring and manual corrections, optional controls and contextual action forms. Run
app lint/typecheck/units, web and native fixture exports, existing browser scenarios in the
dedicated test environment, and independent review. Never test writes on production.

The previously known local PostgreSQL test-auth problem may block browser E2E; record the
actual limitation and use CI rather than changing a production DB or weakening assertions.
Passing browser fixtures is not installed-device acceptance. Native login/relaunch, camera,
share recipients, keyboard/full-height form, navigation, larger text and safe-area checks
remain real-device gates.

This slice begins design recovery, not completion of the entire website design port.
Representative-screen visual approval and installed-device acceptance remain tracked.
Every journey in the audit matrix still needs explicit comparative acceptance evidence.
Provider availability advisories remain separate fix work; no AI-estimated prices or slab
auto-pricing are introduced. Future APK packaging requires a higher version/code and new
source/byte receipt: the first alpha receipt must not be rewritten or reused after edits.

## Current validation checkpoint

Combined application lint/typecheck and 109 units pass, including two new product-entry
regression tests. Fixture-configured web, Android and iOS exports pass under Node 22;
these are not signed installation builds. Backend ruff and `git diff --check` pass.

Browser assertions now check bottom-bar position at 320/390/768 pixels, all seven
destinations at 1536 pixels, inline set selection, optional purchase details, dashboard
gross channel sales, sale-editor prefill and negative-stock links. New product-entry
scenarios check sealed naming/manual correction and raw/graded entry. These browser
scenarios have not run locally because the dedicated PostgreSQL fixture remains
unavailable; CI execution and real-device acceptance remain required.

Independent review caught and corrected navigation sibling order, gross-versus-net
channel wording and 48-pixel touch targets. Both delegated agents subsequently reached
the usage limit before final handoff. Root inspected the retained edits and completed
integration checks, but the final combined independent review remains outstanding.
Publication is a draft PR only until that review and CI acceptance are complete.
No new APK, Expo preview deployment or live Hosting switch has occurred in this slice.

## Visual recovery checkpoint

Restored locally bundled Inter (400/500/600/700) and Space Grotesk (700) via Expo runtime
font loading. Load errors unblock startup with system-text fallback; no CDN font fetch.
Only selected font assets are imported. Shared controls, headings, brand and navigation
use the restored typography without disabling font scaling. Inventory and product detail
reuse the website's six game-marker geometries via SDK-compatible react-native-svg;
unknown games retain a colored orb and visible text. Additional native dependencies
require a fresh signed rebuild, not an update to the existing first-alpha receipt.

Lint/typecheck, 109 units, Expo dependency compatibility and all three fixture exports
pass. Added browser font-failure acceptance; it remains pending CI execution. No signed
APK or representative-screen/device visual approval is implied.

First PR CI run executed 33 Expo browser scenarios: 30 passed; three failed on ambiguous
page/form selectors after navigation restoration. Scoped Product type to Add product
dialog and Store quantity to textbox in commit `ef7f6f7`; financial assertions and workflow
remain unchanged. Subsequent CI acceptance is recorded below.

## Final correction / acceptance checkpoint

At `bc806d3`, Expo CI passed all 34 browser scenarios (including font-load failure) and
native fixture exports. Backend, build, CodeQL, Vite browser and required aggregate checks
passed in the PR workflow. Final independent Terra review found no P1/P2
defects in committed entry/navigation/typography changes.

Completed static, low-contrast holo accents for login/profit cards and original sleeve
lattice on login. Decorations are pointer-inert, assistive-tech hidden and have no
animation. Stock cards now use wrapping horizontal groups on desktop, stacked mobile
presentation, semantic bucket badges and screen-reader product grouping. Mobile search
remains visible while extra filters collapse; active choices remain summarized and
preserved on reopening. No API/accounting changes. Independent review of this final
visual slice found no P1/P2 defects; focused 320/390/1536 stock-action guard/bounds and
collapsed-filter restore assertions were added afterward. Local lint/typecheck, 109 units,
all three fixture exports and diff checks pass; latest exact-commit CI is pending.

Code completion is not device/product acceptance. Remaining gates: latest exact-commit
CI; representative login/stock/product-entry visual approval; installed keyboard/insets/
larger-text/navigation/relaunch/camera/share checks; real provider availability; refreshed
signed Android alpha and source receipt from CI-green main. Never switch live Vite on
fixture-only evidence. A user/device acceptance gate cannot be marked passed by agents.
# Follow-up verification: response/commit ordering

The subsequent 907d1e6 checkpoint passed all 35 Expo browser scenarios and native exports (34771972585), plus backend/Vite/all-required CI (34771972553). Trace investigation confirmed the rip writer returned the correct $150.01 source/output cost; the immediate child read saw quantity zero and empty history before transaction commit. Separate PR #89 corrects response/commit ordering without changing financial algorithms or assertions.

Root inspected fixture-rendered inventory screenshots at 320, 390 and 1536 pixels, and Add product at 390 pixels. Sealed set selection fills the name; the save footer remains visible; stock colors and compact desktop layout are restored. This is browser visual evidence, not native device acceptance. Java/Android SDK doctor passed, and Firebase alpha currently has one tester and one release. Preparing 0.1.1 (Android versionCode 2); no new upload yet. Updated code requires a fresh signed build receipt after final exact-main CI.

Latest Expo CI (34771498202) passed 33 of 35 scenarios, including the new stock-card and filter checks. Pricing confirmation returned HTTP 201 followed immediately by an empty mapping read; rip verification read zero cost after a successful transformation. These failures are under investigation, not waived. A separate backend correction will address transaction completion before success responses if confirmed.

Local rendering also exposed Metro retaining a previous production configuration when exporting with changed fixture environment variables. Only denied membership GETs used the fake test token; no production writes occurred. Export scripts now clear Metro's cache. A fresh all-platform export succeeded, and the web bundle contains the fixture API/project identifiers instead of the production API URL. Earlier local exports demonstrate compilation, not verified fixture targeting. CI already explicitly cleared the cache.
