# Replacing the Excel sheet

**Production intent: live app.** Real money, three real users.

Requirements dictated by Joseph as user journeys, one at a time. The full set is below; this
top section is the running state so a fresh session can pick up without re-deriving anything.

---

## Where this is

| Step | State |
| --- | --- |
| 1. Buckets on stock, and a move action | **Shipped** - PRs #17, #18 |
| 1b. Store and Vault in the navigation | **Shipped** - branch `fix/store-vault-nav` |
| 2. The money ledger | **Shipped** - branch `feature/money-ledger` |
| 3. Store credit | **Shipped** - branch `feature/store-credit` |
| 4. Sets, suggestions, seeded calendars | **Shipped** - branch `feature/sets` |
| 5. Transformations: cases and cracking | **Shipped** - branch `feature/transformations` |
| 6. The rip screen | **Shipped** - branch `feature/rip-screen` |
| 7. Grading | **Shipped** - branch `feature/grading` |
| 8. Reporting: tier, lineage, set rollup | **Shipped** - branch `feature/rollups` |
| 9. Vault valuation and ageing exemption | Next |
| 10. Photo to cards | |

Live at https://tcg-tracking.web.app, API at https://api-production-6ea5.up.railway.app.
613 backend tests, 73 e2e, 100% coverage.

### Step 1b - what shipped

Joseph, looking at the left nav: *"I DON'T SEE STORE!"* The bucket tabs were built **inside**
the Inventory page; he means **navigation items**, siblings of Inventory. That is what "tab"
means in this app's vocabulary.

- **The sidebar carries the places.** `All stock`, with `Inventory`, `Store` and `Vault`
  nested under it. Six items on the mobile tab bar - `All stock` is the one that gives way
  there, since the page it leads to carries the same choice as a tab strip.
- **The URL is the state.** `/inventory` is all of it, `/inventory?bucket=store` is a place.
  Shareable, survives reload, Back works. `Inventory` reads `useSearchParams`; the tab strip
  writes the same param, so the nav and the tabs cannot disagree.
- `NavLink`'s `isActive` compares pathnames and ignores the query string, so all four stock
  destinations would light up at once. Active state is computed by hand from `useLocation`.
- **The heading names the place** - "Store", not "Inventory" - with a line under the tabs
  saying what that place means, and an empty-state message per bucket. "No products yet" on
  an empty Store, for a group holding 271 units, reads as a bug.
- **The count leads with the bucket in view.** Standing in the Store and reading `4` for a
  product with 3 boxes there and 1 in Inventory is the filter contradicting itself.
- **An unknown `?bucket=` falls back to everything** rather than passing it to an API that
  answers 422.

Found while checking the journey at real widths, and fixed here: the desktop table needs
~1060px of columns, so between 1024 and 1280 the row actions sat off the right edge behind a
horizontal scrollbar - invisible in exactly the way Joseph complained about the first time.
Cards now take over below `xl`, two abreast, and `Unit cost` is dropped below `2xl` so the
table fits a 1280 laptop exactly.

Verified at 375, 1040, 1280 and 1536 in a real browser, not only by a green suite.

### Step 2 - what shipped

**One sign convention, and one flip.** A posting stores signed cash flow *through* an
account: money in is positive, money out is negative. The joint account is an asset, so its
balance is the plain sum. A member account is a liability, so its balance is that sum
**negated** - what the business owes that person. Every event the group described falls out
of that single rule, including the one that breaks a naive from/to model: paying a partner
back lowers the joint balance *and* what they are owed, both at once.

- **Accounts appear by themselves.** Joint, plus one per member, provisioned on first use.
  Nobody sets up bookkeeping before they can record a purchase.
- **Funding defaults to whoever bought it**, and proceeds to whoever sold it - the same rule
  and the same reason: it is what physically happened, and the eBay payout really does land
  in one person's account. One tap changes either, and both stay editable afterwards.
  **This is the one product assumption worth checking** - the workbook's "Paid From" column
  is per person, never "joint", which is what it was read from.
- **A funding split has to add up** to what the purchase actually cost, or it is refused.
  Correcting the price rescales the split in its original proportions: 150/50 of a $200
  purchase becomes 225/75 at $300, largest-remainder so it lands exactly.
- **Proceeds track net, not gross.** What landed after the platform and payment took their
  cut is the money somebody can actually spend. A sale swallowed whole by fees moves none.
- **Cash held and money owed are two figures, never one.** A netted number hides whichever
  of the two is the problem. The Dashboard's "Since day one" now points at Money and says
  outright that it answers a different question.
- **Opening balances are adjustments** in the account's own terms - "Jason was already owed
  $5,000" is +5000 on Jason. That is the workbook's rollover column, and it is why nothing
  is backfilled: who paid for the existing purchases is not derivable from anything stored.
- **Funding and proceeds cannot be voided on their own.** They describe a purchase or a
  sale, so the correction is to that transaction and the money follows.

Verified at 375, 1280 and 1536 in a real browser. The mobile tab bar now carries seven
items; `Dashboard` shortens to `Home` there, and the overflow check is an e2e assertion.

### Step 3 - what shipped

**Store credit is a third account kind, and a third figure.** It sums like the joint
account, because it is value the group holds and can spend. It is never added into a cash
figure, because it can only be spent at the shop that issued it. Sell a $200 box for $500 of
credit: **$300 of realized profit and zero dollars**, both true at once.

- **The shop's name is enough.** Typing it creates that shop's pot on first use, matched
  case-insensitively so "Card Shop" and "card shop" cannot become two half-balances. Shops
  behave like marketplaces, offered as chips afterwards, with no list to maintain.
- **The name doubles as the channel**, per the original decision - selling for credit means
  selling *to* that shop, so it is typed once and fills both.
