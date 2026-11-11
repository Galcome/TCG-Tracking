import { EXPENSE_CATEGORY_LABELS, type Account, type ExpenseCategory, type FundingLeg, type Movement, type MovementLeg, type OpenItem, type PaidBack, type StatementLine, type Transaction } from './api'
import { money, perUnit, tone } from './format'
import { isIsoDate, isMoneyString } from './product-drafts'

export type MoneyAdjustmentDirection = 'up' | 'down'

export interface TransferDraft {
  fromAccountId: string
  toAccountId: string
  amount: string
  occurredOn: string
  notes: string
  /** The open item this pays back, when it was made with Pay back on that row. */
  settlesMovementId?: string
}

export interface BalanceAdjustmentDraft {
  accountId: string
  direction: MoneyAdjustmentDirection
  amount: string
  occurredOn: string
  notes: string
}

/** Setting a balance outright: "Jason says he is owed $5,000" is typed as 5000. */
export interface BalanceTargetDraft {
  accountId: string
  target: string
  occurredOn: string
  notes: string
}

export interface BalanceTargetPayload {
  account_id: string
  /** Signed integer cents in the account's own terms; the server works out the change. */
  target: number
  occurred_on: string
  notes: string | null
}

export interface ContributionDraft {
  memberId: string
  amount: string
  occurredOn: string
  notes: string
}

export interface ContributionPayload {
  member_id: string
  amount: string
  occurred_on: string
  notes: string | null
}

export interface ExpenseDraft {
  category: ExpenseCategory
  amount: string
  occurredOn: string
  /** One account that paid it all. Ignored when `split` is given. */
  paidFrom: string
  /** Legs already built from the split editor, validated by `allocationError`. */
  split: FundingLeg[] | null
  notes: string
}

export interface ExpensePayload {
  category: ExpenseCategory
  amount: string
  occurred_on: string
  paid_from: FundingLeg[]
  notes: string | null
}

export interface VoidMovementDraft {
  reason: string
}

export interface MoneyValidation {
  fromAccountId?: string
  toAccountId?: string
  accountId?: string
  amount?: string
  occurredOn?: string
  reason?: string
  [field: string]: string | undefined
}

export interface TransferPayload {
  from_account_id: string
  to_account_id: string
  amount: string
  occurred_on: string
  notes: string | null
  settles_movement_id?: string
}

export interface BalanceAdjustmentPayload {
  account_id: string
  /** The money endpoint accepts signed integer cents, unlike the other ledger writes. */
  amount: number
  occurred_on: string
  notes: string | null
}

/** Keep this bound explicit because the API's adjustment field is a JSON number. */
export const MAX_ADJUSTMENT_CENTS = 100_000_000_000

export function decimalCents(value: string): bigint | null {
  if (!isMoneyString(value, true)) return null
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole + fraction.padEnd(2, '0'))
}

/** Return exact positive cents without converting a decimal dollar string through a float. */
export function positiveMoney(value: string): boolean {
  const cents = decimalCents(value)
  return cents !== null && cents > 0n
}

export function storeCreditMeaning(balance: string, store: string): string {
  const value = balance.trim()
  if (/^-?0(?:\.0+)?$/.test(value)) return 'Nothing left here'
  if (value.startsWith('-')) return `Store credit is below zero at ${store}`
  return `Credit to spend at ${store}; not cash`
}

/** Convert a validated dollar string to the signed-cents API representation safely. */
export function parseAdjustmentCents(value: string): number | null {
  const cents = decimalCents(value)
  if (cents === null || cents <= 0n || cents > BigInt(MAX_ADJUSTMENT_CENTS)) return null
  return Number(cents)
}

/** The reason stamped on the void half of an edit, so the audit trail says what happened. */
export const EDIT_VOID_REASON = 'Replaced by a corrected entry'

interface PostedMovement {
  kind: string
  legs: { account_id: string; amount: string }[]
  occurred_on: string | null
  notes: string | null
  expense_category?: ExpenseCategory | null
  settles_movement_id?: string | null
}

