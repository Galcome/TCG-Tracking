# Expo parity and mobile UX review

Date: 2026-09-13. Production intent: live website; Expo remains an internal beta/preview.
Baseline: main `1850890`, Android alpha `0.1.0 (1)`. User supplied three phone screenshots
and reported missing Pokemon product-name autofill, then confirmed these were from the
installed app. Existing Vite website remains the functional and visual reference.

## Acceptance correction

Full product parity is **not established**. Passing 31 Expo browser tests and helper/unit
tests proves only their assertions, not equivalent discovery, defaults, corrections,
mobile ergonomics, design, or every product type. No live Expo website cutover should
occur on that evidence. This review is code inspection plus user screenshots and public
competitor documentation, not a completed hands-on test of every journey or competitor.
No production test data was written. No application/deployment fixes are made in this report.

The product remains a three-person investment/stock ledger: Inventory for working stock,
Store for sale, Vault for deliberate holding; case -> box -> card -> slab transformations;
original dates and FIFO costs carried; cash and amounts owed tracked separately. Estimates
must never become cost basis or realized profit. Free source pricing is for supported raw
cards/sealed products, with slabs manual and AI used for identity, never invented prices.
Fast entry and recognizable, polished presentation are requirements, not optional garnish.

## Confirmed behavior and UX regressions

| Finding | Evidence | Consequence |
| --- | --- | --- |
| Sealed-product set/type -> name autofill missing | `web/src/components/forms.tsx:63,98-99` derives an editable name with a manual-edit guard; `app/components/product-forms.tsx:209,310-311` keeps only raw name state. `app/lib/product-types.ts` contains the copied helper but AddProductForm does not use it. | A selected set still leaves the product name blank; repeated typing and inconsistent identity. Restore derivation without overwriting a manual correction. Raw cards must not receive invented card names. |
| Primary mobile navigation is horizontally scrolling buttons | `app/app/(app)/_layout.tsx:18-30` versus fixed icon-labelled navigation in `web/src/components/AppShell.tsx:335-350`. | Later destinations disappear off-screen; navigation consumes the top of the page and is harder to reach with a thumb. |
| Store is not a direct shell destination | Expo shell's six-item navigation omits Store; web NAV contains Inventory/Store/Vault destinations at `web/src/components/AppShell.tsx:61-63`. | The user must discover bucket controls inside stock. Vault's separate report is not a substitute for clear stock-place navigation. |
| Inventory quick actions removed from cards | `app/app/(app)/inventory.tsx:47-55` exposes product-detail navigation, but no contextual Sell/Move/Edit actions. | Frequent actions require a detail-page detour. They exist elsewhere but the journey is worse. |
| Optional fields dominate add-product | Web uses `Advanced` at `web/src/components/forms.tsx:271`; Expo renders slab/source/shipping/tax/fees/notes directly at `app/components/product-forms.tsx:341-359`. | The short purchase path becomes a large scrolling form. Slab fields also appear for sealed goods. |
| Set suggestions moved behind an extra picker | `app/components/set-field.tsx:25-39` requires Find a set and a second sheet. | Extra steps/nested dialogs instead of the website's immediate suggestions. Manual and new-set entry must remain possible. |
| Native login safe-area treatment inconsistent with shell | `app/app/login.tsx:21` uses plain View/Page; protected shell uses SafeAreaView. Screenshot 1 shows title/status-bar overlap in the installed app. | Fix native insets and test on-device; a provider alone does not apply layout padding. |
| Design system largely reduced to palette | `app/context/ThemeContext.tsx` and `app/components/ui.tsx` provide a small palette and generic controls. `web/src/index.css:1-107` defines bundled Inter/Space Grotesk, surface hierarchy, game identity, foil/lattice and tabular-number styling; web Login uses Wordmark/holo panel. | Brand, hierarchy, density, number alignment and visual polish were not ported. The requested framework change did not require losing them. |

The compact-shell test (`app/e2e/foundation.spec.ts:4-25`) clicks Vault and checks body
width. It does not assert that primary navigation is visible without horizontal scrolling.
Draft validation tests do not exercise AddProductForm's set/name wiring. These are concrete
acceptance gaps, not evidence that every financial operation is broken.

## Journey audit scope and acceptance matrix