- **Spending it needs no new mechanism.** A store account is a funding source like any
  other, so buying with credit is the existing "Paid from" picker. Spent-out shops drop out
  of both pickers and out of the "across N stores" count.
- **The Dashboard's "Money in" is cash only** now, with credit named on the line beneath it.
  `cash_balance` excludes it too. `net_proceeds` still means everything a sale brought in.
- **Proceeds became legs, mirroring funding exactly** - so half cash and half credit is one
  sale, and a later fee correction rescales both in proportion.

Two things the real-browser pass caught that a green suite did not: account cards were
ordered store-credit first, so a dozen shops buried the joint balance; and the "which shop?"
field was shown when the typed name did *not* match an existing shop, so it vanished on the
last keystroke of a name that did. Both fixed, the second with a regression test.

### Step 4 - what shipped

**A set is a record now**, unique per game and case-insensitively by name. Still created by
typing a new one - nobody is blocked at 11pm because a set is missing - but typing "fabled"
lands on the existing "Fabled" instead of making a second row that splits every rollup.

- **Typing something close is questioned, never corrected.** "Did you mean Winterspell?"
  appears under the field; tapping it fills it in, ignoring it does nothing.
- **The calendar is seeded with release dates and reveals itself.** A set appears on its own
  release day with nobody maintaining anything. `The Hobbit` lands 14 August, two days out -
  a live test of the auto-reveal for free.
- **Used sets lead, the calendar fills in behind.** That ordering is the whole reason the
  calendar is safe to seed: when it goes stale nothing breaks, suggestions just fall back to
  what the group actually buys. Calendar-only sets are marked `new`.
- **Anything uncertain was left out** - Magic's TMNT crossover (two conflicting dates),
  Lorcana's unnamed Q4 set, Yu-Gi-Oh's "Beyond the Brave", anything dated only to a month.
  A missing set costs one typing session; a wrong one corrupts every set rollup.
- **Four games added** so their sets had somewhere to go: Riftbound, Star Wars Unlimited,
  Gundam, Dragon Ball. Sports stays for Panini and slabs, which have no calendar and fall
  back to plain typing.
- **A pre-order makes an unreleased set visible.** Once something uses a set it is real,
  whatever its date says.

`products.set_id` is the identity everything will group by; `products.set_name` stays as a
denormalised copy, because `search_text` is a stored generated column and a generated column
cannot join. It is written only by the resolver, from the set's own name.

Two things this pass turned up. The set field was behind **Advanced** - a field nobody
expands is a field nobody fills in, and the whole premise of this step is fast entry, so it
is now a primary field. And the Game and Product type selects had no `aria-label`, so their
accessible names included every option's text - "Box Set" made the type select match a
search for "Set". Same bug class as the bucket selects earlier.

**The e2e database now resets before each run.** It was never dropped, so the suite's own
fixtures accumulated across every run and page loads slowly crept past the assertion
timeout - the suite started failing a different test each time. A flaky suite is worse than
no suite. Runtime went from 4.9 to 3.3 minutes. The underlying cause on the app side -
`list_products` computing stats for every matching product before paging - is a separate
task.

### Step 5 - what shipped

**One primitive, built once.** Case into boxes, box into cards, raw card into a graded card
are the same operation, so `transformations` is one table with a `kind`. Steps 6 and 7 are
that same table with a different cost split.

The mechanics are ordinary ledger rows on purpose: consuming the source is a negative
adjustment, producing each output is a purchase. Nothing invents a second way to hold stock,
so FIFO, ageing and every per-product figure keep working without knowing transformations
exist.

- **The boxes inherit the case's purchase date**, taken from the lot the source came out of.
  Cracking a case on its first birthday produces six year-old boxes, and the ageing report
  proves it - that is the invariant UC2's flip-versus-hold comparison rests on.
- **Cost is conserved, not doubled.** `purchases.is_derived` marks cost carried across
  rather than money spent, and the money-out figures skip those rows. A $900 case becomes
  $900 of boxes and the group has still spent $900, not $1,800.
- **A cracked case is not a write-off.** New `transformed` adjustment reason and a
  `cost_transformed` figure beside `cost_written_off`. The money moved; it did not evaporate.
- **Largest-remainder split**, so $100 over six boxes sums back to exactly $100.
- **Unknown stays unknown.** A case whose cost nobody knows produces boxes whose cost nobody
  knows. Spreading a zero would claim they were free.
- **Parentage is recorded**, which is the only reason step 8's lineage rollup can exist.
- **Undo puts the case back** and takes the boxes away, leaving the row as the explanation.

On screen: **Crack open** on the product page. Case size is suggested from game *and
language* - 20 boxes for a Japanese Pokémon case against six for English - always shown,
always editable, never silently applied. Yu-Gi-Oh is deliberately absent from the table
because nobody confirmed it. The boxes can be split across buckets as they come out, and the
box product is created inline if it does not exist yet - being unable to record what you
just opened because somebody has not set up a product first is exactly the friction that
stops the app being used.

### Step 6 - what shipped

Same primitive as step 5, one level down, with the one difference that matters: **a box is
a lottery, not a division.**

- **Cost follows what the hits are worth.** $500, $50 and $10 out of a $150 box come to
  $133.93, $13.39 and $2.68. An even split would price a $10 card the same as a $500 one and
  make per-card ROI meaningless. Every row can be overridden.
- **Bulk is written off where it happens.** Whatever the hits do not take is a write-off at
  rip time, not an asset. A rip with no hits at all is allowed and is the honest record of a
  bad one: the box is gone and all of it is a loss.
- **`price_snapshots` exists now**, because this use case needs it independently of the
  parked price feed. The value typed at rip time is kept dated.