/** A signed dollar string ("-12.50", "$5,000") as exact cents, or null when it is not one. */
export function signedCents(amount: string): bigint | null {
  const raw = amount.trim().replace(/[$,\s]/g, '')
  const negative = raw.startsWith('-')
  const magnitude = decimalCents(negative ? raw.slice(1) : raw)
  if (magnitude === null) return null
  return negative ? -magnitude : magnitude
}

const legCents = signedCents

/** Positive dollar strings added in exact cents, for a group total on screen. */
export function sumMoney(values: string[]): string {
  return dollars(values.reduce((total, value) => total + (signedCents(value) ?? 0n), 0n))
}

function dollars(cents: bigint): string {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
}

/** What the expense form needs to show a posted expense again. */
export interface ExpenseEdit {
  category: ExpenseCategory
  amount: string
  occurredOn: string
  notes: string
  /** The one account that paid, or blank when it was split. */
  paidFrom: string
  split: { accountId: string; amount: string }[] | null
}

/**
 * Re-open a posted expense as the form that produced it. Every leg of an expense is money
 * leaving an account, so anything else is not a shape this form can honestly reproduce.
 */
export function expenseEditFromMovement(movement: PostedMovement, today: string): ExpenseEdit | null {
  if (movement.kind !== 'expense' || !movement.expense_category || movement.legs.length === 0) return null
  const paid: { accountId: string; cents: bigint }[] = []
  for (const leg of movement.legs) {
    const cents = legCents(leg.amount)
    if (cents === null || cents >= 0n) return null
    paid.push({ accountId: leg.account_id, cents: -cents })
  }
  const total = paid.reduce((sum, leg) => sum + leg.cents, 0n)
  return {
    category: movement.expense_category,
    amount: dollars(total),
    occurredOn: movement.occurred_on ?? today,
    notes: movement.notes ?? '',
    paidFrom: paid.length === 1 ? paid[0].accountId : '',
    split: paid.length === 1 ? null : paid.map((leg) => ({ accountId: leg.accountId, amount: dollars(leg.cents) })),
  }
}

/** Re-open a posted transfer: the leg that lost money is the source, the other the destination. */
export function transferDraftFromMovement(movement: PostedMovement, today: string): TransferDraft | null {
  if (movement.kind !== 'transfer' || movement.legs.length !== 2) return null
  const flows = movement.legs.map((leg) => ({ accountId: leg.account_id, cents: legCents(leg.amount) }))
  const from = flows.find((leg) => leg.cents !== null && leg.cents < 0n)
  const to = flows.find((leg) => leg.cents !== null && leg.cents > 0n)
  if (!from || !to || from.cents !== -to.cents!) return null
  return {
    fromAccountId: from.accountId,
    toAccountId: to.accountId,
    amount: dollars(to.cents!),
    occurredOn: movement.occurred_on ?? today,
    notes: movement.notes ?? '',
    ...(movement.settles_movement_id ? { settlesMovementId: movement.settles_movement_id } : {}),
  }
}

/**
 * Re-open a posted adjustment as the draft that produced it.
 *
 * A leg carries raw cash flow; an adjustment is entered in the account's own terms, and for
 * a liability those are opposites - "owed $50 more" is $50 of cash flowing the other way.
 * The flip is its own inverse, so applying it again recovers what was typed.
 *
 * Returns null for anything that is not a single-leg adjustment, which is the only shape
 * this editor can honestly reproduce.
 */
export function adjustmentDraftFromMovement(
  movement: {
    kind: string
    legs: { account_id: string; amount: string }[]
    occurred_on: string | null
    notes: string | null
  },
  isLiability: boolean,
  today: string,
): BalanceAdjustmentDraft | null {
  if (movement.kind !== 'adjustment' || movement.legs.length !== 1) return null
  const [leg] = movement.legs
  const cents = legCents(leg.amount)
  if (cents === null || cents === 0n) return null
  const negative = cents < 0n
  const down = negative !== isLiability
  return {
    accountId: leg.account_id,
    direction: down ? 'down' : 'up',
    amount: dollars(negative ? -cents : cents),
    occurredOn: movement.occurred_on ?? today,
    notes: movement.notes ?? '',
  }
}

