import type { ExpenseCategory, FundingLeg } from './api'
import { isIsoDate, isMoneyString } from './product-drafts'

export type MoneyAdjustmentDirection = 'up' | 'down'

export interface TransferDraft {
  fromAccountId: string
  toAccountId: string
  amount: string
  occurredOn: string
  notes: string
}

export interface BalanceAdjustmentDraft {
  accountId: string
  direction: MoneyAdjustmentDirection
  amount: string
  occurredOn: string
  notes: string
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
export const EDIT_VOID_REASON = 'Replaced by a corrected adjustment'

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
  const raw = leg.amount.trim()
  const negative = raw.startsWith('-')
  const magnitude = decimalCents(negative ? raw.slice(1) : raw)
  if (magnitude === null || magnitude === 0n) return null
  const down = negative !== isLiability
  return {
    accountId: leg.account_id,
    direction: down ? 'down' : 'up',
    amount: `${magnitude / 100n}.${String(magnitude % 100n).padStart(2, '0')}`,
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
