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
