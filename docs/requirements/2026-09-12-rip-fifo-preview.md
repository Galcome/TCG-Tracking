# Rip FIFO allocation and preview

Status: approved rewrite follow-on; allocation integrity fix in progress, preview not implemented.
Production remains the existing Vite website. No deployment or cutover is authorized here.

## Integrity prerequisite

The old rip route derives shares from average unit cost before transformation locks,
but the transformation consumes FIFO lots. Different lot prices or an intervening sale
can therefore make output cost disagree with consumed source cost. Compute shares only
after ordered product locks and the authoritative consuming adjustment have established
FIFO cost. Share a pure allocation policy between saving and previewing.

Preserve integer cents, explicit whole-row overrides, per-unit estimate times quantity
weights, equal-row fallback when every weight is zero, deterministic penny allocation,
and full write-off for a known-cost empty rip. Unknown source cost must stay unknown,
not become a free purchase or a known basis manufactured from an estimated card value.
The shared policy, not the preview alone, governs excessive explicit overrides.

## Minimal preview contract

Authenticated `POST /api/v1/transformations/rip/preview` accepts the source product,
quantity, current source bucket, operation date and ordered draft hit rows containing
unique bounded opaque keys, quantity, optional per-unit value and optional whole-row cost.
Unsaved hit names and product IDs are unnecessary. Money uses existing decimal-string
schemas, not floats.

Return source cost/null, unknown flag, current bucket quantity, each keyed hit's cost/null,
bulk cost/null, and `nonbinding: true`. Reuse opening/type/stock guards. Simulate a newest
same-day consumer in complete active product history using `ledger.load_events` and the
pure FIFO allocator, following sale preview. Apply the same rip allocation policy as save.
Do not create products, adjustments, transformations, valuations, allocations or audits.
Existing auth may provision a Member; accounting read-only does not promise zero auth writes.

FIFO is product-wide: stock moves do not alter costing events. The bucket guard is current
signed bucket stock, not historical stock at the selected date. Do not introduce a different
bucket/date costing policy in preview. No lock, reservation or revision token is promised.

## Client acceptance

Preview before create/reuse identity resolution is possible. Query identity includes every
financial input; changed drafts immediately hide previous allocations. Suggestions never
become explicit cost overrides automatically. Blank override means unset; zero is explicit.
Loading, validation, shortage, provider-independent server errors and retry are visible.
Label: "Estimated FIFO allocation. Not reserved; stock and costs are checked again when saved."
Saving still uses the authoritative backend and existing explicit identity decisions.

## Verification

Cover unequal FIFO lots, existing/voided/backdated consumers, same-day ordering, penny
conservation, quantity-weighted estimates, zero fallback, overrides, known zero, mixed/fully
unknown cost, empty rip, invalid keys/money/dates/quantities, forbidden/missing sources,
bucket shortage and auth. Pre-provision membership, then assert preview creates no accounting
or product rows. Prove preview/save agreement on unchanged history and changed allocation
after an intervening write. Exercise unsaved drafts, stale-response suppression and unchanged
stock before Save in browser tests. Native device acceptance remains a separate gate.

Architecture was delegated read-only to the existing architecture agent with bounded context;
implementation ownership remains isolated from the grading concurrency follow-up.