Independent Terra audit completed read-only, comparing forms/API contracts and browser-test
source. It found the missing sealed-name behavior and dashboard shortcuts below, but no
additional P1/P2 write-contract mismatch in the inspected money, sale, transformation,
grading, valuation/pricing or CSV paths. No tests were rerun for this audit. Recorded test
results and inspected test source are evidence of covered scenarios, not native acceptance.

| Inspected journey | Current assessment and evidence |
| --- | --- |
| Add sealed product | Confirmed P2 autofill gap; name state/submission differs from web. No corresponding regression test. |
| Purchases, moves, corrections, archive/history | Implemented; browser source checks edit/void and exact totals. `app/components/product-forms.tsx:426-793`; `app/e2e/foundation.spec.ts:979-1055`. Native pending. |
| Sales and funding/proceeds | API-equivalent preview, store credit, split and edit/void contracts. `app/components/sale-form.tsx:142-361`; browser scenarios `foundation.spec.ts:25-66,936-977`. Native pending. |
| Money transfers/adjustments/reversals | Implemented, safe decimal-to-cents input. `app/lib/money-drafts.ts:48-132`, `app/components/money-forms.tsx:139-242`; browser scenarios `foundation.spec.ts:895-934`. Native pending. |
| Crack/rip/bulk/FIFO/vision | Implemented server previews, retry-safe children, no-hit loss and manual fallback. `app/components/crack-form.tsx:138-350`, `rip-form.tsx:352-632`; browser scenarios `foundation.spec.ts:673-810`. Native camera/upload pending. |
| Grading/return/reversal/valuation | Implemented read-before-write guards, zero and valuation retry semantics. `app/components/grading-forms.tsx:143-293,349-654`; browser scenarios `foundation.spec.ts:68-105,628-672,763-810`. Native pending. |
| Vault and free-price mapping/refresh | Implemented explicit mapping separate from ledger; manual valuation, mapping disable/re-enable scenarios. `app/components/pricing-controls.tsx:250-433`, `valuation-form.tsx:28-120`; browser scenarios `foundation.spec.ts:140-215,542-627`. Actual provider/device acceptance not established by fixtures. |
| CSV/report exports | Implemented full-page collection, formula neutralization and exact sale money columns. `app/lib/csv.ts:8-122`, `csv-button.tsx:7-35`; browser scenarios `foundation.spec.ts:322-385`. Native recipient/share pending. |
| Dashboard discovery/corrections | Lost direct negative-stock product links, marketplace panel and in-place recent-sale correction. `app/app/(app)/index.tsx:36-38` versus `web/src/pages/Dashboard.tsx:36-40,95-149,448-473`. The Reports/Sales routes remain, but these shortcuts are a journey regression. |

Until a row has matched fixture evidence and relevant device acceptance, call it
implemented/inspected, not full parity. The complete acceptance scope follows.

| Journey family | Required comparison / acceptance |
| --- | --- |
| Add products: raw/single, graded, pack, box, case, other supported types; all games | Same type defaults, set/name assistance, manual name protection, identity/language/condition/storage and initial purchase. Grade/cert fields appropriate to product. New/used sets remain reachable. |
| Purchases and funding | Quantity, paid amount, date, optional fees/source; own-account default, joint/store credit, exact split; edit/void updates stock, cash and history together. |
| Product edit/archive/history | Identity edit, archive/unarchive, retained history and correct empty/filter states; retries do not duplicate writes. |
| Inventory/Store/Vault discovery | Direct places, URL/Back/reload state, filters/paging, bucket-leading counts and stock states agree with web. Quick actions do not require needless detours. |
| Moves and adjustments | All bucket pairs, partial quantities, invalid/insufficient stock, reasons, unknown versus zero added cost; cost/date conserved and history retained. |
| Crack case/box | Game/language/set size suggestions, produced type/name, reuse/create product, multi-bucket outputs, preview/date/FIFO/cents conservation; undo and sold-descendant restrictions. |
| Rip hits and bulk | No-hit loss, proportional allocation, manual overrides, unknown cost, bulk, multi-lot preview/date lineage, saved valuations and reversal guards. |
| Photo -> hit identities | Multiple batches append; set/number/variant/language editable; candidate reuse/duplicates; errors/denied camera/manual fallback; no AI price fabrication. |
| Grading | Send/overdue state, return name/type/grade/cert/bucket/fees, raw/graded valuation retry separate from committed transformation, cancel/reversal guards and correct cost lineage. |
| Sales | Product/bucket selection, FIFO preview, fees, funding/proceeds destination, cash versus shop credit/splits, oversell prevention, edit/void/rescale and retries. |
| Money | Joint cash, per-person amounts owed, named shop credit, transfers/paybacks/opening adjustments, movement corrections/history/paging; separate non-netted totals. |
| Vault valuations | Manual dated per-unit value, zero/unknown, appreciation and annualisation, parked capital and ageing exemption; correction/history. |
| Free market pricing | Eligibility, confirmed exact provider product/printing mapping, match/search/review, manual refresh, current CAD quote/date/source/FX, stale/failure/no quote and daily-worker behavior. No slab auto-pricing or ledger mutation. |
| Dashboard and reports | Persisted shared All/YTD/MTD/30/60/90 windows; totals, tier spread, lineage tree, set holdings/ageing and data issues agree on identical fixtures; no blended double counting. |
| CSV and sharing | Complete filtered/paged export; money precision, unknown/zero; web download and native share; permission/fetch failures recover. |
| Auth/navigation/device | Email/Google, allowed/denied membership, account switch/cache isolation, token refresh/relaunch/signout; deep links/Back, keyboard and safe areas. |

