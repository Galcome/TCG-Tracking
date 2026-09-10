import { BUCKETS, type Bucket, type ProductDetail, type RipHit, type Taxonomy } from './api'
import { isIsoDate, isMoneyString } from './product-drafts'

/** The only product types that can represent a manually recorded rip hit. */
export const RIP_HIT_PRODUCT_TYPE_SLUGS = ['raw-single', 'single'] as const

export type RipHitChoice = 'undecided' | 'create' | 'reuse'

/** One row in the manual rip form. `productId` is retained after inline creation. */
export interface RipHitDraft {
  key: number | string
  productId: string
  name: string
  setName: string
  collectorNumber: string
  variant: string
  language: string
  choice: RipHitChoice
  selectedProductName: string
  selectedProductTypeSlug?: string
  quantity: string
  value: string
  bucket: Bucket
}

export interface RipDraft {
  sourceProductId: string
  sourceQuantity: string
  fromBucket: Bucket | ''
  occurredOn: string
  hits: RipHitDraft[]
}

export interface RipValidation {
  sourceProductId?: string
  sourceQuantity?: string
  fromBucket?: string
  occurredOn?: string
  productType?: string
  hits?: string
  [field: string]: string | undefined
}

export interface RipPayload {
  product_id: string
  quantity: number
  from_bucket: Bucket
  hits: RipHit[]
  occurred_on: string
}

export interface RipValidationOptions {
  /** Source stock in the selected bucket, when the product detail is available. */
  available?: number
  /** Required only when an uncreated `create` row remains. */
  productTypes?: readonly Taxonomy[]
}

export function ripInteger(value: string, positive = false): number | null {
  const rendered = value.trim()
  if (!/^\d+$/.test(rendered)) return null
  const parsed = Number(rendered)
  if (!Number.isSafeInteger(parsed) || (positive && parsed < 1)) return null
  return parsed
}

export function ripMoney(value: string, required = false): boolean {
  return isMoneyString(value, required)
}

export function ripDate(value: string): boolean {
  return isIsoDate(value)
}

export function isRipBucket(value: unknown): value is Bucket {
  return typeof value === 'string' && (BUCKETS as readonly string[]).includes(value)
}

/** Keep only rows that contain a hit identity or a retained product id. */
export function filledRipHits(hits: readonly RipHitDraft[]): RipHitDraft[] {
  return hits.filter((hit) => Boolean(hit.name.trim() || hit.productId))
}

/** Identity used to make candidate searches explicit and stale searches harmless. */
export function ripIdentityKey(hit: Pick<RipHitDraft, 'name' | 'setName' | 'collectorNumber' | 'variant' | 'language'>): string {
  return [hit.name, hit.setName, hit.collectorNumber, hit.variant, hit.language]
    .map((value) => value.trim())
    .join('\u001f')
}

export function ripCandidateIdentity(
  hit: Pick<RipHitDraft, 'name' | 'setName' | 'collectorNumber' | 'variant' | 'language'>,
  gameId: string,
) {
  return {
    game_id: gameId,
    name: hit.name.trim(),
    ...(hit.setName.trim() ? { set_name: hit.setName.trim() } : {}),
    ...(hit.collectorNumber.trim() ? { collector_number: hit.collectorNumber.trim() } : {}),
    ...(hit.variant.trim() ? { variant: hit.variant.trim() } : {}),
    ...(hit.language.trim() ? { language: hit.language.trim() } : {}),
  }
}

/**
 * Choose a valid hit taxonomy without relying on seed order. Raw Single is preferred for
 * a newly found card, while Single keeps older installations and older catalogues usable.
 */
export function ripHitProductType(types: readonly Taxonomy[] | undefined): Taxonomy | undefined {
  if (!types?.length) return undefined
  return RIP_HIT_PRODUCT_TYPE_SLUGS
    .map((slug) => types.find((type) => type.slug === slug))
    .find((type): type is Taxonomy => Boolean(type))
}

function hasAllowedHitType(types: readonly Taxonomy[] | undefined): boolean {
  return Boolean(ripHitProductType(types))
}