- **Estimates never become cost or profit.** Valuing a hit at $50 out of a $150 box reads as
  down $100 that day - a true statement of that day. Cost basis stays $150, and selling for
  $1,500 on day 400 reads as +$1,350. The journey, not just the latest number.
- **Zero cost is not unknown cost.** A later bulk sale counts at full margin and reports no
  ROI, which `GroupRow.roi` already returns when cost is zero.

Bulk is separated from real write-offs in the accounting too: `bulk_cost_cents` on the
transformation is shifted out of `cost_transformed` and into `cost_written_off`, so the
dashboard says loss where it was a loss and moved where it moved.

The dialog shows the split live as values are typed, and the write-off growing beside it -
a bad rip should look bad while you are recording it. One bug the browser pass caught that
the suite did not: the live preview divided dollars by 100 and showed $1.47 where the split
was $147.06.

### Step 7 - what shipped

The primitive a third time, with the two decisions Joseph made about it.

**The card keeps its bucket and carries a flag** rather than moving to an "Out" state - it
is still the group's stock and still their money. The condition attached to that was the day
count, and it is on the card: anything away shows how long, turning red past 90 days. That
is the protection a separate state would have given, which was stopping a card quietly
sitting at PSA for months.

**The return is the transformation, not the send.** The grade is unknown when it leaves, so
there is nothing to produce until it comes back. Tapping the flag is how the return gets
recorded, and the graded card's name is pre-filled from the raw one plus grader and grade -
"Mickey Mouse Iconic" becomes "Mickey Mouse Iconic - PSA 10". Shown, editable, never silent.

**Fees join the cost basis.** Grading, postage and insurance ride on the produced purchase's
fee column, so the graded card costs raw plus fees and its ROI is not overstated. A PSA 7
that comes back worth less than raw uses the identical mechanic; the loss is simply visible,
which is the point of measuring grading at all.

One refinement to the money-out rule from step 5: a derived purchase's *gross* is carried
cost, but anything in its shipping, tax or fees is new money. Grading fees arrive exactly
that way, so they show as spending while the carried card cost still does not.

### Step 8 - what shipped

The payoff. Three reports, deliberately kept apart because they overlap.

**Tier** - what each kind of thing has returned, with the **spread** beside the middle:
worst, median, best, and how many products the average is drawn from. That is the
survivorship guard. "We got lucky on that Fabled case" is the case anybody remembers, and a
view that only ever surfaced winners would always conclude that ripping pays. The page says
outright to read a row against its own history, because a $900 case is harder to move than a
$150 box and *should* sit longer.

**Lineage** - one product, all-in, across everything it became, with the tree beneath it.
Measured against the root's cost, because that is the only money ever really spent; the
descendants carry it rather than adding to it. Bulk lost on the way is part of the story.

**Set** - three figures, never one: sold with its realized return, in the Store with how long
the oldest has been sitting, in the Vault with no ageing figure at all. The Vault is parked
deliberately rather than asleep, so ageing it would describe nothing.

**Lineage and tier are never summed**, on screen or in the data. A case's lineage return
*is* the aggregate of its descendants, so a combined total would count the same money twice.
Both views say so where they are shown.

---

## What the app already does

Built and live before this document: purchases and sales with landed cost and fees, FIFO cost
basis with persisted lot allocations, realized profit, ROI, days held, stock adjustments,
edit and void with recompute and an audit trail, a sales ledger filterable by channel and
seller with CSV export, reports by game/product/type/channel/seller, stock ageing, a
money-in/money-out/balance block, trigram product search, and buckets with moves.

---

## How this work goes wrong, and what fixes it

Written down because the same failure has recurred and cost Joseph time:

1. **A green build is not verification.** Every bug that reached him passed lint, typecheck,
   tests and CI. Drive the real app and look at it - desktop *and* 375px - before saying
   something works.
2. **Test the journey he described, not the one that was built.** The bucket e2e moved 1 of
   2, which shows a split; moving *all* of something showed nothing, and that was his exact
   case.
3. **Backend done is not done.** Buckets shipped with no way to choose one when selling,
   which silently drove a bucket negative.
4. **Hiding information "when it is obvious" is how a working feature looks broken.** The row
   stayed silent when stock sat in one bucket, so a move rendered identically before and
   after.

---

Dictated by Joseph, one at a time, as user journeys. Nothing here is built yet.

**Reference:** `D:\Downloads\JP only cards Stock.xlsx` — 2023–2026 year ledgers, "Sell 0825",
"Sell Pricing", "Vault".

**Parked, not cancelled:** the Collectr export (Joseph is doing it himself) and daily price
tracking. Neither is in scope for this round.

---

## What the Excel does that the app does not

Read from the workbook, for reference while the use cases come in:

1. **Who funded each purchase.** Columns R and S split every purchase between Patrick and
   Jason, and they sum to the price (Spiderman box: 695.96 + 2196.61 = 2892.57). Plus a
   **Paid From** field — "P Cash", "J Cash", "P+J Cash", "J Cash + Credit".
2. **A shared cash account.** 2026 columns V–Z: dated deposits and withdrawals per partner.
   Plus **Store Credit** and a **Bet Box** as separate pots.
3. **Rollover balances** year to year, and a **Status** column. Together: who owes whom.
4. **Asking price**, distinct from cost and from what it sold for. Sell Pricing runs
   Cost → Price → **Ebay List = Price × 1.25** → Sold → Profit → %.
5. **A staging list** of items lined up to sell, before they sell.
6. **Vault** — year-over-year valuations with % increase per item.

The app models members as *operators* — who did the transaction — not who paid for it or
what they are owed. That is the largest structural gap and will drive the data model.

Note: the workbook has no column for Joseph. Worth asking whose money is in the split.

---

## UC1 — Cases

### Journey