function validateDate(errors: MoneyValidation, value: string | undefined) {
  if (!value || !isIsoDate(value)) errors.occurredOn = 'Enter a date in YYYY-MM-DD format.'
}

function validateAmount(errors: MoneyValidation, value: string | undefined) {
  if (!value || !positiveMoney(value)) {
    errors.amount = 'Enter an amount greater than zero with up to two decimal places.'
  } else if (parseAdjustmentCents(value) === null) {
    errors.amount = 'Enter an amount no larger than 1 billion dollars with up to two decimal places.'
  }
}

export function validateTransferDraft(draft: Partial<TransferDraft>): MoneyValidation {
  const errors: MoneyValidation = {}
  if (!draft.fromAccountId) errors.fromAccountId = 'Choose the account money is leaving.'
  if (!draft.toAccountId) errors.toAccountId = 'Choose the account money is entering.'
  if (draft.fromAccountId && draft.toAccountId && draft.fromAccountId === draft.toAccountId) {
    errors.toAccountId = 'Choose a different destination account.'
  }
  validateAmount(errors, draft.amount)
  validateDate(errors, draft.occurredOn)
  return errors
}

export function validateBalanceAdjustmentDraft(draft: Partial<BalanceAdjustmentDraft>): MoneyValidation {
  const errors: MoneyValidation = {}
  if (!draft.accountId) errors.accountId = 'Choose an account to adjust.'
  if (draft.direction !== 'up' && draft.direction !== 'down') errors.reason = 'Choose whether the balance goes up or down.'
  validateAmount(errors, draft.amount)
  validateDate(errors, draft.occurredOn)
  return errors
}

/** What setting the balance to `target` would change it by, or null when either is unreadable. */
export function balanceChange(current: string, target: string): bigint | null {
  const from = signedCents(current)
  const to = signedCents(target)
  if (from === null || to === null) return null
  return to - from
}

/** The change a new balance makes, said the way the account means it. */
export function balanceChangeLine(account: { name: string; balance_means: string }, change: bigint): string {
  if (change === 0n) return 'No change - that is already the balance.'
  const up = change > 0n
  const amount = money(dollars(up ? change : -change))
  if (account.balance_means === 'owed') return `${account.name} will be owed ${amount} ${up ? 'more' : 'less'}`
  if (account.balance_means === 'credit') return `${amount} store credit ${up ? 'added' : 'removed'}`
  return `${amount} ${up ? 'into' : 'out of'} ${account.name}`
}

export function validateBalanceTargetDraft(draft: Partial<BalanceTargetDraft>, current: string): MoneyValidation {
  const errors: MoneyValidation = {}
  if (!draft.accountId) errors.accountId = 'Choose an account to adjust.'
  const target = signedCents(draft.target ?? '')
  if (target === null) {
    errors.amount = 'Enter the new balance, like 5000 or -25.50.'
  } else if ((target < 0n ? -target : target) > BigInt(MAX_ADJUSTMENT_CENTS)) {
    errors.amount = 'Enter a balance no larger than 1 billion dollars.'
  } else if (balanceChange(current, draft.target ?? '') === 0n) {
    errors.amount = 'That is already the balance.'
  }
  validateDate(errors, draft.occurredOn)
  return errors
}

export function buildBalanceTargetPayload(draft: BalanceTargetDraft, current: string): BalanceTargetPayload | null {
  if (Object.keys(validateBalanceTargetDraft(draft, current)).length > 0) return null
  return {
    account_id: draft.accountId,
    target: Number(signedCents(draft.target)),
    occurred_on: draft.occurredOn,
    notes: draft.notes.trim() || null,
  }
}

