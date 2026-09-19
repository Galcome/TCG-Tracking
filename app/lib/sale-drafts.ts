import type { Bucket, NewSale, NewSaleOrder, ProceedsLeg, SaleLine, SaleOrderPreview, SaleOrderPreviewInput, SalePreview } from './api'
import { isIsoDate } from './product-drafts'

export interface SaleDraft {
  productId: string
  quantity: string
  amount: string
  platformFees: string
  paymentFees: string
  shippingPaid: string
  saleDate: string
  bucket: Bucket | ''
  soldByMemberId: string
  marketplace: string
  notes: string
  allowOversell: boolean
  proceeds: SaleProceeds
}

export type SaleProceeds =
  | { kind: 'account'; accountId: string }
  | { kind: 'store'; store: string }
  | { kind: 'none' }

export interface SaleAccountRef {
  id: string
  member_id: string | null
}

export interface SaleValidation {
  productId?: string
  quantity?: string
  amount?: string
  platformFees?: string
  paymentFees?: string
  shippingPaid?: string
  saleDate?: string
  bucket?: string
  proceeds?: string
  [field: string]: string | undefined
}

export interface SalePreviewInput {
  product_id: string
  quantity: number
  amount: string
  platform_fees: string
  payment_fees: string
  shipping_paid: string
  sale_date: string
}

const MONEY_RE = /^\d+(?:\.\d{1,2})?$/

