# Independent product review: goal fit, tap budget and competitors

Date: 2026-09-19. Production intent: live app. Baseline: main `42d7354` (#102, Android 0.1.4).
Bar set by Joseph: the app must hit the product goal (know what the group owns, what it
cost and what it made) and **any common task must take at most 3 taps** from a tab. This
review contains no code changes. Only findings that change an outcome are listed.

## Verdict

The ledger is stronger than every consumer competitor. It has FIFO cost basis, split
funding, rip/crack/grade lineage, and partner balances. Collectr, ManaBox and TCGplayer
have none of this. The app misses the goal in three places:

1. **Profit is overstated.** Business overhead can't be recorded (G1).
2. **"What is it worth?" isn't answered on Home**, even though the app now has market values (G2).
3. **Selling at a show or to one buyer** takes one full sale form per product (G3).

Everything else is tap-count friction, not a gap in the model.

## Findings

| # | Finding | Evidence | Consequence |
| --- | --- | --- | --- |
| G1 (P1) | **No business expenses.** Sleeves, toploaders, shipping supplies, show tables, subscriptions and travel have nowhere to go. The only way to take cash out is an *adjustment*, which moves the balance but doesn't touch profit. | Movement kinds are funding, proceeds, transfer and adjustment only (`src/models/money.py:76-88`). Dashboard profit is sales net minus cost of sales (`src/services/reporting.py:225`). | Realized profit and ROI are **overstated** by all overhead. An adjustment hides the spend inside "cash" with no category, so nobody can answer "what did supplies cost us this year?" or back out a tax figure. DeckTradr Pro and reseller tools (Flippd, Seller Ledger) treat expenses as a first-class feature. |
| G2 (P1) | **Home shows no market value.** The dashboard tiles are Stock at cost, Sales, Cash and Invested, and the hero is realized profit. It has no portfolio value and no unrealized gain. | `app/app/(app)/index.tsx:92,117-120`. `src/services/reporting.py` has no market or unrealized term. Values exist per product after #97/#99 (`stock-card.tsx`). | Home can't answer the investor's question: "what is the whole thing worth vs. what we paid?" [Collectr](https://www.getcollectr.com/track) leads with exactly this: portfolio value over time plus cost-basis gain/loss. |
| G3 (P1) | **One product per sale.** The sale form starts with a single product picker. | `app/components/sale-form.tsx:193,377`. | A show sale of 6 singles to one buyer takes 6 forms and about 30 taps. Fees and shipping can't be shared across the items, so per-item profit is wrong or has to be split by hand. [DeckTradr](https://www.decktradr.com/pro) handles up to 200 cards per transaction. |
| G4 (P2) | **Restock and grading are buried.** "Add purchase" is behind the "Manage product" disclosure. Rip, crack and grading are behind a second disclosure. | `app/app/(app)/products/[productId].tsx:35-38,46`. | Restocking a product you already hold takes Stock → card → Manage product → Add purchase: 4 taps before any fields. Sending to grading also takes 4. Both are routine for this group. |
| G5 (P2) | **Quick actions don't cover the frequent jobs.** The Add sheet offers Add product, Scan singles and Record sale. | `app/app/(app)/_layout.tsx:75-77`. | There's no "Add expense" (G1) and no "Rip". A rip starts from a stock card, which means finding the box first. |
| G6 (P2) | **Every date is typed as `YYYY-MM-DD` text.** Dates default to today, but back-dating means typing. | `product-forms.tsx:358,459,640,800`; `sale-form.tsx:346`; `money-forms.tsx:134,208`. | Logging last weekend's show is slow and error-prone on a phone keyboard. Every competitor uses a date picker. |
| G7 (P2) | **Add product is form-first, not catalog-first.** You fill in game, type, language and name, *then* the catalog match is suggested on the product page. | `product-forms.tsx:246` (a match is proposed only after save). | The catalog already knows the name, set and type. Searching first ("151 ETB") would fill four fields and set up pricing in one step. Collectr and ManaBox both start from search or scan. |
| G8 (P3) | **The stock card carries four equal-weight buttons** (Sell, Move, Rip, Edit). | `app/components/stock-card.tsx:37-40`. | The list is dense on a phone, and Edit is rarely needed from the list. This is low impact. Fix it only when the card is touched for G2. |
| G9 (P3) | **No "add this" shortcut when a Stock search finds nothing.** | `app/app/(app)/inventory.tsx` search empty state. | "I searched, it isn't there, add it" costs an extra trip through the Add sheet and loses the typed text. |

## Tap-count matrix (from the relevant tab, before typing)

| Job | Today | ≤3? | After correction |
| --- | --- | --- | --- |
| Add a new product | Add → Add product (2) | Yes | Add → search → pick (3), with fields prefilled (G7) |
| Scan singles | Add → Scan singles (2) | Yes | Same |
| Record a sale of 1 item | Add → Record sale → pick product (3) | Yes | Same |
| Sell 6 items to one buyer | 6 × 3 plus 6 fee entries | **No** | Add → Record sale → pick 6 → save (1 form) (G3) |
| Restock a held product | Stock → card → Manage → Add purchase (4) | **No** | Stock → card → Add purchase (3) (G4) |
| Rip a box | Stock → find → Rip (3) | Yes | Add → Rip → pick box (3) (G5) |
| Send to grading | Stock → card → Rip, crack & grading → Send (4) | **No** | 3 (G4) |
| Move money between partners | More → Money → Move money (3) | Yes | Same |
| **Log sleeves / supplies** | **Not possible** (adjustment is 4 taps and loses the category) | **No** | Add → Expense → save (2, then fields) (G1) |
| See total worth vs. cost | Not available | **No** | Home, 0 taps (G2) |
| Record a valuation (Vault) | More → Vault → Record valuation (3) | Yes | Same |
| Export for taxes | More → Reports → Export (3) | Yes | Same (expenses included, G1) |

## Competitor benchmark

| Capability | Us | [Collectr](https://www.getcollectr.com/) | ManaBox | [DeckTradr Pro](https://www.decktradr.com/pro) | [Card Dealer Pro](https://www.carddealerpro.com/) |
| --- | --- | --- | --- | --- | --- |
| Live scan + market price | Yes (#102) | Yes (Pro, unlimited) | Yes | Yes | Yes, bulk |
| FIFO cost basis per lot | **Yes** | Basic cost basis | No | Inventory P/L | No |
| Rip/crack/grade lineage | **Yes** | No | No | No | No |
| Partner funding / balances | **Yes** | No | No | No | No |
| Portfolio value on home | **No (G2)** | Yes, headline | Collection value | Yes | No |
| Multi-item sale | **No (G3)** | n/a | n/a | Yes, up to 200 | Via marketplace |
| Business expenses | **No (G1)** | No | No | Yes | No |
| Marketplace listing sync | No | No | No | No | Yes |

Our position: we're the only one that combines investor-grade cost accounting with partner
money. The three gaps above are exactly where a vendor-side tool (DeckTradr) beats us.
Marketplace listing sync (Card Dealer Pro, [TCG Sync](https://tcgsync.com/)) is **not**
recommended. It's a different product for high-volume online sellers and breaks the lean bar.

## Correction sequence

1. **Business expenses (G1, G5 partial).** PRD: `docs/requirements/2026-09-19-business-expenses.md`.
   This is the only item that fixes a *wrong number*, so it goes first.
2. **Portfolio value on Home (G2).** Total market value of mapped stock, unrealized gain (toned),
   and a "priced x of y units" coverage line so partial coverage is never passed off as the total.
3. **Multi-item sale (G3).** One sale with N lines. Fees and shipping are allocated across the
   lines by price, in integer cents with a remainder rule, like purchase allocation.
4. **Tap trims (G4-G6, G9).** Promote Add purchase and Grading out of the disclosures, add Rip to
   the Add sheet, use a native date picker, and add "Add '<query>'" when a search is empty.
5. **Catalog-first add (G7).** Search TCGCSV first, with manual entry as the fallback.

G8 is folded into step 2. Each step is its own branch and PR.
