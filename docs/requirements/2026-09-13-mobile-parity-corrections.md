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
Bundled Inter/Space Grotesk, full game iconography, restrained holo/lattice treatments,
responsive desktop density and representative-screen visual approval remain tracked.
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
