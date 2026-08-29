# Security and free market estimates

## Production intent

Live app. Real users, real inventory, and real money.

## What it does

This follow-on hardens the two destructive/request-boundary paths found in review and
keeps photo-assisted product entry from losing identity details. It also records the
approved shape for free market estimates so a later pricing feed cannot accidentally
change accounting.

## Product decisions

- AI is an identity assistant, not a pricing authority. Gemini/Groq responses may suggest
  name, set, collector number, variant, and language; a person reviews the fields and
  saves the product.
- A sourced estimate may appear as a market estimate, but it never changes purchase cost,
  FIFO cost basis, realized profit, or sale proceeds.
- Free-source scope is raw cards, sealed boxes, and exact case products. A case without an
  exact listing may show a clearly labelled `units × box estimate`, never a market quote.
- Slabs remain manual. No raw-card fallback should be shown for a graded item.
- Daily refresh means the current quote displayed on Inventory, Store, and Vault. History
  should append on material change and at least monthly for Vault, rather than storing
  identical rows every day.
- Unknown, stale, or ambiguous matches stay visible as unknown/stale and require review.

## Security scope

- Enforce the complete upload body cap in an ASGI receive wrapper, including requests with
  missing, chunked, malformed, or falsified `Content-Length`, before multipart parsing.
- Require `RESTORE_CONFIRM=DROP_TARGET_SCHEMA` for every restore because the script drops
  and recreates the target schema.
- Require the separate `RESTORE_ALLOW_SAME_DATABASE=i-know` acknowledgement when the
  connected source and target identities match; it never replaces the per-run confirmation.
- Compare source and target database identities returned by PostgreSQL after connecting;
  URL spelling and hostname normalization are not identity.

## Implementation tracking

- [x] Upload ingress cap and missing/chunked length tests.
- [x] Restore confirmation and connection-derived identity checks, docs, and tests.
- [x] Preserve vision identity fields through the rip form and inline product creation.
- [x] Expose collector number and variant in add/edit product flows.
- [x] Before external pricing mappings, search likely existing products by normalized game,
  name, set, collector number, variant, and language. The rip/photo form now requires an
  explicit reuse/create choice for each hit; reuse passes the existing product ID into the
  normal transformation output path, so quantity, cost allocation, and lineage remain
  ordinary ledger rows. No candidate is selected automatically.
- [x] Add bounded server-side TCGCSV catalog discovery for categories, groups, products, and
  printing/subtype names. Provider payloads are cached in the API process for 24 hours so
  browser searches do not repeatedly download the once-daily feed. Product Detail can fill
  exact provider identifiers from a search, while numeric manual entry remains available and
  confirmation is still human-controlled.
- [x] Confirm the public endpoint shape and reliability safeguards for the free catalog
  feed. TCGCSV is read by its daily marker and group price endpoint with a bounded request,
  a descriptive User-Agent, and no more than one fetch per group in a refresh. Bank of
  Canada Valet supplies the latest USD/CAD business-day rate without a key.
- [x] Add provider/catalog mappings and separate mutable current-quote and append-only
  provider snapshot tables. Mappings are human-confirmed, unique per local product/provider,
  and retain TCGCSV category, group, product, subtype/printing, condition, and language.
  TCGCSV market prices are not condition-specific; that limitation stays visible in the
  mapping model rather than being presented as a raw-card condition valuation.
- [x] Add authenticated mapping create/update/list and manual refresh operations. Existing
  member authentication is the access boundary; no new admin role is invented, and there
  is no automatic external-product matching.
- [x] Ship a practical Product Detail mapping editor for the TCGCSV category/group/product
  IDs and subtype/printing, with explicit confirm/disable actions and a manual refresh button.
  Refreshes are bounded to 100 confirmed mappings and 25 groups, serialized with a
  PostgreSQL transaction advisory lock, and return retry/limit guidance when busy or oversized.
- [x] Add display-only current estimate data to product and Vault response shapes while
  leaving the manual Vault valuation, cost basis, and profit calculations untouched.
- [x] Render the new estimate fields as explicitly per-unit, sourced, dated display-only
  values in Inventory/Store, product detail, and Vault. Stale/unavailable state remains
  distinct from manual Vault value, cost, and realized profit.