1. **+ Add**, on mobile or web, fast. Type the fields, mark it a **Case**.
2. Case size pre-fills from game + language + product line, and stays **editable**.
3. It lands in a bucket. Default **Inventory**.
4. **"Crack open case"** is a button. A quick decision menu splits the contents across
   buckets — Joseph's example: 6 boxes → 4 Store, 1 Inventory, 1 Vault. The backend does
   the unit and cost maths.

### Buckets are intent, not place

**Inventory** = bought and held. **Store** = moved to sell. **Vault** = deliberate long-term
hold. All three can be in the same basement, so whose house it is in stays a separate field.
Confirmed with Joseph.

Today `storage_location` is one free-text field on the *product*, so two cases of the same
set cannot sit in different buckets. Bucket has to attach to **stock**, not to the product.

### Case sizes — researched, and they do not key off game alone

| Game | Boxes per case |
| --- | --- |
| Pokémon (English) | 6 (36 packs each) |
| Pokémon (Japanese) | **20** (30 packs each) |
| Lorcana | 4 (24 packs each) |
| Magic | 6 |
| One Piece (English) | 6 |
| One Piece (Japanese) | 12 |

Yu-Gi-Oh unconfirmed — left blank rather than guessed.

Size varies by **language** and by **product line** (One Piece Premium Booster cases are
quoted at both 10 and 12 boxes). A table keyed on game alone breaks the first time someone
buys Japanese. So: a default that is **shown and editable at entry**, never silently
applied.

### Cracking a case

- Consumes 1 case, produces N units of a component product, allocated across buckets in one
  step. The allocation must sum to N.
- Cost splits with the existing `split_cost` ([src/services/costing.py](src/services/costing.py)),
  which uses a largest-remainder split so the parts sum back to the whole exactly.
- **The boxes inherit the case's purchase date, not the crack date.** Otherwise cracking
  resets the ageing clock and the "money asleep" report quietly forgets you have held it a
  year.
- A case can also be sold whole. Cracking is a decision, never automatic.

### Gaps this opens

- Bucket as a property of stock, and a **move** action — nothing today relocates stock,
  adjustments only add or remove it.
- Case contents: a case must know what it becomes and how many.
- The component product may not exist yet; cracking has to create or pick it.

---

## UC2 — Was the strategy right?

The question behind cases: *"if we buy a case of Pokémon, does it make sense to flip 80%
quickly and hold the rest?"*

Joseph's example — **Lorcana Fabled**, researched and confirmed in shape. The chase is Mickey
Mouse – Brave Little Prince (Iconic foil): ~$560 raw NM, ~$2,000 market, a PSA 10 listed at
$25,000. The set is "almost impossible to find in stores", so scarcity pushed box prices up.
The specific $150 → $1,500 CAD box figures are unverified; the nearest confirmed comparable
is Lorcana First Chapter at $144 MSRP → ~$330, +129%.

### The report

For one original purchase, compare what happened to its units by disposition:

- **Flipped** — realized ROI and days held, per unit
- **Held** — still on the shelf, and for how long

This is why cracked units must inherit the case's purchase date. Without it there is no
common baseline to compare against.

### It is not blocked on prices, and should not wait for them

Valuing what is *still held* needs market prices, which are parked. But the comparison works
on **realized sales alone**: same case, same cost, same purchase date, different sale dates.
*"The 4 you flipped in March made 40%. The 1 you sold in November made 380%."* That answers
the strategy question with zero price data, and simply improves when prices arrive.

---

## UC3 — Shared budget, and who is owed what

All three partners share one budget. The WealthSimple account is **joint across all three**.
Joseph funds too, despite having no column in the sheet.

### The model: a cash ledger with accounts

Accounts: **Joint**, and one **personal** account per partner. A partner's balance is what
the business owes them (positive) or what they are holding of the business's money
(negative).

| Event | Effect |
| --- | --- |
| Purchase paid from Joint | Joint −X. **Nobody is owed** — confirmed with Joseph |
| Purchase paid from Jason personally | Jason **+$5,000** — the full amount, not his third |
| Sale, proceeds kept by the seller | Seller −X, since they now hold business money |
| Sale, proceeds to Joint | Joint +X, no partner balance changes |
| Partner pays themselves back from Joint | Joint −X, their balance −X. **Partial allowed** |
| Partner moves personal cash to Joint | Joint +X, their balance +X |

Every movement has a source and a destination. That is what makes it reconcile, and it is
already what columns V–Z of the 2026 sheet do — dated deposits and withdrawals per partner
against the joint account.

### Fluidity is the requirement, not a nice-to-have

Joseph: *"they can choose to pay themselves back or put it in the joint account. They can
even take capital for an upcoming purchase… then maybe move it to WealthSimple if they don't
end up buying anything."*

So the decision made at sale time must be **reversible later**, by a plain transfer between
accounts. No state machine, no approvals.

### Decision taken: proceeds default to the seller

A sale will **not** force a "where did the money go" choice at entry — that would wreck the
~10 second sale target. It defaults to the seller holding it, which is also what physically
happens: the eBay payout lands in Patrick's account, not a shared one. Moving it to Joint is
a separate, deliberate act.

### How this relates to what is already built

The **Since day one** block (money out / money in / balance) is derived from purchases and
sales — what was spent on stock and what came back. That is a *different question* from how
much cash is actually in the joint account. Both are useful; they must not be presented as
the same number.

---

## UC4 — Selling for store credit

Recording a sale asks **cash or store credit**. If credit: the amount and the **store name**.
After that, the app knows how much credit is sitting at that store.

Several stores are in play. A sale should be splittable across more than one, but **one store
is the normal case** and the form optimises for it — the same shape as the case-size default:
simple path first, the complex one available.

