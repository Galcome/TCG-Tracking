import type {
  CatalogMapping,
  CatalogMappingDraft,
  Product,
  PricingRefresh,
  PricingSuggestion,
} from './api'
import { decimalCents } from './money-drafts'

/** Mirrors the server: every factory-sealed product has one listing and market price. */
export const FREE_MARKET_PRICING_TYPES = [
  'single',
  'raw-single',
  'booster-pack',
  'booster-box',
  'sealed-case',
  'box-set',
  'collection',
  'deck',
] as const

export const EMPTY_PRICING_MAPPING: CatalogMappingDraft = {
  external_product_id: '',
  external_group_id: '',
  external_category_id: '',
  subtype_name: 'Normal',
}

type PricingIdentity = Pick<
  Product,
  'product_type' | 'grading_company' | 'grade' | 'cert_number'
>

/** Match the server's independent eligibility guard before exposing provider controls. */
export function canUseFreeMarketPricing(product: PricingIdentity): boolean {
  if (!FREE_MARKET_PRICING_TYPES.includes(product.product_type.slug as (typeof FREE_MARKET_PRICING_TYPES)[number])) {
    return false
  }
  return ![product.grading_company, product.grade, product.cert_number]
    .some((value) => Boolean(value?.trim()))
}

export function pricingEligibilityMessage(product: PricingIdentity): string {
  if (
    product.product_type.slug === 'graded-card' ||
    [product.grading_company, product.grade, product.cert_number].some((value) => Boolean(value?.trim()))
  ) {
    return 'Market pricing is manual for graded products.'
  }
  return 'Market pricing supports raw cards and sealed products only.'
}

export function pricingMappingDraft(mapping: CatalogMapping | null | undefined): CatalogMappingDraft {
  if (!mapping) return { ...EMPTY_PRICING_MAPPING }
  return {
    external_product_id: mapping.external_product_id,
    external_group_id: mapping.external_group_id ?? '',
    external_category_id: mapping.external_category_id ?? '',
    subtype_name: mapping.subtype_name,
  }
}

/** Parse provider locator IDs for catalog queries without changing the exact wire strings. */
export function catalogId(value: string | null | undefined): number | null {
  const text = value?.trim() ?? ''
  if (!/^\d+$/.test(text)) return null
  const parsed = Number(text)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

/** Mirror the backend's required TCGCSV mapping fields before a write is attempted. */
export function validatePricingMappingDraft(draft: CatalogMappingDraft): string | null {
  if (!draft.external_product_id.trim()) return 'Product ID is required.'
  if (!/^\d+$/.test(draft.external_product_id.trim())) return 'Product ID must be numeric.'
  if (!draft.external_category_id?.trim()) return 'Category ID is required.'
  if (!/^\d+$/.test(draft.external_category_id.trim())) return 'Category ID must be numeric.'
  if (!draft.external_group_id?.trim()) return 'Group ID is required.'
  if (!/^\d+$/.test(draft.external_group_id.trim())) return 'Group ID must be numeric.'
  if (!draft.subtype_name.trim()) return 'Subtype / printing is required.'
  return null
}

export function pricingRefreshSummary(result: PricingRefresh): string {
  const summary = `Checked ${result.attempted}: ${result.refreshed} refreshed, ${result.skipped} skipped, ${result.stale} stale, ${result.unavailable} unavailable.`
  return result.errors.length > 0 ? `${summary} ${result.errors.join(' ')}` : summary
}

function centsString(cents: bigint): string {
  const sign = cents < 0n ? '-' : ''
  const abs = cents < 0n ? -cents : cents
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`
}

/**
 * What the stock on hand is worth at today's estimate and how far that is from its cost.
 * Exact cents throughout, so a 36-pack box never drifts a cent from the ledger. Null when
 * there is nothing on hand or no usable estimate - the card then offers to set one up.
 */
export function marketPosition(
  product: Pick<Product, 'stats' | 'market_estimate'>,
): { value: string; unrealized: string } | null {
  const estimate = product.market_estimate
  const quantity = product.stats.quantity_on_hand
  if (!estimate?.value || estimate.status === 'unavailable' || quantity <= 0) return null
  const unit = decimalCents(estimate.value)
  const cost = decimalCents(product.stats.remaining_cost)
  if (unit === null || cost === null) return null
  const value = unit * BigInt(quantity)
  return { value: centsString(value), unrealized: centsString(value - cost) }
}

/** The printing a listing is most likely held in: the product's own variant, else Normal. */
export function preferredSubtype(subtypes: string[], variant: string | null | undefined): string {
  const wanted = variant?.trim().toLocaleLowerCase()
  return subtypes.find((subtype) => subtype.toLocaleLowerCase() === wanted)
    ?? subtypes.find((subtype) => subtype === 'Normal')
    ?? subtypes[0]
    ?? 'Normal'
}

/**
 * Whether the suggestion is the one listing this can be, with nothing to choose between.
 * Code only claims this when the catalog name matches and, for a card, the number does
 * too - so confirming it adds no information a person could.
 */
export function isCertainSuggestion(
  suggestion: PricingSuggestion | undefined,
): boolean {
  return Boolean(
    suggestion &&
      suggestion.method === 'exact' &&
      suggestion.suggested_index === 0 &&
      suggestion.candidates.length === 1,
  )
}

/** Stock that could carry a market value but has no catalog mapping yet. */
export function needsPricingSetup(
  products: Product[],
  mappings: CatalogMapping[],
): Product[] {
  const mapped = new Set(mappings.map((mapping) => mapping.product_id))
  return products.filter(
    (product) => canUseFreeMarketPricing(product) && !mapped.has(product.id),
  )
}

export type PricingSetupOutcome = 'matched' | 'chosen' | 'skipped' | 'none' | 'failed'

/** Plain English for what a run of the set-up walk actually did. */
export function pricingSetupSummary(outcomes: PricingSetupOutcome[]): string {
  if (outcomes.length === 0) return 'Nothing to price.'
  const count = (outcome: PricingSetupOutcome) =>
    outcomes.filter((value) => value === outcome).length
  const priced = count('matched') + count('chosen')
  const parts = [`Priced ${priced} of ${outcomes.length}`]
  if (count('skipped') > 0) parts.push(`${count('skipped')} skipped`)
  if (count('none') > 0) parts.push(`${count('none')} with no listing`)
  if (count('failed') > 0) parts.push(`${count('failed')} failed`)
  return `${parts.join(' · ')}.`
}