function isDuplicateProductBucket(
  hits: readonly RipHitDraft[],
): boolean {
  const seen = new Set<string>()
  for (const hit of hits) {
    if (!hit.productId || !isRipBucket(hit.bucket)) continue
    const key = `${hit.productId}\u001f${hit.bucket}`
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

/**
 * Build the confirmation identity for an empty rip. It intentionally contains no money
 * value: the server decides FIFO cost and the complete source write-off.
 */
export function emptyRipConfirmationKey(draft: Pick<RipDraft, 'sourceProductId' | 'sourceQuantity' | 'fromBucket' | 'occurredOn'>): string {
  return [draft.sourceProductId, draft.sourceQuantity.trim(), draft.fromBucket, draft.occurredOn].join('\u001f')
}

/** A stable key for tests and for guarding stale empty-writeoff confirmations. */
export function ripDraftKey(draft: RipDraft): string {
  return [
    emptyRipConfirmationKey(draft),
    ...filledRipHits(draft.hits).map((hit) => [
      hit.key,
      hit.productId,
      hit.choice,
      hit.bucket,
      hit.quantity,
      ripIdentityKey(hit),
      hit.value,
    ].join('\u001e')),
  ].join('\u001d')
}

export function validateRipDraft(
  draft: Partial<RipDraft>,
  product?: Pick<ProductDetail, 'id' | 'stats'>,
  options: RipValidationOptions = {},
): RipValidation {
  const errors: RipValidation = {}
  const quantity = ripInteger(draft.sourceQuantity ?? '', true)
  if (quantity === null || quantity > 1_000) {
    errors.sourceQuantity = 'Enter a whole number from 1 to 1,000.'
  }
  if (!draft.sourceProductId) errors.sourceProductId = 'Choose a source product.'
  if (!isRipBucket(draft.fromBucket)) errors.fromBucket = 'Choose where the source stock is held.'
  if (!draft.occurredOn || !ripDate(draft.occurredOn)) {
    errors.occurredOn = 'Enter a date in YYYY-MM-DD format.'
  }

  if (product && draft.sourceProductId && draft.sourceProductId !== product.id) {
    errors.sourceProductId = 'The source product does not match this form.'
  }
  if (product && isRipBucket(draft.fromBucket) && quantity !== null) {
    const available = product.stats.by_bucket[draft.fromBucket] ?? 0
    if (quantity > available) errors.sourceQuantity = `${draft.fromBucket} only holds ${available}.`
  } else if (options.available !== undefined && quantity !== null && quantity > options.available) {
    errors.sourceQuantity = `The selected bucket only holds ${options.available}.`
  }

  const hits = filledRipHits(draft.hits ?? [])
  let needsNewProductType = false
  for (const [index, hit] of hits.entries()) {
    const label = `hit${index}`
    if (!hit.name.trim()) errors[`${label}.name`] = 'Give this hit a name.'
    const quantity = ripInteger(hit.quantity ?? '1', true)
    if (quantity === null || quantity > 10_000) {
      errors[`${label}.quantity`] = 'Enter a whole number from 1 to 10,000.'
    }
    if (!ripMoney(hit.value ?? '')) errors[`${label}.value`] = 'Use digits with up to two decimal places.'
    if (!isRipBucket(hit.bucket)) errors[`${label}.bucket`] = 'Choose where this hit goes.'
    if (hit.choice !== 'create' && hit.choice !== 'reuse') {
      errors[`${label}.choice`] = 'Choose Reuse or Create new product for every hit.'
    } else if (hit.choice === 'reuse' && !hit.productId) {
      errors[`${label}.productId`] = 'Choose an existing product before saving.'
    } else if (hit.choice === 'reuse' && hit.selectedProductTypeSlug && !RIP_HIT_PRODUCT_TYPE_SLUGS.includes(hit.selectedProductTypeSlug as (typeof RIP_HIT_PRODUCT_TYPE_SLUGS)[number])) {
      errors[`${label}.productId`] = 'Only Single or Raw Single products can be rip hits.'
    }
    if (hit.choice === 'create' && !hit.productId) needsNewProductType = true
    if (hit.productId === draft.sourceProductId) {
      errors[`${label}.productId`] = 'A source product cannot also be a hit.'
    }
  }
  if (isDuplicateProductBucket(hits)) {
    errors.hits = 'Use each product only once per destination bucket; duplicate hit rows are not merged.'
  }
  if (needsNewProductType && !hasAllowedHitType(options.productTypes)) {
    errors.productType = 'Single or Raw Single product types are unavailable; cannot create a hit.'
  }
  return errors
}

/**
 * Build exactly the server-facing rip request. No cost, share, or other financial value is
 * calculated here; `value` remains a decimal string estimate and FIFO stays server-owned.
 */
export function buildRipPayload(
  draft: RipDraft,
  product?: Pick<ProductDetail, 'id' | 'stats'>,
  options: RipValidationOptions = {},
): RipPayload | null {
  if (Object.keys(validateRipDraft(draft, product, options)).length > 0) return null
  const quantity = ripInteger(draft.sourceQuantity, true)
  if (quantity === null || !isRipBucket(draft.fromBucket)) return null

  const hits: RipHit[] = []
  for (const hit of filledRipHits(draft.hits)) {
    if (!hit.productId) return null
    const quantity = ripInteger(hit.quantity ?? '1', true)
    if (quantity === null || quantity > 10_000) return null
    hits.push({
      product_id: hit.productId,
      quantity,
      bucket: hit.bucket,
      value: hit.value || '0',
    })
  }
  return {
    product_id: draft.sourceProductId,
    quantity,
    from_bucket: draft.fromBucket,
    hits,
    occurred_on: draft.occurredOn,
  }
}

export function firstRipValidationError(errors: RipValidation): string | null {
  const first = Object.values(errors).find((message): message is string => Boolean(message))
  return first ?? null
}