## Public competitor workflow benchmark

This is a public-documentation benchmark, not a claim of installed-app testing or copying
their pricing feeds. Paid competitor features are not a change to the free-only data policy.

- [Collectr scan flow](https://www.getcollectr.com/scan): its documented sequence identifies
  a card's set/number/variant before quantity/condition and portfolio entry. Lesson: identity
  selection should populate the form and reduce typing; people confirm uncertain variants.
- [ManaBox collection organization](https://manabox.app/guides/collection/getting-started/):
  owned cards live in binders while lists represent things not necessarily owned. Lesson:
  clear places and intent matter; distinguish Inventory/Store/Vault without ambiguous totals.
- [Dragon Shield Card Manager](https://mtg.dragonshield.com/download-app): publicly presents
  Inventory, Sets, Decks, Wishlist and Trade alongside scanner/collection management. Lesson:
  task-oriented destinations and collection entry should be discoverable, not clipped controls.

The recommendation is our design inference: borrow low-friction identity-first entry and
clear organization, not deck/social features or market estimates as accounting. The existing
TCG mobile website is the strongest direct navigation/design reference for this rewrite.

## Correction sequence (proposed; implementation not started)

1. Hold live cutover. Replace broad parity claims with a per-journey evidence checklist.
2. Restore behavioral defaults first: sealed names/manual-edit protection, short purchase
   path with optional/conditional fields, set assistance and contextual stock actions.
3. Restore a responsive design system: Inter/display typography, wordmark/game icons,
   restrained holo/surface depth, semantic bucket colours, tabular money, compact typography
   and genuine primary/secondary/link controls instead of making everything a filled button.
4. Restore fixed icon-labelled mobile navigation, direct Store/Vault access and thumb-reachable
   Add/Sell. Account/signout are secondary. Preserve desktop sidebar and appropriately dense
   tables/cards. Do not trade clipping for undersized touch targets or suppress font scaling.
5. Rework mobile forms for safe areas/keyboard: a predictable full-height form or sheet,
   anchored title and save action, scrollable content, clear groups and searchable selections
   without confusing nested overlays. Keep desktop dialogs compact.
6. Test each journey with the same dedicated fixtures in both clients. Assert user-visible
   defaults and exact resulting stock/cost/cash/valuation/history, including failure/correction
   paths. Add visual/interaction acceptance at phone/tablet/desktop widths, long names and
   larger text. Browser fixture tests are not native-device acceptance.
7. Show representative login, stock and add-product screens for design acceptance before
   broad restyling. Ship a newly versioned local Android beta/receipt and updated isolated
   Expo preview after fixes. Only consider live cutover when behavior and UX gates pass.

No second framework/backend rewrite is needed to fix these regressions. The failure was
porting a platform/functionality skeleton without preserving enough interaction and design
contracts, then using too-narrow checks as acceptance evidence. The correction is explicit
behavioral parity, restored design and device-level acceptance—not another deployment guess.
