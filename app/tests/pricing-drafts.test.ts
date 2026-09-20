import test from 'node:test'
import assert from 'node:assert/strict'

import type {
  CatalogMapping,
  Product,
  PricingRefresh,
  PricingSuggestion,
  TCGCSVProduct,
} from '../lib/api.ts'
import {
  canUseFreeMarketPricing,
  catalogId,
  isCertainSuggestion,
  marketPosition,
  needsPricingSetup,
  preferredSubtype,
  pricingEligibilityMessage,
  pricingMappingDraft,
  pricingRefreshSummary,
  pricingSetupSummary,
  validatePricingMappingDraft,
} from '../lib/pricing-drafts.ts'

function product(overrides: Partial<Product>): Product {
  return {
    id: 'product',
    name: 'Product',
    game: { id: 'game', name: 'Game', slug: 'game', is_system: true, sort_order: 0 },
    product_type: { id: 'type', name: 'Single', slug: 'single', is_system: true, sort_order: 0 },
    set_name: null,
    collector_number: null,
    variant: null,
    language: null,
    condition: null,
    grading_company: null,
    grade: null,
    cert_number: null,
    external_ref: null,
    storage_location: null,
    notes: null,
    is_archived: false,
    created_at: '2026-09-12T00:00:00Z',
    stats: {
      quantity_purchased: 0,
      quantity_sold: 0,
      quantity_adjusted: 0,
      quantity_on_hand: 0,
      total_invested: '0.00',
      remaining_cost: '0.00',
      cost_of_sales: '0.00',
      cost_written_off: '0.00',
      gross_revenue: '0.00',
      net_proceeds: '0.00',
      realized_profit: '0.00',
      average_unit_cost: null,
      roi: null,
      sale_count: 0,
      sales_missing_cost: 0,
      by_bucket: { inventory: 0, store: 0, vault: 0 },
    },
    market_estimate: null,
    ...overrides,
  }
}

function mapping(overrides: Partial<CatalogMapping>): CatalogMapping {
  return {
    id: 'mapping',
    product_id: 'product',
    provider: 'tcgcsv',
    external_product_id: '123',
    external_group_id: '456',
    external_category_id: '789',
    subtype_name: 'Normal',
    condition: null,
    language: null,
    match_status: 'confirmed',
    notes: null,
    created_by_member_id: null,
    created_at: '2026-09-12T00:00:00Z',
    updated_at: '2026-09-12T00:00:00Z',
    ...overrides,
  }
}

test('pricing eligibility allows only ungraded supported product types', () => {
  assert.equal(canUseFreeMarketPricing(product({})), true)
  assert.equal(canUseFreeMarketPricing(product({ product_type: { id: 'type', name: 'Case', slug: 'sealed-case', is_system: true, sort_order: 0 } })), true)
  assert.equal(canUseFreeMarketPricing(product({ product_type: { id: 'type', name: 'Slab', slug: 'graded-card', is_system: true, sort_order: 0 } })), false)
  assert.equal(canUseFreeMarketPricing(product({ grading_company: 'PSA' })), false)
  assert.equal(canUseFreeMarketPricing(product({ condition: 'Near Mint' })), true)
  assert.equal(pricingEligibilityMessage(product({ grading_company: 'PSA' })), 'Market pricing is manual for graded products.')
  for (const slug of ['booster-pack', 'box-set', 'collection', 'deck']) {
    assert.equal(canUseFreeMarketPricing(product({ product_type: { id: 'type', name: slug, slug, is_system: true, sort_order: 0 } })), true, slug)
  }
  assert.equal(pricingEligibilityMessage(product({ product_type: { id: 'type', name: 'Lot', slug: 'lot', is_system: true, sort_order: 0 } })), 'Market pricing supports raw cards and sealed products only.')
})

test('market position is exact cents of the stock on hand against its remaining cost', () => {
  const estimate = (value: string | null, status: 'fresh' | 'stale' | 'unavailable' = 'fresh') => ({
    value, status, captured_on: '2026-09-19', provider: 'tcgcsv', source_revision: null,
  })
  const holding = (quantity: number, remaining: string, value: string | null, status?: 'fresh' | 'stale' | 'unavailable') => {
    const base = product({})
    return { stats: { ...base.stats, quantity_on_hand: quantity, remaining_cost: remaining }, market_estimate: estimate(value, status) }
  }
  assert.deepEqual(marketPosition(holding(36, '100.00', '4.99')), { value: '179.64', unrealized: '79.64' })
  assert.deepEqual(marketPosition(holding(2, '310.50', '150.1', 'stale')), { value: '300.20', unrealized: '-10.30' })
  assert.deepEqual(marketPosition(holding(1, '0.95', '0.90')), { value: '0.90', unrealized: '-0.05' })
  assert.equal(marketPosition(holding(0, '0.00', '4.99')), null)
  assert.equal(marketPosition(holding(3, '9.00', null)), null)
  assert.equal(marketPosition(holding(3, '9.00', '4.99', 'unavailable')), null)
  assert.equal(marketPosition(holding(3, 'n/a', '4.99')), null)
  assert.equal(marketPosition({ ...holding(3, '9.00', null), market_estimate: null }), null)
})