export function validateContributionDraft(draft: Partial<ContributionDraft>): MoneyValidation {
  const errors: MoneyValidation = {}
  if (!draft.memberId) errors.accountId = 'Choose whose shares this pays for.'
  validateAmount(errors, draft.amount?.trim())
  validateDate(errors, draft.occurredOn)
  return errors
}

export function buildContributionPayload(draft: ContributionDraft): ContributionPayload | null {
  if (Object.keys(validateContributionDraft(draft)).length > 0) return null
  return {
    member_id: draft.memberId,
    amount: draft.amount.trim(),
    occurred_on: draft.occurredOn,
    notes: draft.notes.trim() || null,
  }
}

export function validateExpenseDraft(draft: Partial<ExpenseDraft>, today: string): MoneyValidation {
  const errors: MoneyValidation = {}
  if (!draft.category) errors.category = 'Choose what the expense was for.'
  validateAmount(errors, draft.amount)
  validateDate(errors, draft.occurredOn)
  if (!errors.occurredOn && draft.occurredOn && draft.occurredOn > today) {
    errors.occurredOn = 'An expense cannot be dated in the future.'
  }
  if (!draft.split && !draft.paidFrom) errors.accountId = 'Choose who paid.'
  if (draft.category === 'other' && !draft.notes?.trim()) {
    errors.notes = "Say what an 'Other' expense was in the note."
  }
  return errors
}

export function buildExpensePayload(draft: ExpenseDraft, today: string): ExpensePayload | null {
  if (Object.keys(validateExpenseDraft(draft, today)).length > 0) return null
  return {
    category: draft.category,
    amount: draft.amount,
    occurred_on: draft.occurredOn,
    paid_from: draft.split ?? [{ account_id: draft.paidFrom }],
    notes: draft.notes.trim() || null,
  }
}

export function validateVoidMovementDraft(draft: Partial<VoidMovementDraft>): MoneyValidation {
  return draft.reason?.trim() ? {} : { reason: 'Give a reason for voiding this movement.' }
}

export function firstMoneyValidationError(errors: MoneyValidation): string | null {
  const first = Object.values(errors).find((message): message is string => Boolean(message))
  return first ?? null
}

export function buildTransferPayload(draft: TransferDraft): TransferPayload | null {
  if (Object.keys(validateTransferDraft(draft)).length > 0) return null
  return {
    from_account_id: draft.fromAccountId,
    to_account_id: draft.toAccountId,
    amount: draft.amount,
    occurred_on: draft.occurredOn,
    notes: draft.notes.trim() || null,
    ...(draft.settlesMovementId ? { settles_movement_id: draft.settlesMovementId } : {}),
  }
}

export function buildBalanceAdjustmentPayload(draft: BalanceAdjustmentDraft): BalanceAdjustmentPayload | null {
  if (Object.keys(validateBalanceAdjustmentDraft(draft)).length > 0) return null
  const cents = parseAdjustmentCents(draft.amount)
  if (cents === null) return null
  return {
    account_id: draft.accountId,
    amount: draft.direction === 'up' ? cents : -cents,
    occurred_on: draft.occurredOn,
    notes: draft.notes.trim() || null,
  }
}

/** One account a movement touched, in plain words. A leg's amount is signed cash flow, so for
 * a partner (a liability) money leaving means the business owes them more. */
/** Who an open item is owed to, and how much of it is left when part has been paid back. */
export function openItemLine(item: OpenItem): string {
  const leg = item.movement.legs.find((candidate) => candidate.account_id === item.account_id)
  const paid = leg ? money(leg.amount.trim().replace(/^-/, '')) : null
  if (!paid || paid === money(item.outstanding)) return `${item.account_name} paid for this`
  return `${item.account_name} is still owed ${money(item.outstanding)} of ${paid}`
}

