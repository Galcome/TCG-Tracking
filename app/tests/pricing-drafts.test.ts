import test from 'node:test'
import assert from 'node:assert/strict'

import type { CatalogMapping, Product, PricingRefresh } from '../lib/api.ts'
import {
  canUseFreeMarketPricing,
  catalogId,
  pricingEligibilityMessage,
  pricingMappingDraft,
  pricingRefreshSummary,
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
  assert.equal(pricingEligibilityMessage(product({ product_type: { id: 'type', name: 'Pack', slug: 'booster-pack', is_system: true, sort_order: 0 } })), 'Market pricing supports raw cards, booster boxes, and sealed cases only.')
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
