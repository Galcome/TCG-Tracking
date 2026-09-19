# Business expenses (overhead)

**Production intent:** Live app. Real ledger money: full validation, auth on every route,
integer cents, and voids instead of deletes.

Source: independent review `docs/reviews/2026-09-19-independent-product-review.md` (G1, G5).

## Problem

Sleeves, toploaders, shipping supplies, show tables, subscriptions and travel are real
costs, and today they can't be recorded. The only way to get cash out is an adjustment,
which has no category and doesn't reduce profit. So realized profit and ROI are
overstated by all overhead, and there's no yearly total for taxes.

## What it does

- **Add expense** from the Add sheet (and "New expense" on desktop) in 2 taps. Fields:
  amount, category, paid from (defaults to the joint account), date (defaults to today),
  and an optional note.
- **Categories** (fixed list): Supplies (sleeves, toploaders, binders, storage), Shipping
  supplies, Show & event fees, Subscriptions & software, Travel, Grading fees (not tied to a
  card), Other (note required).
- **Paid from** uses the same accounts and split editor as purchase funding:
  - Joint account: cash goes down.
  - A member's account: the business now owes that member (they paid out of pocket).
  - Store credit: the credit balance goes down.
- **Home** shows **Net profit = realized profit − expenses** for the selected period as
  the headline. Realized (trading) profit and the expenses total sit beside it, so both
  numbers stay visible. ROI stays on trading only, and is labelled that way.
- **Money** gets an Expenses filter on the movements list. **Reports** gets expenses by
  category and month, and includes them in the CSV export.
- An expense can be edited or voided like other money movements (void, never delete).

## Out of scope (deliberately)

- Receipt photos, recurring expenses and mileage. Add them only if the group asks after using it.
- Allocating overhead into per-product cost basis. FIFO lot cost stays purchase-only; expenses
  are period costs. That's the correct accounting and keeps rip/sale math unchanged.
- Shipping, tax and fees on a specific purchase or sale. These already live on that purchase
  or sale and must not be entered again as expenses. The form says so in its helper text.

## Acceptance

| Case | Expected |
| --- | --- |
| $25.00 sleeves from joint, today | Joint balance −2500 cents. Expenses +2500. Net profit is 2500 cents lower than realized. |
| Member pays $40 show table out of pocket | That member's "owed to" rises by 4000. Joint is unchanged. Net profit −4000. |
| Paid with $10 store credit | Credit balance −1000. Cash is unchanged. |
| Split $30 between joint and a member | Legs sum exactly to 3000 cents. Uneven splits are rejected. |
| Void an expense | Balances and net profit return to what they were before. It's listed as voided. |
| Period filter (month) | Only expenses dated in the period count toward net profit. |
| Amount ≤ 0, missing category, "Other" with no note, future date beyond today | 422 with a field message. |
| Unauthenticated / non-member | 401 / 403. |
| CSV export | Expense rows include date, category, amount, paid from and note. |

## Technical notes (agent decides; recorded for review)

- New movement kind `expense` via a **new** migration that widens `ck_money_movements_kind`, plus a
  nullable `expense_category` column constrained to the list above and required when kind = expense.
  Never edit existing migrations.
- An expense posts legs only against its paying accounts. The counterparty is the P&L, not an
  account, so balances stay consistent with how funding legs already post.
- `reporting.dashboard` adds `expenses_cents` and `net_profit_cents` for the period. The API
  and both clients (Expo and web) show them with the money-tone rule.
- 100% backend coverage. App unit tests cover the form and Playwright covers "add expense →
  Home net profit drops".