### Store credit is a pot, with the same rules as the others

Each store gets an account alongside Joint and the three personal ones. Selling for credit
adds to it; buying with credit spends it. The Excel already does this — "Store Credit" as a
column and "J Cash + Credit" as a Paid From value.

### It is not cash, and must never be added into cash

Sell a $200 box for $500 of store credit and you have made **$300 of realized profit and
zero dollars**. Both are true and they are different numbers.

So: store credit counts toward realized profit — stock was disposed of for value — and is
**excluded from the joint balance and from "money in"**, reported on its own line as
*"$2,400 in credit across 2 stores"*. Folding restricted credit into a cash figure is the
same class of lie as valuing unpriced stock at zero, or reporting market value as what you
would bank.

### Decisions taken

- **Store name doubles as the channel.** Selling for credit means selling *to* that shop, so
  the name is typed once and serves as both the sale's channel and the credit account.
- **Store names behave like marketplaces** — free text with suggestions built from stores
  already used, reusing the `MarketplaceField` pattern from
  [web/src/components/forms.tsx](web/src/components/forms.tsx). No managed list to maintain.
- **One spendable pot per store, and it records who earned it.** Credit at a shop is the
  group's — whoever is at the counter spends it — but each credit sale keeps the partner who
  brought it in, so the detail exists if a split ever matters. Confirmed with Joseph.

---

## UC5 — Ripping boxes, cards, and grading

### Journey

The box left in Inventory has a broken seal. A damaged-seal box barely sells — buyers assume
it has been searched — so it gets ripped. Sometimes packs get ripped simply because that was
always the plan. What matters afterwards is **the hits**: the few cards worth recording.

A card is then a first-class item — added to Inventory, Store or Vault, with the same
parameters and the same reporting as a case or a box.

### Three levels, one primitive

Case → boxes, box → cards, raw card → graded card. All the same operation: **consume stock
of one product, produce stock of another, carry the cost across.** Built once, it also covers
the "PSA reholder" line already in the 2026 sheet.

The existing `opened` adjustment reason and `cost_written_off`
([src/services/reporting.py](src/services/reporting.py)) are the precedent to build on.

### One level is not like the others

**Case → boxes is deterministic.** Six identical boxes, cost splits six ways via the existing
`split_cost`.

**Box → cards is a lottery.** 36 packs, ~360 cards, three that matter. Nobody will record 360
products, and "the Iconic cost one three-hundred-and-sixtieth of the box" means nothing.

### Cost assignment at crack time — Joseph's decision

A quick screen at the point of ripping: here is the box's $150, put it on the hits being
recorded. One hit takes it all; three hits split it however you say. **Anything left over is
written off as bulk.**

This is the only version where the box cannot vanish. Assign $0 to the Iconic and selling it
for $560 reads as **+$560**, with a $150 box evaporated. Assign the box's cost and it reads
**+$410** — you gambled $150 and won, which is what happened.

### Grading — stays in its bucket, flagged. Joseph's decision

A card sent for grading keeps its bucket and carries an **at-grading flag**. I had argued for
a separate "Out" state on the grounds that the card is not physically in the house; Joseph
chose the flag, so:

- **The flag carries the date it was sent**, and anything out shows a day count in Inventory.
  That recovers most of the protection against cards quietly sitting at PSA for months, which
  was the only real argument for a separate state.
- **Grading fees, shipping and insurance raise the cost basis**, exactly as shipping and tax
  do on a purchase. Without it every graded card's ROI is overstated by roughly the fee.
- **The return is the transformation, not the send.** The grade is unknown when it leaves.
  On return, the raw card becomes a graded product carrying cost plus fees.
- The product model already has `grading_company`, `grade` and `cert_number`
  ([src/models/product.py](src/models/product.py)) — the destination exists, the transition
  does not.

### Grading is measurable, like flip-versus-hold

Same shape as UC2: *"14 cards graded, $420 in fees, and they sold for $X more than comparable
raw."* Sometimes the answer will be that it was not worth it, which is the point of tracking
it.

---

## UC6 — Coming back from grading, and reporting by tier

### The return

The at-grading flag is **interactive**. Tapping it completes the return: record the grade,
and the raw card becomes a graded one.

- **The name is pre-filled and editable** — "Mickey Mouse Iconic" → "Mickey Mouse Iconic —
  PSA 10", built from the original name plus grader and grade. Same rule as case size: a
  sensible default, always shown, never silently applied.
- **The raw card is consumed, the graded card produced.** One in, one out.
- **Cost carries across**, plus the grading fees. A PSA 7 that comes back worth less than
  raw uses the identical mechanic — the loss is simply visible, which is the point.

### The cost chain is what makes any of it mean anything

Case → boxes → ripped box → hit → graded card. Cost and **original purchase date** travel
the whole way. So the graded Mickey's ROI is measured against its share of what the *case*
cost, over the days since the *case* was bought.

That is the "we got lucky on that Fabled case" story, told in numbers rather than memory.

**This requires transformations to record parentage** — every produced item knows what it
came from. Without that lineage the chain is unreconstructable and the report cannot exist.

### Two different reports, and they must not be added together

**By tier** — what Joseph described: cases return X% over N days, boxes Y% over M days, hits
Z%. Compares strategies across everything ever bought.

**By lineage** — the Fabled story: this one case, all-in, returned X% across everything it
became: 4 boxes flipped, 1 still in the Vault, 1 ripped into a graded hit.

**They overlap by definition.** A case's lineage return *is* the aggregate of its
descendants, so showing both in one total would double count. They get presented as separate
views, never summed.

### One caution worth building in

"We got lucky on that Fabled case" is survivorship. The case people remember is the one that
hit. If the report only ever surfaces winners, the conclusion will always be that ripping
pays — so tier reporting shows the **average and the spread**, not just the best outcome.
The losing rips are the ones that make the average honest.

