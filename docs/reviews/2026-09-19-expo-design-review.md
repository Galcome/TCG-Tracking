# Expo design review — pricing, scan and money presentation

Date: 2026-09-19. Production intent: live app (Expo is the launch client).
Baseline: main `3fa9225` (#95, Android 0.1.3). Inputs: Joseph's installed-app feedback
(money tone, box values, new-product updates, 30th Celebration, rip scanning, multi-card
scan with pricing) plus code inspection. No production data was written; no fixes are in
this report.

## Status of the 2026-09-13 review

| 09-13 finding | Status at `3fa9225` |
| --- | --- |
| Sealed set/type -> name autofill | Fixed: `app/components/product-forms.tsx:216-252` (`effectiveProductName`, manual-edit guard). |
| Set suggestions behind a second picker | Fixed: inline suggestions in `app/components/set-field.tsx:40-70`. New issue below (ranking). |
| Scrolling primary nav / Store not direct | Fixed by #91/#95 (Home, Stock, Add, Sales, More; bucket segments). |
| Optional fields dominate add-product | Largely fixed (disclosure for shipping/tax/notes). |
| Native login safe area | Fixed: `app/app/login.tsx:21` uses `SafeAreaView`. Device check still pending. |
| Design system reduced to palette | Partial: fonts, backdrop and game identity are restored. Tabular/semantic money is **not** restored (see below). |

## Confirmed findings

| # | Finding | Evidence | Consequence |
| --- | --- | --- | --- |
| F1 (P1) | Signed money has no gain/loss tone | Every money render uses `colors.text`. The tokens `gain`/`loss` already exist in `app/context/ThemeContext.tsx:3-5` but are unused for money. Web uses `toneFor()` (`web/src/format.ts:70-76`). Affected: dashboard game/sale profit (`app/app/(app)/index.tsx:149,158`), stock card (`stock-card.tsx:30`), product detail (`products/[productId].tsx:32`), sales (`sales.tsx:76`), money balances/movements (`money.tsx:66,88,108,179`), reports (`reports.tsx:190,205`, `report-rollups.tsx:77,123`, `monthly-trend.tsx:22`, `lineage-report.tsx:88`), vault appreciation (`vault.tsx:179`), sale preview (`sale-form.tsx:180`). | A loss reads like a gain at a glance. This is a regression from the website and the main reason the app "doesn't read" financially. |
| F2 (P1) | Most sealed products can never get a free market value | `ELIGIBLE_PRODUCT_TYPE_SLUGS = {single, raw-single, booster-box, sealed-case}` (`src/services/pricing.py:70-72`). Packs, `box-set` (ETBs/collection boxes), `collection` and `deck` are rejected at mapping time (`src/routes/pricing.py` `_validate_mapping`). Client mirrors: `app/lib/pricing-drafts.ts:11`, `web/src/pages/ProductDetail.tsx:71`. TCGCSV lists all of these as sealed products with market prices. | "I don't see values for boxes." ETBs and packs, which are most of the sealed stock, show nothing. |
| F3 (P1) | Eligible products still need a manual 3-step mapping | Mapping is category -> group -> product search, then confirm (`app/components/pricing-controls.tsx`). Nothing proposes a match from the product's own game/set/name. The daily job only refreshes confirmed mappings. | A new product has no value until someone runs the mapping flow. In practice values are missing even where they're supported ("what about updating new products?"). |
| F4 (P2) | Stock card shows a per-unit estimate only, and hides it when missing | `stock-card.tsx:31` shows `Estimate $x / unit · status` only when a value exists. There's no holding value (qty × unit), no unrealized P&L, and no "set up price" action. | A missing value is invisible instead of actionable. Even a present value can't be compared to cost at a glance. |
| F5 (P1) | New sets aren't discoverable; there is no set sync | Sets come only from hand-written migrations (`migrations/versions/0008_card_sets.py:46-84`). 30th Celebration *is* seeded (line 52, 2026-09-16). But `suggestions()` ranks used sets first (`src/services/sets.py:111-116`) and the field shows only 5 (`set-field.tsx:40`). A new, unused set sits below every set you've used. | "I don't see Pokémon's 30th." Every future release across Pokémon, Lorcana, One Piece and others needs a code migration to appear at all. |
| F6 (P1) | Camera scan is photo-only and identity-only | `expo-image-picker` (`app/lib/photo-picker.ts:8-9`) -> `POST /api/v1/vision/cards` (`src/routes/vision.py:63`) returns name/set/number/variant/language only. `appendPhotoCards` leaves value blank (`rip-form.tsx:535-547`). | Ripping needs a manual price per hit, which is the slowest part of a rip. |
| F7 (P1) | No multi-single add flow and no scanning outside Rip | `PhotoReader` is only mounted in `rip-form.tsx:615`. `AddProductForm` is one product at a time. | "Add multiple singles with the camera" isn't possible. Collectr's core loop is missing. |
| F8 (P2) | Vision has one provider and a global 3s throttle | Gemini only (`src/services/vision.py:45`, `MIN_SECONDS_BETWEEN_CALLS = 3.0` at :53, process-global). | A single Gemini outage or quota hit disables scanning, and 3s/frame is too slow for live scanning. |

## Journey acceptance matrix (this review's scope)

| Journey | Acceptance |
| --- | --- |
| Read any money figure | Positive realized/unrealized profit, ROI, appreciation and positive balances/inflows are green. Negative values are red. Zero and unknown stay neutral/muted. Costs and prices stay neutral. Same rule on every screen. |
| See value of a sealed box/ETB/pack | After a product is mapped, the stock card shows unit and holding value plus toned unrealized P&L. If it isn't mapped, a "Set up price" action opens a *prefilled* mapping. |
| Add a new product | Choosing a game + recent set surfaces that set first. After save, the app proposes the TCGCSV match to confirm in one tap. |
| New set released | It appears in suggestions within one daily job run, with no code change, for every game that has a TCGCSV category. |
| Rip singles with camera | Scanning each hit adds it to the hit list with name/set/number and its TCGCSV market price as the (editable) value used for allocation. |
| Add many singles | Live camera session: each recognized card is added to a list with its price, and one confirm creates or reuses the products and records the purchase. |
| Vision outage | Scanning keeps working when one AI provider fails. Pricing never comes from AI. |

## Collectr benchmark

[Collectr's scan flow](https://www.getcollectr.com/scan) keeps the camera open, recognizes
card after card, shows each result's market price immediately and batches the add. Lesson:
recognition and pricing belong in one loop, with review at the end, not per card. We keep
our rules: free TCGCSV prices only, AI for identity only, and human confirmation before
anything touches the ledger.

## Correction sequence (proposed)

1. **Money tone (F1).** One `moneyTone` helper and a `Money` text primitive, applied across the files listed in F1.
2. **Sealed pricing (F2-F4).** Widen eligibility, add a suggested match for mapping, show holding value/unrealized P&L, and add a "Set up price" CTA. Offer the mapping right after creating a new product.
3. **Set sync (F5).** Daily TCGCSV group sync into `card_sets` (with a group id). Pin recent releases above used sets.
4. **Live scan (F6-F8).** Price lookup from identity, a live camera scanner with a session list, wired into Rip and a new "Add singles" flow. Vision provider fallback chain; per-member rate limit replaces the global 3s throttle.

Each step is its own branch/PR with tests. Device acceptance on the Android internal build is
required for step 4 (native camera).