test('the preferred printing is the product variant, then Normal, then the first listed', () => {
  assert.equal(preferredSubtype(['Holofoil', 'Normal', 'Reverse Holofoil'], ' reverse holofoil '), 'Reverse Holofoil')
  assert.equal(preferredSubtype(['Holofoil', 'Normal'], 'Special Illustration Rare'), 'Normal')
  assert.equal(preferredSubtype(['Holofoil', 'Reverse Holofoil'], null), 'Holofoil')
  assert.equal(preferredSubtype([], undefined), 'Normal')
})

test('mapping drafts retain exact IDs while catalog query IDs are safe positive numbers', () => {
  assert.deepEqual(pricingMappingDraft(null), {
    external_product_id: '', external_group_id: '', external_category_id: '', subtype_name: 'Normal',
  })
  assert.deepEqual(pricingMappingDraft(mapping({ external_product_id: '000123', subtype_name: 'Holofoil' })), {
    external_product_id: '000123', external_group_id: '456', external_category_id: '789', subtype_name: 'Holofoil',
  })
  assert.equal(catalogId(' 789 '), 789)
  assert.equal(catalogId('0'), null)
  assert.equal(catalogId('7.5'), null)
  assert.equal(catalogId('999999999999999999999999'), null)
})

test('mapping validation requires numeric provider locators and a printing subtype', () => {
  const draft = { external_product_id: '123', external_group_id: '456', external_category_id: '789', subtype_name: 'Normal' }
  assert.equal(validatePricingMappingDraft(draft), null)
  assert.equal(validatePricingMappingDraft({ ...draft, external_product_id: 'abc' }), 'Product ID must be numeric.')
  assert.equal(validatePricingMappingDraft({ ...draft, external_category_id: '' }), 'Category ID is required.')
  assert.equal(validatePricingMappingDraft({ ...draft, external_group_id: 'x' }), 'Group ID must be numeric.')
  assert.equal(validatePricingMappingDraft({ ...draft, subtype_name: ' ' }), 'Subtype / printing is required.')
})

test('refresh summary states every source outcome and provider errors', () => {
  const result: PricingRefresh = {
    attempted: 3,
    refreshed: 1,
    skipped: 1,
    stale: 0,
    unavailable: 1,
    source_revision: 'revision',
    errors: ['One mapping unavailable.'],
  }
  assert.equal(
    pricingRefreshSummary(result),
    'Checked 3: 1 refreshed, 1 skipped, 0 stale, 1 unavailable. One mapping unavailable.',
  )
})

function listing(productId: number, number: string | null = null): TCGCSVProduct {
  return {
    product_id: productId,
    category_id: 3,
    group_id: 23651,
    name: 'Surging Sparks Booster Box',
    clean_name: null,
    image_url: null,
    url: null,
    subtypes: ['Normal'],
    number,
  }
}

function suggestion(overrides: Partial<PricingSuggestion>): PricingSuggestion {
  return {
    candidates: [listing(1)],
    suggested_index: 0,
    method: 'exact',
    message: null,
    ...overrides,
  }
}

test('only one exact listing with nothing to choose between is certain', () => {
  assert.equal(isCertainSuggestion(suggestion({})), true)
  assert.equal(isCertainSuggestion(undefined), false)
  // A model's pick is a judgement, so a person still confirms it.
  assert.equal(isCertainSuggestion(suggestion({ method: 'ai' })), false)
  // Two exact listings means the name alone did not settle it.
  assert.equal(
    isCertainSuggestion(suggestion({ candidates: [listing(1), listing(2)] })),
    false,
  )
  assert.equal(isCertainSuggestion(suggestion({ suggested_index: null })), false)
  assert.equal(isCertainSuggestion(suggestion({ candidates: [], suggested_index: null })), false)
})

test('set-up queue is stock that can be priced and has no listing yet', () => {
  const box = { id: 'type', name: 'Box', slug: 'booster-box', is_system: true, sort_order: 0 }
  const lot = { id: 'type', name: 'Lot', slug: 'lot', is_system: true, sort_order: 0 }
  const products = [
    product({ id: 'unmapped', product_type: box }),
    product({ id: 'mapped', product_type: box }),
    product({ id: 'ineligible', product_type: lot }),
  ]
  const mapping = { ...pricingMappingDraft(null), product_id: 'mapped' } as unknown as CatalogMapping

  assert.deepEqual(
    needsPricingSetup(products, [mapping]).map((item) => item.id),
    ['unmapped'],
  )
})

test('the set-up summary counts only what actually happened', () => {
  assert.equal(pricingSetupSummary([]), 'Nothing to price.')
  assert.equal(pricingSetupSummary(['matched', 'chosen']), 'Priced 2 of 2.')
  assert.equal(
    pricingSetupSummary(['matched', 'skipped', 'none', 'failed']),
    'Priced 1 of 4 · 1 skipped · 1 with no listing · 1 failed.',
  )
})