---

## UC7 — The rip screen, and the value journey

### The screen

**Rip** is available from any bucket — Inventory, Store or Vault. After ripping, a prompt:
*what were the hits?* A **multi-entry field** — add a card, add another — with a value for
each at the time of entry. The group decides what is worth tracking; the rest is bulk.

### Cost splits proportionally to the values entered — Joseph's decision

Three hits at $500, $50 and $10 out of a $150 box split the cost **$134 / $13 / $3**.
Pre-filled, and every row editable. Each card's ROI then stands on its own, and the big hit
carries the risk it earned. An even split would price a $10 card the same as a $500 one and
make per-card ROI meaningless.

### Bulk is written off at rip time — Joseph's decision

The unlogged remainder becomes a write-off immediately, so a bad rip looks bad straight
away. Two consequences, both acceptable and worth stating:

- Selling bulk later shows revenue against **zero cost**. The money still reconciles — the
  write-off already reports separately from trading losses via `cost_written_off` — it is
  only *categorised* differently.
- Such a sale has **no ROI**, not an infinite one. `GroupRow.roi` already returns `None`
  when cost is zero or less ([src/services/reporting.py](src/services/reporting.py)), so
  bulk sales will not distort tier averages. That existing guard is doing real work here.

### The value journey — the subtle one

Joseph: rip a $150 case, pull a card you value at $50, look $100 down — then it becomes a
$1,500 card. How does the ROI reflect that?

It already does, provided **two numbers stay separate**:

| | |
| --- | --- |
| **Cost basis** | $150. Fixed at purchase, carried through the chain, never changes |
| **Typed value** | $50. An estimate on the day, not a cost |

| Moment | Reads as |
| --- | --- |
| Rip day | Cost $150, estimate $50 → unrealized **−$100** |
| Day 400, sold | **+$1,350** realized, against the same $150 |

"Down $100" is not a bug — it is a true statement of that day. What the app owes Joseph is
**the journey, not just the latest number**: cost fixed, estimate at day 0, sale at day 400.
Spent negative → major win, or estimate $50 → sold $40 → still negative. Both legible.

### Two consequences

- **The typed value is a dated price snapshot.** So the snapshot table is required by *this*
  use case, independently of the parked price feed. The feed stays parked; the cheap half of
  it is needed here regardless.
- **Estimates never touch cost basis or realized profit.** They inform decisions, they do not
  score them — the same rule that keeps unknown costs showing as "Unknown" rather than zero.
  Otherwise the group is marking its own homework.

---

## UC8 — Bulk

Bulk is never a reason to rip. Joseph: *"we're never gonna make a decision that ripping
something is worth it to sell it in bulk. It never happens."* So it is not an asset and does
not belong in inventory — which confirms the UC7 decision to write it off at rip time.

What actually happens: someone bundles the leftovers into packs and sells them on Facebook.
So bulk appears **once, as a sale, at the moment it sells** — "bundle, sold for ten bucks" —
attributed to the set. No stock to carry, nothing to maintain in between.

### Zero cost is not unknown cost

The critical distinction. The app excludes **unknown-cost** sales from realized profit, and
rightly so — there is no margin without a cost. Bulk has a **known** cost of zero.

Filed as unknown, a $40 Facebook bundle would disappear from profit entirely. Filed as
known-zero it counts at full margin and simply reports **no ROI**, which
`GroupRow.roi` already returns when cost is zero or less
([src/services/reporting.py](src/services/reporting.py)).

### Decision taken: attributed to the rip

A bulk sale attaches to the **rip event** it came from, not loosely to the set. That gives
lineage for free — the Fabled case rollup includes its bulk — and set-level aggregation
falls out naturally when several cases of a set are rolled together.

It will never move a case's ROI much and everyone knows it. It still belongs in the rollup as
a small positive, because leaving it out would understate what the case actually returned.

---

## UC9 — The Vault, and not punishing it

### Vault already does not hurt ROI

Worth stating because the worry was misplaced: ROI is computed on what **sold**. A Vault item
has not sold, so it is not in that number and is not dragging it down.

The distortion lives in exactly two places:

- **Ageing.** A Store box at 400 days is a problem; a Vault box at 400 days is on plan. Same
  number, opposite meaning — averaging them describes neither.
- **Capital.** Vault money genuinely is tied up. That must stay visible, because "$8,000 is
  in the Vault" is a real constraint on what can be spent. It just must not read as a
  *warning*.

### The design

- **Ageing warnings cover Store only.** Vault is excluded from "money asleep" outright. It is
  not asleep, it is parked deliberately.
- **Vault has its own scoreboard.** Store is measured on velocity — days to sell,
  sell-through, $/day. Vault is measured on **appreciation** — value against cost,
  annualised. The Vault tab of the workbook already works exactly this way: 2025 → 2026 →
  2027 values with % increase, and no days-held column anywhere.
- **Comparisons stay within a tier.** Joseph is right that case-versus-box is false: a $900
  case is harder to move than a $150 box and *should* sit longer. Lorcana case versus Pokémon
  case is the fair comparison, so tier is a grouping axis and the velocity report defaults to
  comparing inside one.
- **Set rollup shows the parts, never a blend.** "Pitch Black" reads as: *X sold — realized
  ROI, average days · Y in Store — still trying, ageing · Z in Vault — held on purpose,
  appreciation.* One honest header, the split beneath. A single blended set ROI mixing
  realized flips with unrealized holds is the same double-count trap as the lineage report.

### Valuation — annual floor, free daily refresh where it is easy

Joseph's answer: annual, but take a free daily check on Vault items if it is cheap.

