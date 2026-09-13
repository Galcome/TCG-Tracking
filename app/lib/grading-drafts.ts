import { BUCKETS, type Bucket, type GradingSubmission, type NewProduct } from './api'
import { isIsoDate, isMoneyString, optionalText, parseIntegerQuantity } from './product-drafts'

/**
 * Values kept by the grading forms before they are sent to the API.
 *
 * Quantities and money deliberately stay as strings until a payload is built. The API
 * owns availability, FIFO allocation, cost carry-over, and fee arithmetic; the client only
 * performs shape validation and passes the user's decimal text through unchanged.
 */
export interface SendToGradingDraft {
  productId: string
  quantity: string
  bucket: Bucket | ''
  gradingCompany: string
  sentOn: string
  fees: string
  rawValue?: string
  notes?: string
}

export interface ReturnFromGradingDraft {
  submissionId: string
  sourceProductId: string
  /** Existing graded child, or empty when the child is to be created inline. */
  gradedProductId: string
  name: string
  gameId: string
  productTypeId: string
  setName?: string | null
  collectorNumber?: string | null
  variant?: string | null
  language?: string | null
  condition?: string | null
  gradingCompany: string | null
  grade: string
  certNumber: string
  storageLocation?: string | null
  returnedOn: string
  extraFees: string
  gradedValue?: string
  notes?: string
}

export interface VoidGradingDraft {
  submissionId: string
  reason: string
}

export interface GradingValidation {
  productId?: string
  submissionId?: string
  quantity?: string
  bucket?: string
  gradingCompany?: string
  sentOn?: string
  fees?: string
  rawValue?: string
  gradedProductId?: string
  name?: string
  gameId?: string
  productTypeId?: string
  grade?: string
  certNumber?: string
  returnedOn?: string
  extraFees?: string
  gradedValue?: string
  reason?: string
  [field: string]: string | undefined
}

/** The server currently bounds a grading submission to 1,000 units. */
export const MAX_GRADING_QUANTITY = 1_000

/** UI protection only; concurrent clients still require server-side reservation guards. */
export function gradingAvailable(productId: string, held: Record<Bucket, number>, submissions: GradingSubmission[]): Record<Bucket, number> {
  return Object.fromEntries(BUCKETS.map(bucket => [bucket, Math.max(0, held[bucket] - submissions
    .filter(s => s.product_id === productId && s.bucket === bucket && s.status === 'out')
    .reduce((sum, s) => sum + s.quantity, 0))])) as Record<Bucket, number>
}

export function validateGradingReturnContext(submission: GradingSubmission, held: Record<Bucket, number>, returnedOn: string): GradingValidation {
  const errors: GradingValidation = {}
  if (submission.status !== 'out') errors.submissionId = 'Only an outstanding submission can be returned.'
  if (held[submission.bucket] < submission.quantity) errors.quantity = 'The original bucket no longer holds enough stock for this return.'
  if (!isIsoDate(returnedOn)) errors.returnedOn = 'Enter a date in YYYY-MM-DD format.'
  else if (returnedOn < submission.sent_on) errors.returnedOn = 'The return date cannot be before the sent date.'
  return errors
}

/** Either a bucket count or the product-shaped count object used by screen validators. */
export type GradingAvailability =
  | number
  | Partial<Record<Bucket, number>>
  | { stats: { by_bucket: Partial<Record<Bucket, number>> } }

function validateOptionalMoney(value: string | undefined, field: keyof GradingValidation, errors: GradingValidation) {
  if (value !== undefined && !isMoneyString(value)) {
    errors[field] = 'Use digits with up to two decimal places.'
  }
}

function validateDate(value: string, field: 'sentOn' | 'returnedOn', errors: GradingValidation) {
  if (!isIsoDate(value)) errors[field] = 'Enter a date in YYYY-MM-DD format.'
}

export interface GradedProductIdentityDraft {
  name: string
  gameId: string
  productTypeId: string
  gradingCompany?: string | null
  grade?: string
  certNumber?: string
}