/** Why one statement line moved this account, in words a partner would use. */
export function statementReason(line: StatementLine, account: Pick<Account, 'id' | 'kind'>): string {
  const { movement } = line
  const up = tone(line.change) === 'gain'
  const others = movement.legs.filter((leg) => leg.account_id !== account.id).map((leg) => leg.account_name).join(', ')
  const product = movement.product_name ?? 'stock'
  switch (movement.kind) {
    case 'funding':
      return up ? `Paid for ${product}` : `Bought ${product}`
    case 'proceeds':
      return account.kind === 'member' ? `Kept the cash from selling ${product}` : `Sold ${product}`
    case 'expense':
      return `${up ? 'Paid' : 'Spent on'} ${movement.expense_category ? EXPENSE_CATEGORY_LABELS[movement.expense_category].toLowerCase() : 'an expense'}`
    case 'transfer':
      if (account.kind === 'member') return up ? `Put money into ${others}` : `Paid back from ${others}`
      return up ? `From ${others}` : `To ${others}`
    case 'contribution':
      return 'Buy-in'
    default:
      return 'Balance adjustment'
  }
}

/** A movement in a few words: what happened, not every account it touched. */
export function movementHeadline(movement: Pick<Movement, 'kind' | 'legs' | 'product_name' | 'expense_category'>): string {
  const into = movement.legs.find((leg) => tone(leg.amount) === 'gain')
  const out = movement.legs.find((leg) => tone(leg.amount) === 'loss')
  const product = movement.product_name ?? 'stock'
  switch (movement.kind) {
    case 'funding':
      return `Bought ${product}`
    case 'proceeds':
      return `Sold ${product}`
    case 'expense':
      return movement.expense_category ? EXPENSE_CATEGORY_LABELS[movement.expense_category] : 'Expense'
    case 'transfer':
      if (into?.account_kind === 'member' && out?.account_kind !== 'member') return `Paid back ${into.account_name}`
      if (out?.account_kind === 'member' && into?.account_kind !== 'member') return `${out.account_name} put money in`
      return `${out?.account_name ?? 'Transfer'} → ${into?.account_name ?? ''}`.trim()
    case 'contribution':
      return 'Buy-in'
    default:
      return 'Balance adjustment'
  }
}

function partyNames(legs: Pick<MovementLeg, 'account_name' | 'amount'>[]): string {
  if (legs.length === 1) return legs[0].account_name
  return legs.map((leg) => `${leg.account_name} ${money(leg.amount.trim().replace(/^-/, ''))}`).join(', ')
}

/**
 * Who was on each side of a movement, in one line: "Paid by Joseph", "Cash to Joint account",
 * "Joint account → Joseph". The figures behind it are a tap away on the card.
 */
export function movementParties(movement: Pick<Movement, 'kind' | 'legs'>): string {
  const out = movement.legs.filter((leg) => tone(leg.amount) === 'loss')
  const into = movement.legs.filter((leg) => tone(leg.amount) === 'gain')
  if (movement.kind === 'funding' || movement.kind === 'expense') return out.length ? `Paid by ${partyNames(out)}` : ''
  if (movement.kind === 'proceeds') return into.length ? `Cash to ${partyNames(into)}` : ''
  if (movement.kind === 'adjustment') return partyNames(movement.legs)
  if (out.length && into.length) return `${partyNames(out)} → ${partyNames(into)}`
  if (into.length) return `Into ${partyNames(into)}`
  return out.length ? `Out of ${partyNames(out)}` : ''
}

/** Re-open a payback made against `settlesMovementId` as the transfer that made it. */
export function transferDraftFromPayback(
  payback: Pick<PaidBack, 'from_account_id' | 'to_account_id' | 'amount' | 'occurred_on' | 'notes'>,
  settlesMovementId: string,
  today: string,
): TransferDraft {
  return {
    fromAccountId: payback.from_account_id,
    toAccountId: payback.to_account_id,
    amount: payback.amount,
    occurredOn: payback.occurred_on ?? today,
    notes: payback.notes ?? '',
    settlesMovementId,
  }
}