It is cheap, and much cheaper than the parked project, because **only Vault items need
linking** — a few dozen deliberate holds rather than the whole catalogue, and mostly sealed,
where TCGCSV fits well (free, daily, no key, and sealed has no per-condition problem).

- **Annual manual valuation is the floor.** Always works, no dependency, matches the current
  workbook.
- **A free daily refresh layers on top** for whatever can be matched.
- **Slabs stay manual**, as agreed — no free source prices them.
- Anything unmatched keeps its last manual value **with its date**, visibly stale rather than
  silently wrong.
- **TCGCSV's terms get verified before it is wired in.** Standing commitment from earlier.

### Vault must not become where slow stock hides — Joseph's decision

Exempting Vault from ageing warnings creates an obvious loophole: something sits unsold for
200 days, gets quietly moved to Vault, and drops off the report.

The move keeps its history, and the Vault view shows *"moved to Vault after 180 days in
Store."* Nothing is blocked and nothing is nagged about — it is simply visible whether Vault
is a strategy or an excuse.

---

## UC10 — Fast entry, and smart suggestions

The premise, in Joseph's words: *"if people are not using this thing or they can't upload
something quickly, then they aren't gonna use it."* Every other use case depends on entry
being fast enough that it actually happens.

### Sets become real records — Joseph's decision

`set_name` is free text on the product today. It becomes a **set** record per game, created
by typing a new name — no admin screen, nobody blocked at 11pm because a set is missing.
Picking a suggestion reuses the existing one.

**This is data integrity, not just convenience.** Free text plus suggestions breeds near
twins — "Fable", "Fabled", "Lorcana Fable" — and the set rollup from UC9 then splits across
three rows and undercounts all of them. Typing something close to an existing set asks *"did
you mean Fabled?"* rather than silently creating a duplicate.

The trigram index already on `search_text` ([src/models/product.py](src/models/product.py))
is the same machinery that makes product search forgiving, so the matching is already there.

### Two sources, one ranked list

1. **The seeded release schedule** — Joseph is supplying the Pokémon calendar. A brand-new
   set is one tap *before anyone has ever bought it*.
2. **What has actually been bought** — every set already used, ranked by recency.

Merged, scoped to the chosen game, with used-recently first. Cap at roughly the last **8**;
everything older stays reachable by typing. Nothing is hidden, it is just not in the way.

### The schedule degrades gracefully — deliberately

A seeded calendar goes stale. Unmaintained, in six months it confidently names the wrong
"latest set", which is worse than having none.

So the **used-sets list is primary** and the schedule is a bonus layered on top. When it ages
out nothing breaks — suggestions simply fall back to what the group actually buys. No
maintenance chore is being created.

---

## UC11 — Seeding the release calendars

Researched rather than supplied. **A set is seeded with its release date, and only shows
once that date has passed** — so new sets reveal themselves on release day with no
maintenance at all. Joseph: *"they hardly ever change the release date once they set it."*

### Released — visible on day one

| Game | Set | Released |
| --- | --- | --- |
| Pokémon | Mega Evolution: Ascended Heroes | 30 Jan 2026 |
| Pokémon | Mega Evolution: Perfect Order | 20 Mar 2026 |
| Pokémon | Mega Evolution: Rising Chaos | 22 May 2026 |
| Pokémon | **Mega Evolution: Pitch Black Night** | 17 Jul 2026 |
| Magic | Lorwyn Eclipsed | 23 Jan 2026 |
| Magic | Marvel Super Heroes | 26 Jun 2026 |
| Lorcana | Winterspell | 20 Feb 2026 |
| Lorcana | Wilds Unknown | 15 May 2026 |
| Lorcana | Attack of the Vine! (Set 13) | 24 Jul 2026 |
| One Piece | OP15-EB04 Adventure on KAMI's Island | 3 Apr 2026 |
| One Piece | OP-16 The Time of Battle | 12 Jun 2026 (US) |
| Riftbound | Unleashed | 8 May 2026 |
| Riftbound | Vendetta | 31 Jul 2026 |
| Yu-Gi-Oh | Burst Protocol | 26 Jan 2026 |
| Yu-Gi-Oh | Maze of Muertos | 20 Feb 2026 |
| Yu-Gi-Oh | Blazing Dominion | 8 May 2026 |
| Yu-Gi-Oh | Chaos Origins | 3 Jul 2026 |

Pitch Black Night is Joseph's own example — real, and released four weeks ago.

### Seeded but hidden until their date

Magic: **The Hobbit** (14 Aug), Reality Fracture (2 Oct), Mystery Booster Commander (9 Nov),
Star Trek (13 Nov) · Pokémon: **30th Celebration** (16 Sep), Delta Reign (6 Nov) · One Piece:
OP-17 The World's Strongest Warriors (28 Aug), Live Action Edition vol. 2 (Nov) · Riftbound:
Radiance (23 Oct) · Gundam: Freedom Ascension GD05 (24 Jul), four ST decks (25 Sep).

**The Hobbit lands 14 August — two days out.** That is a live test of the auto-reveal, for
free.

Also captured for the wider top ten: Star Wars Unlimited (A Lawless Time, 13 Mar), Digimon
(AD-01 Generation, Mar), Dragon Ball (Masters Ultra Bout 3, 27 Mar).

### What I am not confident about

- **Magic TMNT** — sources give both 10 Feb and 6 Mar. Seeded with a flag, verified before it
  ships.
- **Lorcana Q4** — a Coco-themed set is confirmed, unnamed, no date. Left out entirely rather
  than invented.
- **Yu-Gi-Oh "Beyond the Brave"** — referenced but no date captured.
- Everything here is from secondary sources. It gets checked against official calendars
  before seeding, and **anything uncertain is simply omitted** — a missing set costs one
  typing session, a wrong one silently corrupts the set rollup.