export function validateGradedProductDraft(draft: Partial<GradedProductIdentityDraft>): GradingValidation {
  const errors: GradingValidation = {}
  if (!draft.name?.trim()) errors.name = 'The graded card needs a name.'
  if (!draft.gameId?.trim()) errors.gameId = 'Choose a game.'
  if (!draft.productTypeId?.trim()) errors.productTypeId = 'Choose the graded card product type.'
  if (draft.name?.trim() && draft.name.trim().length > 200) errors.name = 'Use 200 characters or fewer.'
  if ((draft.grade ?? '').trim().length > 20) errors.grade = 'Use 20 characters or fewer.'
  if ((draft.certNumber ?? '').trim().length > 40) errors.certNumber = 'Use 40 characters or fewer.'
  if (draft.gradingCompany && draft.gradingCompany.trim().length > 40) {
    errors.gradingCompany = 'Use 40 characters or fewer.'
  }
  return errors
}

/** Validate the send form, with an optional friendly check against the displayed bucket count. */
export function validateSendToGradingDraft(
  draft: Partial<SendToGradingDraft>,
  available?: GradingAvailability,
): GradingValidation {
  const errors: GradingValidation = {}
  if (!draft.productId?.trim()) errors.productId = 'A product is required.'

  const quantity = parseIntegerQuantity(draft.quantity ?? '', { positive: true })
  if (quantity === null) {
    errors.quantity = 'Enter a whole number greater than zero.'
  } else if (quantity > MAX_GRADING_QUANTITY) {
    errors.quantity = `Send no more than ${MAX_GRADING_QUANTITY.toLocaleString()} units at a time.`
  } else {
    const availableCount = draft.bucket
      ? typeof available === 'number'
        ? available
        : available && 'stats' in available
          ? available.stats.by_bucket[draft.bucket]
          : available?.[draft.bucket]
      : undefined
    if (availableCount !== undefined && quantity > availableCount) {
      errors.quantity = `Only ${availableCount} units are in this bucket.`
    }
  }

  if (!draft.bucket) errors.bucket = 'Choose the bucket the cards are in.'
  if (draft.gradingCompany !== undefined && draft.gradingCompany.trim().length > 40) {
    errors.gradingCompany = 'Use 40 characters or fewer.'
  }
  if (!draft.sentOn) {
    errors.sentOn = 'Enter a date in YYYY-MM-DD format.'
  } else {
    validateDate(draft.sentOn, 'sentOn', errors)
  }
  validateOptionalMoney(draft.fees, 'fees', errors)
  validateOptionalMoney(draft.rawValue, 'rawValue', errors)
  return errors
}

/** Validate the return form before either reusing or creating its graded child. */
export function validateReturnFromGradingDraft(draft: Partial<ReturnFromGradingDraft>): GradingValidation {
  const errors: GradingValidation = {}
  if (!draft.submissionId?.trim()) errors.submissionId = 'A grading submission is required.'
  if (!draft.sourceProductId?.trim()) errors.productId = 'The raw product is required.'

  const childId = draft.gradedProductId?.trim() ?? ''
  if (childId && draft.sourceProductId && childId === draft.sourceProductId) {
    errors.gradedProductId = 'The graded card must be a different product from the raw card.'
  }

  // An existing ID is enough to identify the child. Otherwise the inline identity must be
  // complete so a retry can safely use the same created row.
  if (!childId) {
    Object.assign(errors, validateGradedProductDraft(draft))
  } else {
    if ((draft.grade ?? '').trim().length > 20) errors.grade = 'Use 20 characters or fewer.'
    if ((draft.certNumber ?? '').trim().length > 40) errors.certNumber = 'Use 40 characters or fewer.'
    if (draft.gradingCompany && draft.gradingCompany.trim().length > 40) {
      errors.gradingCompany = 'Use 40 characters or fewer.'
    }
  }
  if (!draft.returnedOn) {
    errors.returnedOn = 'Enter a date in YYYY-MM-DD format.'
  } else {
    validateDate(draft.returnedOn, 'returnedOn', errors)
  }
  validateOptionalMoney(draft.extraFees, 'extraFees', errors)
  validateOptionalMoney(draft.gradedValue, 'gradedValue', errors)
  return errors
}