/** The small print under a movement: "2026-11-10 · Entered by Joseph · Paying back ETB". */
export function movementDetail(row: { occurred_on: string | null; entered_by_name?: string | null; notes: string | null }): string {
  return [row.occurred_on ?? 'No date', row.entered_by_name ? `Entered by ${row.entered_by_name}` : null, row.notes].filter(Boolean).join(' · ')
}

/** When and from where a movement was paid back: "Paid back 2026-11-10 from Joint account". */
export function paidBackLine(payback: Pick<PaidBack, 'occurred_on' | 'from_account_name'>): string {
  return ['Paid back', payback.occurred_on, 'from', payback.from_account_name].filter(Boolean).join(' ')
}

/** A statement change with its sign always shown: "+$271.06", "−$335.00". */
export function signedChange(change: string): string {
  const amount = money(change.trim().replace(/^[-+]/, ''))
  return (tone(change) === 'loss' ? '−' : '+') + amount
}

export function legLine(leg: Pick<MovementLeg, 'account_name' | 'account_kind' | 'amount'>): string {
  const out = tone(leg.amount) === 'loss'
  const amount = money(leg.amount.trim().replace(/^-/, ''))
  if (leg.account_kind === 'member') return leg.account_name + ' is owed ' + amount + (out ? ' more' : ' less')
  if (leg.account_kind === 'store_credit') return amount + ' store credit ' + (out ? 'used at ' : 'added at ') + leg.account_name
  return amount + (out ? ' out of ' : ' into ') + leg.account_name
}

/** One labelled figure in a transaction's cost breakdown. */
export interface BreakdownRow {
  label: string
  value: string
}

/** What a purchase or sale was made of, top to bottom, ending in what it came to. Zero extras
 *  are left out so the rows shown always add up to the last one. */
export function costBreakdown(
  t: Pick<Transaction, 'kind' | 'quantity' | 'amount' | 'base_amount' | 'shipping' | 'tax' | 'fees' | 'platform_fees' | 'payment_fees' | 'shipping_paid' | 'cost' | 'profit' | 'has_unknown_cost'>,
): BreakdownRow[] {
  const units = Math.abs(t.quantity)
  /** The amount, and the price of one when several went together. */
  const withEach = (amount: string) => {
    const one = units > 1 ? perUnit(amount, units) : null
    return money(amount) + (one !== null ? ` (${money(one)} each)` : '')
  }
  const nonZero = (value: string | null): value is string => value !== null && tone(value) !== null
  const rows: BreakdownRow[] = [{ label: 'Quantity', value: String(units) }]
  if (t.kind === 'purchase') {
    const price = t.base_amount ?? t.amount
    if (price !== null) rows.push({ label: 'Price', value: withEach(price) })
    for (const [label, value] of [['Shipping', t.shipping], ['Tax', t.tax], ['Fees', t.fees]] as const) {
      if (nonZero(value)) rows.push({ label, value: money(value) })
    }
    if (t.amount !== null) rows.push({ label: 'Total paid', value: withEach(t.amount) })
    return rows
  }
  if (t.kind === 'sale') {
    if (t.amount !== null) rows.push({ label: 'Sold for', value: withEach(t.amount) })
    for (const [label, value] of [['Platform fees', t.platform_fees], ['Payment fees', t.payment_fees], ['Shipping paid', t.shipping_paid]] as const) {
      if (nonZero(value)) rows.push({ label, value: '−' + money(value) })
    }
    rows.push({ label: 'Cost', value: t.has_unknown_cost || t.cost === null ? 'Unknown' : money(t.cost) })
    if (!t.has_unknown_cost && t.profit !== null) rows.push({ label: 'Profit', value: money(t.profit) })
    return rows
  }
  if (t.amount !== null) rows.push({ label: 'Amount', value: money(t.amount) })
  return rows
}