### Not everything they buy is a TCG

The workbook carries **FIFA World Cup / Panini stickers** and graded slabs. No release
calendar applies. Those stay free-text entry with the used-sets suggestions — the seeding
covers TCGs and everything else falls back gracefully.

---

# The build

Ten use cases, sequenced so each one makes the next worth having. Money first, because that
is what the group is currently doing in Excel and cannot stop doing until this exists.

| # | What | Why here |
| --- | --- | --- |
| 1 | **Buckets on stock, and a move action** | Nearly everything below needs stock to carry Inventory / Store / Vault, and moves to keep their history |
| 2 | **The money ledger** — accounts, funding source on purchase, proceeds destination on sale, transfers, partial paybacks | Replaces the core of the spreadsheet. Highest value, and independent of the rest |
| 3 | **Store credit** | Completes the money model; a pot with the same rules |
| 4 | **Sets as records, suggestions, seeded calendars** | Makes entry fast, and keeps the set rollup from splitting into twins |
| 5 | **Transformations: cases and cracking** | The primitive. Case sizes, cost split, lineage, dates carried |
| 6 | **The rip screen** — hits, proportional cost, bulk write-off, dated value snapshots | Same primitive one level down, plus the first price snapshots |
| 7 | **Grading** — flag with sent date, fees into basis, return transformation | Same primitive again |
| 8 | **Reporting** — tier comparison within tier, lineage rollup, set rollup showing parts | Needs 5–7 to have anything to report on |
| 9 | **Vault valuation** — annual manual, optional free daily refresh | Last, and the only step with an external dependency |

| 10 | **Photo → cards after a rip** | An accelerator on the step 6 screen, so it comes after that screen exists |

Migrations needed at 1 (bucket on stock), 2 (accounts and movements), 4 (sets), 5
(transformations with parentage), 6 (price snapshots). Step 10 needs none.

## Step 10 — vision on the rip screen

Joseph has free Gemini tokens. The useful application is **eyes, not judgement**: point the
phone at the hits spread on the table after ripping and get names and sets filled in. It is
the most tedious step in the system, and the one thing Collectr does that this app otherwise
will not.

**Not built, and refused if asked:** AI-estimated card values or sell recommendations. That
is confident guessing dressed as advice, on real money, in an app whose whole discipline is
never inventing financial data. Unknown stays Unknown.

### One photo, many cards

It reads **all the cards in a shot at once** and produces a list — which is exactly the
multi-entry hits field UC7 already calls for. The photo fills that field instead of the
person typing it; nothing new is introduced.

- **Batches append.** Shoot four cards, shoot four more, the list grows. Accuracy falls off
  on twenty overlapping cards, so several relaxed photos beat one crowded one, and the flow
  should encourage that rather than fight it.
- **The risky field is variant, not the character.** Any model reads "Mickey Mouse"
  reliably; telling an Iconic foil from a regular is a tiny set symbol and a treatment — and
  that distinction is $560 against about $2. So the confirm screen puts **set and variant**
  front and centre for correction and treats the name as the easy part.
- **Unsure comes back blank, never guessed.** A wrong card name mints a phantom item that
  then splits the reports, the same twin problem as Fable/Fabled. "Didn't catch this one" is
  the correct output.

Rules:

- **The model fills in fields; a person presses save.** It never writes to the ledger. An
  AI-read card name is a suggestion someone confirmed, not a fact the system minted.
- **It degrades to typing.** No key, failed call, or rate limit and every screen still works
  exactly as it did — the same way the app behaves without a price feed.
- The key is a secret in config, `.env.example`, `tests/conftest.py` and CI, per the project
  rule, and is never logged.
- Rate-limited so a retry loop cannot burn the free tier.

Deferred, in rough order of appeal if it ever comes up again: screenshot → purchase, any
spreadsheet → import, plain-English report queries.

## What carries through all of it

- **Cost basis and original purchase date travel the whole chain**, case → box → card →
  graded card. Everything in reporting depends on it.
- **Estimates never touch cost basis or realized profit.** Typed values inform decisions;
  they do not score them.
- **Zero cost is not unknown cost.** Bulk counts at full margin with no ROI; unknown stays
  excluded from profit.
- **Nothing is blended that has different intent.** Vault out of ageing, tier compared within
  tier, lineage and tier never summed.

## Verification

```bash
uv run ruff check .
uv run pytest tests/ -q --cov=src --cov-fail-under=100
uv run alembic upgrade head && uv run alembic check
cd web && npm run lint && npm run build && npm run test:e2e
```

End to end, per step, on the deployed app:

1. Buy 2 cases; put one in Store and one in Vault. They show separately — impossible today.
2. Jason funds a $5,000 purchase personally; he is owed $5,000. He draws $3,000 from the
   joint account; he is owed $2,000. Sell a box, keep the cash, his balance drops again.
3. Sell for store credit at a named shop; realized profit rises, cash does not, and the
   credit shows on its own line.
4. Type "fab" and get Fabled. Type a new set; it is offered next time. The Hobbit appears by
   itself on 14 August.
5. Crack a case: 6 boxes, 4 Store / 1 Inventory / 1 Vault, cost split six ways summing back
   to the case exactly, all carrying the case's purchase date.
6. Rip a box, log three hits at $500 / $50 / $10; cost splits $134 / $13 / $3; the remainder
   is written off; a later bulk sale shows revenue with no ROI.
7. Send a card for grading; it shows a day count in its bucket. Return it as PSA 10; cost
   plus fees carries; the name pre-fills.
8. The Fabled case rolls up across everything it became. Tier comparison shows the average
   and the spread, not just the winner.
9. A Vault item shows appreciation against cost and never appears in "money asleep".