/** Validate the required audit reason for cancelling an outstanding submission. */
export function validateVoidGradingDraft(draft: Partial<VoidGradingDraft>): GradingValidation {
  const errors: GradingValidation = {}
  if (!draft.submissionId?.trim()) errors.submissionId = 'A grading submission is required.'
  const reason = draft.reason?.trim() ?? ''
  if (!reason) errors.reason = 'Give a reason for cancelling this grading submission.'
  else if (reason.length > 500) errors.reason = 'Use 500 characters or fewer.'
  return errors
}

export function firstGradingValidationError(errors: GradingValidation): string | null {
  return Object.values(errors).find((message): message is string => Boolean(message)) ?? null
}

export interface SendToGradingPayload {
  product_id: string
  quantity: number
  bucket: Bucket
  grading_company: string | null
  sent_on: string
  fees?: string
  notes: string | null
}

/** Build the server request while preserving the entered money/date text. */
export function buildSendToGradingPayload(draft: SendToGradingDraft): SendToGradingPayload | null {
  if (firstGradingValidationError(validateSendToGradingDraft(draft))) return null
  const quantity = parseIntegerQuantity(draft.quantity, { positive: true })
  if (quantity === null || !draft.bucket) return null
  return {
    product_id: draft.productId.trim(),
    quantity,
    bucket: draft.bucket,
    grading_company: optionalText(draft.gradingCompany),
    sent_on: draft.sentOn,
    fees: draft.fees || undefined,
    notes: optionalText(draft.notes ?? ''),
  }
}

export interface ReturnFromGradingPayload {
  graded_product_id: string
  grade: string | null
  returned_on: string
  extra_fees?: string
  notes: string | null
}

/** Build the return request; cost and lineage remain entirely server-derived. */
export function buildReturnFromGradingPayload(draft: ReturnFromGradingDraft): ReturnFromGradingPayload | null {
  if (firstGradingValidationError(validateReturnFromGradingDraft(draft))) return null
  const gradedProductId = draft.gradedProductId.trim()
  if (!gradedProductId) return null
  return {
    graded_product_id: gradedProductId,
    grade: optionalText(draft.grade),
    returned_on: draft.returnedOn,
    extra_fees: draft.extraFees || undefined,
    notes: optionalText(draft.notes ?? ''),
  }
}

export function buildVoidGradingPayload(draft: VoidGradingDraft): string | null {
  if (firstGradingValidationError(validateVoidGradingDraft(draft))) return null
  return draft.reason.trim()
}

/** Fields used when the return form creates its graded child inline. */
export function buildGradedProductPayload(draft: ReturnFromGradingDraft): NewProduct | null {
  if (firstGradingValidationError(validateGradedProductDraft(draft))) return null
  return {
    name: draft.name.trim(),
    game_id: draft.gameId,
    product_type_id: draft.productTypeId,
    set_name: optionalText(draft.setName ?? ''),
    collector_number: optionalText(draft.collectorNumber ?? ''),
    variant: optionalText(draft.variant ?? ''),
    language: optionalText(draft.language ?? ''),
    condition: optionalText(draft.condition ?? ''),
    grading_company: optionalText(draft.gradingCompany ?? ''),
    grade: optionalText(draft.grade),
    cert_number: optionalText(draft.certNumber),
    storage_location: optionalText(draft.storageLocation ?? ''),
    notes: optionalText(draft.notes ?? ''),
    // Deliberately no initial purchase: the grading transformation carries the source
    // FIFO cost plus fees and preserves the source purchase date on the server.
  }
}

// Compatibility aliases keep naming parallel with the other draft modules and make the
// pure helpers easy to discover from future screens.
export const validateSendGradingDraft = validateSendToGradingDraft
export const validateReturnGradingDraft = validateReturnFromGradingDraft
export const buildSendGradingPayload = buildSendToGradingPayload
export const buildReturnGradingPayload = buildReturnFromGradingPayload
export const validateGradingSendDraft = validateSendToGradingDraft
export const validateGradingReturnDraft = validateReturnFromGradingDraft
export const validateGradingVoidDraft = validateVoidGradingDraft
export const buildGradingSendPayload = buildSendToGradingPayload
export const buildGradingReturnPayload = buildReturnFromGradingPayload
