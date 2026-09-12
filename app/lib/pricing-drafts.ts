import type {
  CatalogMapping,
  CatalogMappingDraft,
  Product,
  PricingRefresh,
} from './api'

export const FREE_MARKET_PRICING_TYPES = [
  'single',
  'raw-single',
  'booster-box',
  'sealed-case',
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
  return 'Market pricing supports raw cards, booster boxes, and sealed cases only.'
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