- [x] Add a bounded daily Railway Cron job. The private worker uses a secret Neon database
  connection and explicit `APP_ROLE=worker` guard, calls the pricing service directly, keeps
  API migrations separate, retries lock/database/marker/FX failures three times, logs
  structured completion/error summaries, and relies on the existing PostgreSQL advisory
  lock plus Railway's skip-while-active behavior for overlap protection.
- [x] Keep exact-case fallback honest: no `units_per_case` field exists in the product model
  or persisted provider metadata, so the app does not invent a units × box estimate. Add the
  field only with a trusted source and explicit product-level confirmation.

Live contract check on 2026-08-29: TCGCSV's marker and Pokémon group-price endpoints
returned the documented product/subtype/market-price shape, and Bank of Canada Valet
returned a dated USD/CAD observation. This verifies the adapter contract once; provider
monitoring and stale-state handling remain necessary because availability can change.

## Free pricing design (follow-on)

The provider adapter should resolve a confirmed product to an external catalog identifier
once, then fetch prices by that identifier. It should store provider, source product ID,
condition/variant, original currency, CAD conversion rate, fetched time, and match status.
The Bank of Canada Valet API is the preferred no-key source for daily USD/CAD conversion.
TCGCSV is the first free adapter. Its public documentation expressly permits backend
scraping and defines once-daily, User-Agent, request-delay, and request-count safeguards;
the adapter follows those published usage rules. A production refresh should still be
monitored because the service describes itself as a one-person hobby project.

The daily job should:

1. Fetch only confirmed raw/sealed mappings.
2. Validate the feed before replacing current quotes.
3. Retain the last successful quote and mark it stale when a provider fails.
4. Append a history row only when the value changes materially or the monthly Vault
   checkpoint is due.
5. Queue ambiguous matches and large moves for human review.

No AI call is needed after an external product ID is confirmed. Gemini remains an
identity-only assistant and may not update prices. There is currently no Groq integration in
this repository; if one is added later, the same identity-only boundary applies.
Search-grounded AI may help an operator resolve an exception, but its listings are evidence
for review, not an automatic valuation.

### First implementation slice

The first slice intentionally supports only `single`/`raw-single`, `booster-box`, and
`sealed-case` product types. Any grading company, grade, or certificate identity—and the
`graded-card` type itself—is rejected by mapping operations and never receives an automatic
raw-card fallback. TCGCSV mappings require numeric category, group, and product IDs plus an
explicit subtype/printing such as `Normal` or `Holofoil`.

An operator enters those exact TCGCSV identifiers on Product Detail, confirms the mapping,
and can disable it later if the identity changes. The same panel can manually refresh all
confirmed mappings and reports fresh/stale/unavailable counts. A refresh accepts only strictly
positive, bounded provider prices and preserves the last successful number when a source fails;
it never creates an accounting valuation.

`current_market_quotes` is the mutable last-known per-unit quote used for display. It is
separate from the existing `price_snapshots` table, which remains the append-only manual
Vault valuation ledger. `market_price_snapshots` records successful provider revisions and
CAD conversions for future trend/monthly-checkpoint work. A failed fetch retains the last
number as `stale`, or reports `unavailable` when there has never been a successful number.

The API surface is `/api/v1/pricing/mappings` (human-confirmed mapping operations), the
authenticated `POST /api/v1/pricing/refresh` manual seam, and the bounded authenticated
catalog discovery endpoints under `/api/v1/pricing/catalog`. The private daily worker
calls the service directly. No automatic provider matching, slab feed, or
condition-specific TCGCSV claim is included.

## Out of scope

- Paid slab feeds or automatic slab valuation.
- AI-generated prices or sell recommendations.
- Any change to cost-basis or realized-profit calculations.

## Success looks like

- An oversized upload cannot consume multipart temporary storage regardless of how its
  length is declared.
- A restore cannot reach `DROP SCHEMA` without the explicit confirmation and a successful
  source/target identity check; matching identities additionally require the dedicated
  same-database acknowledgement.
- A photographed hit's set, collector number, variant, and language remain editable and
  are present on the saved product.
- A free quote refresh updates display-only estimates while accounting outputs remain
  byte-for-byte unchanged.
