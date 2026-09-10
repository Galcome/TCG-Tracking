import { isIsoDate, isMoneyString } from './product-drafts'

/** The fields used by the manual, per-unit Vault valuation form. */
export interface ValuationDraft {
  productId: string
  value: string
  capturedOn: string
  notes: string
}

export interface ValuationValidation {
  productId?: string
  value?: string
  capturedOn?: string
  [field: string]: string | undefined
}

/** The only request written by the valuation form. Money remains a decimal string. */
export interface ValuationPayload {
  product_id: string
  value: string
  captured_on: string
  notes: string | null
}

/** A nonnegative CAD amount accepted by the backend, including zero. */
export function valuationMoney(value: string, required = false): boolean {
  return isMoneyString(value, required)
}

/** A calendar-aware ISO date accepted by the backend. */
export function valuationDate(value: string): boolean {
  return isIsoDate(value)
}

export function validateValuationDraft(draft: Partial<ValuationDraft>): ValuationValidation {
  const errors: ValuationValidation = {}
  if (!draft.productId?.trim()) errors.productId = 'Choose a product.'
  if (!valuationMoney(draft.value ?? '', true)) {
    errors.value = 'Enter a per-unit estimate with up to two decimal places.'
  }
  if (!valuationDate(draft.capturedOn ?? '')) {
    errors.capturedOn = 'Enter a date in YYYY-MM-DD format.'
  }
  return errors
}

/** Build the server request without converting, rounding, or calculating money on-device. */
export function buildValuationPayload(draft: ValuationDraft): ValuationPayload | null {
  if (Object.keys(validateValuationDraft(draft)).length > 0) return null

  return {
    product_id: draft.productId.trim(),
    value: draft.value,
    captured_on: draft.capturedOn,
    notes: draft.notes.trim() || null,
  }
}

export function firstValuationValidationError(errors: ValuationValidation): string | null {
  const first = Object.values(errors).find((message): message is string => Boolean(message))
  return first ?? null
}
