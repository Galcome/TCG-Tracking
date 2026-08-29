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
- Compare source and target database identities returned by PostgreSQL after connecting;
  URL spelling and hostname normalization are not identity.

## Implementation tracking

- [x] Upload ingress cap and missing/chunked length tests.
- [x] Restore confirmation and connection-derived identity checks, docs, and tests.
- [x] Preserve vision identity fields through the rip form and inline product creation.
- [x] Expose collector number and variant in add/edit product flows.
- [ ] Confirm production terms and reliability for the free catalog feed.
- [ ] Add provider/catalog mappings and a CAD quote/snapshot schema.
- [ ] Add current estimate display on Inventory, Store, and Vault.
- [ ] Add a bounded daily refresh job with stale/error handling.

## Free pricing design (follow-on)

The provider adapter should resolve a confirmed product to an external catalog identifier
once, then fetch prices by that identifier. It should store provider, source product ID,
condition/variant, original currency, CAD conversion rate, fetched time, and match status.
The Bank of Canada Valet API is the preferred no-key source for daily USD/CAD conversion.
TCGCSV is a candidate free catalog/price feed, subject to terms verification before it
becomes a production dependency.

The daily job should:

1. Fetch only confirmed raw/sealed mappings.
2. Validate the feed before replacing current quotes.
3. Retain the last successful quote and mark it stale when a provider fails.
4. Append a history row only when the value changes materially or the monthly Vault
   checkpoint is due.
5. Queue ambiguous matches and large moves for human review.

No AI call is needed after an external product ID is confirmed. Search-grounded AI may
help an operator resolve an exception, but its listings are evidence for review, not an
automatic valuation.

## Out of scope

- Paid slab feeds or automatic slab valuation.
- AI-generated prices or sell recommendations.
- A scheduler/worker until the provider contract and quote schema are implemented.
- Any change to cost-basis or realized-profit calculations.

## Success looks like

- An oversized upload cannot consume multipart temporary storage regardless of how its
  length is declared.
- A restore cannot reach `DROP SCHEMA` without the explicit confirmation and a successful
  source/target identity check.
- A photographed hit's set, collector number, variant, and language remain editable and
  are present on the saved product.
- A future free quote refresh can update display-only estimates while accounting outputs
  remain byte-for-byte unchanged.