export function saleInteger(value: string): number | null {
  const rendered = value.trim()
  if (!/^\d+$/.test(rendered)) return null
  const parsed = Number(rendered)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export function saleMoney(value: string, required = false): boolean {
  if (value === '') return !required
  return MONEY_RE.test(value)
}

export function saleDate(value: string): boolean {
  return isIsoDate(value)
}

export function validateSaleDraft(draft: Partial<SaleDraft>): SaleValidation {
  const errors: SaleValidation = {}
  if (!draft.productId) errors.productId = 'Choose a product.'
  if (saleInteger(draft.quantity ?? '') === null) errors.quantity = 'Enter a whole number greater than zero.'
  if (!saleMoney(draft.amount ?? '', true)) errors.amount = 'Enter an amount with up to two decimal places.'
  if (!saleMoney(draft.platformFees ?? '')) errors.platformFees = 'Use digits with up to two decimal places.'
  if (!saleMoney(draft.paymentFees ?? '')) errors.paymentFees = 'Use digits with up to two decimal places.'
  if (!saleMoney(draft.shippingPaid ?? '')) errors.shippingPaid = 'Use digits with up to two decimal places.'
  if (!saleDate(draft.saleDate ?? '')) errors.saleDate = 'Enter a date in YYYY-MM-DD format.'
  if (!draft.bucket) errors.bucket = 'Choose the bucket the stock came from.'

  if (!draft.proceeds) {
    errors.proceeds = 'Choose where the sale money went.'
  } else if (draft.proceeds.kind === 'account' && !draft.proceeds.accountId) {
    errors.proceeds = 'Choose an account or store credit destination.'
  } else if (draft.proceeds.kind === 'store' && !draft.proceeds.store.trim()) {
    errors.proceeds = 'Enter the store that holds the credit.'
  }
  return errors
}

/** Build the server preview request without doing any money arithmetic in the client. */
export function previewInput(draft: Partial<SaleDraft>): SalePreviewInput | null {
  const quantity = saleInteger(draft.quantity ?? '')
  if (!draft.productId || quantity === null || !saleMoney(draft.amount ?? '', true) || !saleDate(draft.saleDate ?? '')) {
    return null
  }
  return {
    product_id: draft.productId,
    quantity,
    amount: draft.amount ?? '',
    platform_fees: draft.platformFees || '0',
    payment_fees: draft.paymentFees || '0',
    shipping_paid: draft.shippingPaid || '0',
    sale_date: draft.saleDate ?? '',
  }
}

/** A stable identity for one server-side preview input. */
export function salePreviewKey(input: SalePreviewInput): string {
  return [
    input.product_id,
    String(input.quantity),
    input.amount,
    input.platform_fees,
    input.payment_fees,
    input.shipping_paid,
    input.sale_date,
  ].join('\u001f')
}

/** Guard UI rendering against a response belonging to an older set of fields. */
export function isPreviewCurrent(current: SalePreviewInput | null, received: SalePreviewInput | null): boolean {
  return current !== null && received !== null && salePreviewKey(current) === salePreviewKey(received)
}

/**
 * Resolve the untouched proceeds default from the person credited with the sale.
 *
 * `accountOverride` is deliberately separate from the selected proceeds value: an empty
 * account id means either "not loaded yet" or an explicit no-account choice in the UI.
 * Only the former may follow a later seller change.
 */
export function resolveSaleProceeds(
  proceeds: SaleProceeds,
  accountOverride: string | null,
  soldByMemberId: string,
  currentMemberId: string | null | undefined,
  accounts: readonly SaleAccountRef[],
): SaleProceeds {
  if (proceeds.kind !== 'account' || proceeds.accountId !== '' || accountOverride !== null) return proceeds
  const memberId = soldByMemberId || currentMemberId
  const account = memberId ? accounts.find((candidate) => candidate.member_id === memberId) : undefined
  return { kind: 'account', accountId: account?.id ?? '' }
}

export function buildSalePayload(draft: SaleDraft): NewSale | null {
  const errors = validateSaleDraft(draft)
  if (Object.keys(errors).length > 0) return null
  const quantity = saleInteger(draft.quantity)
  if (quantity === null || !draft.bucket) return null

  const proceeds = proceedsLegs(draft.proceeds)

  return {
    product_id: draft.productId,
    quantity,
    amount: draft.amount,
    bucket: draft.bucket,
    platform_fees: draft.platformFees || undefined,
    payment_fees: draft.paymentFees || undefined,
    shipping_paid: draft.shippingPaid || undefined,
    sale_date: draft.saleDate,
    sold_by_member_id: draft.soldByMemberId || null,
    marketplace: draft.marketplace.trim() || null,
    notes: draft.notes.trim() || null,
    proceeds,
    allow_oversell: draft.allowOversell,
  }
}

export interface SalePreviewEnvelope {
  input: SalePreviewInput
  result: SalePreview
}

function proceedsLegs(proceeds: SaleProceeds): ProceedsLeg[] {
  if (proceeds.kind === 'account') return proceeds.accountId ? [{ account_id: proceeds.accountId }] : []
  if (proceeds.kind === 'store') return [{ store: proceeds.store.trim() }]
  return []
}

/** A further product in a multi-item sale. The first product stays in the main draft. */
export interface ExtraSaleLine {
  productId: string
  name: string
  quantity: string
  amount: string
  bucket: Bucket
}

export function validateExtraLines(lines: readonly ExtraSaleLine[]): SaleValidation {
  const errors: SaleValidation = {}
  lines.forEach((line, index) => {
    if (saleInteger(line.quantity) === null) errors[`line${index}`] = `${line.name}: enter a whole quantity greater than zero.`
    else if (!saleMoney(line.amount, true)) errors[`line${index}`] = `${line.name}: enter what it sold for.`
  })
  return errors
}

function orderLines(draft: Partial<SaleDraft>, extras: readonly ExtraSaleLine[]): SaleLine[] | null {
  const quantity = saleInteger(draft.quantity ?? '')
  if (!draft.productId || !draft.bucket || quantity === null || !saleMoney(draft.amount ?? '', true)) return null
  if (Object.keys(validateExtraLines(extras)).length > 0) return null
  return [
    { product_id: draft.productId, quantity, amount: draft.amount ?? '', bucket: draft.bucket },
    ...extras.map((line) => ({
      product_id: line.productId,
      quantity: saleInteger(line.quantity) ?? 0,
      amount: line.amount,
      bucket: line.bucket,
    })),
  ]
}

export function orderPreviewInput(draft: Partial<SaleDraft>, extras: readonly ExtraSaleLine[]): SaleOrderPreviewInput | null {
  const lines = orderLines(draft, extras)
  if (!lines || !saleDate(draft.saleDate ?? '')) return null
  return {
    lines,
    platform_fees: draft.platformFees || '0',
    payment_fees: draft.paymentFees || '0',
    shipping_paid: draft.shippingPaid || '0',
    sale_date: draft.saleDate ?? '',
  }
}

export function orderPreviewKey(input: SaleOrderPreviewInput): string {
  return JSON.stringify(input)
}

export function buildSaleOrderPayload(draft: SaleDraft, extras: readonly ExtraSaleLine[]): NewSaleOrder | null {
  if (Object.keys(validateSaleDraft(draft)).length > 0) return null
  const lines = orderLines(draft, extras)
  if (!lines) return null
  return {
    lines,
    platform_fees: draft.platformFees || undefined,
    payment_fees: draft.paymentFees || undefined,
    shipping_paid: draft.shippingPaid || undefined,
    sale_date: draft.saleDate,
    sold_by_member_id: draft.soldByMemberId || null,
    marketplace: draft.marketplace.trim() || null,
    notes: draft.notes.trim() || null,
    proceeds: proceedsLegs(draft.proceeds),
    allow_oversell: draft.allowOversell,
  }
}

export interface SaleOrderPreviewEnvelope {
  input: SaleOrderPreviewInput
  result: SaleOrderPreview
}
