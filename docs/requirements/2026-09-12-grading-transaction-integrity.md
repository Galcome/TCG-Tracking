# Grading transaction integrity

Production intent: live API; local implementation only, no deployment authorized here.
Requested during Expo rewrite review; isolated on `fix/grading-transaction-integrity`
from `origin/main` c1c21b3 so this API fix can be reviewed independently of UI changes.

## Invariants

Sending remains a flag, not a stock movement. Outstanding same-product/bucket submissions
share the current bucket's capacity. Cancellation releases that capacity. Returning requires
a still-out submission, sufficient original-bucket stock and a return date not before send.
Fees and FIFO cost remain integer cents and server-authoritative; no provider estimate enters
accounting. No schema, auth, environment, deployment or migration change is needed.

Acquire related product row locks in UUID order before checking stock or changing submissions.
Refresh locked submission status before return/cancel. Stock-transform writes and reversals
use the same product locks. Normal sale and move preflight checks participate in this lock
protocol, preventing a concurrent return from invalidating an earlier unlocked stock check.
Explicit oversell/history corrections retain their existing semantics; this is not a blanket
ban on deliberate corrections that expose negative-stock attention warnings.

## Validation

- Ruff passes. Existing grading/transformation checks: 60 passed initially.
- New cumulative capacity, cancellation, missing-bucket-stock and chronology checks pass.
- Four real PostgreSQL concurrency checks pass: duplicate sends, duplicate returns with
  spare stock, return versus sale, and return versus bucket move. Independent sessions
  commit UUID-owned fixtures; cleanup deletes only those fixture IDs, never resets a schema.
- Focused grading/concurrency/shared-writer/bucket tests: 53 passed before adding the final
  move race; all four concurrency tests then passed. Shared-writer rejection is tested before
  any transformation/child stock is created.
- Full API run before the sale/move preflight additions: 793 passed, one unrelated static-date
  pricing-fixture failure, 100% coverage. The quote is dated August 28 but asserts fresh;
  September correctly makes it stale. Correct that test on a separate chore branch, then
  run final combined regression/coverage before acceptance.

No push, API deployment or production data change occurred. Independent Terra review remains
unavailable at the conversation's agent-thread limit; these checks do not waive that release gate.
The live Vite website remains unchanged. Expo integration is a separate local cherry-pick
after this bounded fix's checkpoint, not a main merge or production rollout.
