import type { Bucket, Taxonomy, Transaction } from './api'
import { suggestedProductName } from './product-types'

/**
 * Validation shared by the native forms and their unit tests.
 *
 * Quantities are deliberately parsed only after they have passed the integer check. Money
 * stays a string all the way to the API; the client never performs ledger arithmetic.
 */
export type ProductFormMode =
  | 'add'
  | 'edit'
  | 'purchase'
  | 'move'
  | 'adjust'
  | 'transaction'
  | 'void'

export interface DraftValidation {
  name?: string
  gameId?: string
  productTypeId?: string
  productId?: string
  quantity?: string
  amount?: string
  date?: string
  fromBucket?: string
  toBucket?: string
  reason?: string
  auditReason?: string
  cost?: string
  [field: string]: string | undefined
}

export interface DraftValues {
  name?: string
  gameId?: string
  productTypeId?: string
  productId?: string
  quantity?: string
  amount?: string
  date?: string
  fromBucket?: Bucket | ''
  toBucket?: Bucket | ''
  reason?: string
  cost?: string
  auditReason?: string
  transaction?: Transaction
}

/**
 * Return the name shown/sent by product entry. Sealed products can be named from their set and
 * type until the person edits the field; once touched, the manual value is permanent for that
 * draft even if the set or type changes later. Card types intentionally derive an empty name.
 */
export function effectiveProductName(
  manualName: string,
  manualNameTouched: boolean,
  setName: string,
  productType: Taxonomy | undefined,
): string {
  return manualNameTouched ? manualName : suggestedProductName(setName, productType)
}

const MONEY_RE = /^\d+(?:\.\d{1,2})?$/
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function parseIntegerQuantity(value: string, options: { positive?: boolean } = {}): number | null {
  const rendered = value.trim()
  if (!/^-?\d+$/.test(rendered)) return null
  const parsed = Number(rendered)
  if (!Number.isSafeInteger(parsed)) return null
  if (options.positive && parsed < 1) return null
  return parsed
}

/** Return true for an API-compatible decimal string, without coercing it to a number. */
export function isMoneyString(value: string, required = false): boolean {
  if (value === '') return !required
  return MONEY_RE.test(value)
}

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}

export function optionalText(value: string): string | null {
  return value.trim() || null
}

function validateQuantity(errors: DraftValidation, value: string | undefined, positive: boolean) {
  if (value === undefined || parseIntegerQuantity(value, { positive }) === null) {
    errors.quantity = positive ? 'Enter a whole number greater than zero.' : 'Enter a whole number.'
  }
}

function validateAmount(errors: DraftValidation, value: string | undefined, required: boolean) {
  if (value === undefined || !isMoneyString(value, required)) {
    errors.amount = required ? 'Enter an amount with up to two decimal places.' : 'Use digits with up to two decimal places.'
  }
}

function validateDate(errors: DraftValidation, value: string | undefined) {
  if (!value || !isIsoDate(value)) errors.date = 'Enter a date in YYYY-MM-DD format.'
}

/** Validate the minimum safe fields before a mutation is sent to the server. */
export function validateDraft(mode: ProductFormMode, values: DraftValues): DraftValidation {
  const errors: DraftValidation = {}

  if (mode === 'add' || mode === 'edit') {
    if (!values.name?.trim()) errors.name = 'Name is required.'
    if (!values.gameId) errors.gameId = 'Choose a game.'
    if (!values.productTypeId) errors.productTypeId = 'Choose a product type.'
  }

  if (mode === 'add' || mode === 'purchase') {
    if (mode === 'purchase' && !values.productId) errors.productId = 'Choose a product.'
    validateQuantity(errors, values.quantity, true)
    validateAmount(errors, values.amount, true)
    validateDate(errors, values.date)
  }

  if (mode === 'move') {
    if (!values.productId) errors.productId = 'Choose a product.'
    validateQuantity(errors, values.quantity, true)
    validateDate(errors, values.date)
    if (!values.fromBucket) errors.fromBucket = 'Choose where stock is coming from.'
    if (!values.toBucket) errors.toBucket = 'Choose where stock is going.'
    if (values.fromBucket && values.fromBucket === values.toBucket) {
      errors.toBucket = 'Choose a different destination bucket.'
    }
  }

  if (mode === 'adjust') {
    if (!values.productId) errors.productId = 'Choose a product.'
    const delta = parseIntegerQuantity(values.quantity ?? '')
    if (delta === null || delta === 0) errors.quantity = 'Enter a non-zero whole number.'
    if (!values.reason) errors.reason = 'Choose a reason.'
    if (delta !== null && delta > 0 && values.cost !== undefined && !isMoneyString(values.cost)) {
      errors.cost = 'Use digits with up to two decimal places.'
    }
  }

  if (mode === 'transaction') {
    const transaction = values.transaction
    if (!transaction) {
      errors.transaction = 'A transaction is required.'
    } else if (transaction.kind === 'adjustment') {
      const delta = parseIntegerQuantity(values.quantity ?? '')
      if (delta === null || delta === 0) errors.quantity = 'Enter a non-zero whole number.'
      if (!values.reason) errors.reason = 'Choose a reason.'
      if (values.date || transaction.occurred_on) validateDate(errors, values.date)
    } else if (transaction.kind === 'purchase' || transaction.kind === 'sale') {
      validateQuantity(errors, values.quantity, true)
      // Existing unknown amounts are left alone. A newly entered amount is validated.
      if (values.amount !== undefined && values.amount !== '') validateAmount(errors, values.amount, true)
      if (values.date || transaction.occurred_on) validateDate(errors, values.date)
    }
  }

  if (mode === 'void' && !values.reason?.trim()) errors.reason = 'Give a reason for voiding this transaction.'

  return errors
}

export function firstValidationError(errors: DraftValidation): string | null {
  const first = Object.values(errors).find((message): message is string => Boolean(message))
  return first ?? null
}
