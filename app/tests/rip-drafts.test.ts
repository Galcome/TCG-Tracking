import assert from 'node:assert/strict'
import test from 'node:test'

import type { ProductDetail, Taxonomy } from '../lib/api'
import {
  buildRipPayload,
  buildRipPreviewPayload,
  emptyRipConfirmationKey,
  firstRipValidationError,
  isRipPreviewCurrent,
  ripCandidateIdentity,
  ripDate,
  ripHitProductType,
  ripIdentityKey,
  ripInteger,
  ripMoney,
  ripPreviewKey,
  validateRipPreviewDraft,
  validateRipDraft,
  type RipDraft,
  type RipHitDraft,
} from '../lib/rip-drafts'

const product = {
  id: 'box-1',
  stats: {
    by_bucket: { inventory: 2, store: 0, vault: 0 },
  },
} as ProductDetail

const rawSingle: Taxonomy = {
  id: 'raw-single-type',
  name: 'Raw Single',
  slug: 'raw-single',
  is_system: true,
  sort_order: 1,
}

function hit(overrides: Partial<RipHitDraft> = {}): RipHitDraft {
  return {
    key: 1,
    productId: 'card-1',
    name: 'Pikachu',
    setName: 'Base Set',
    collectorNumber: '4/102',
    variant: 'Holo',
    language: 'English',
    choice: 'reuse',
    selectedProductName: 'Pikachu',
    selectedProductTypeSlug: 'raw-single',
    quantity: '1',
    value: '12.50',
    bucket: 'inventory',
    ...overrides,
  }
}

function draft(overrides: Partial<RipDraft> = {}): RipDraft {
  return {
    sourceProductId: 'box-1',
    sourceQuantity: '1',
    fromBucket: 'inventory',
    occurredOn: '2026-09-09',
    hits: [hit()],
    ...overrides,
  }
}

test('rip quantities, dates and estimates stay strict and platform-neutral', () => {
  assert.equal(ripInteger(' 12 ', true), 12)
  assert.equal(ripInteger('0', true), null)
  assert.equal(ripInteger('1.5', true), null)
  assert.equal(ripInteger('9007199254740992', true), null)
  assert.equal(ripMoney('12.50'), true)
  assert.equal(ripMoney('12.500'), false)
  assert.equal(ripMoney('-1.00'), false)
  assert.equal(ripMoney('', false), true)
  assert.equal(ripDate('2024-02-29'), true)
  assert.equal(ripDate('2026-02-29'), false)
})

test('candidate identity is explicit, trimmed, and keyed by all editable identity fields', () => {
  const row = hit({
    name: '  Pikachu  ',
    setName: ' Base Set ',
    collectorNumber: ' 4/102 ',
    variant: '',
    language: ' English ',
  })
  assert.deepEqual(ripCandidateIdentity(row, 'pokemon'), {
    game_id: 'pokemon',
    name: 'Pikachu',
    set_name: 'Base Set',
    collector_number: '4/102',
    language: 'English',
  })
  assert.notEqual(ripIdentityKey(row), ripIdentityKey({ ...row, variant: 'Reverse holo' }))
})

test('new hit taxonomy is chosen by allowed slug, never by array position', () => {
  assert.equal(ripHitProductType([{ ...rawSingle, id: 'first' }])?.slug, 'raw-single')
  assert.equal(ripHitProductType([
    { ...rawSingle, id: 'sealed', name: 'Sealed Case', slug: 'sealed-case' },
    { ...rawSingle, id: 'single', name: 'Single', slug: 'single' },
  ])?.slug, 'single')
  assert.equal(ripHitProductType([{ ...rawSingle, id: 'box', name: 'Booster Box', slug: 'booster-box' }]), undefined)
})

test('validation covers source availability, explicit identity decisions, money, and duplicates before writes', () => {
  const invalid = draft({
    sourceQuantity: '3',
    hits: [
      hit({ value: '12.345' }),
      hit({ key: 2, productId: 'card-1', choice: 'reuse' }),
    ],
  })
  const errors = validateRipDraft(invalid, product, { productTypes: [rawSingle] })
  assert.equal(errors.sourceQuantity, 'inventory only holds 2.')
  assert.equal(errors['hit0.value'], 'Use digits with up to two decimal places.')
  assert.equal(errors.hits, 'Use each product only once per destination bucket; duplicate hit rows are not merged.')
  assert.equal(firstRipValidationError(errors), errors.sourceQuantity)

  const needsChoice = validateRipDraft(draft({ hits: [hit({ choice: 'undecided' })] }), product, { productTypes: [rawSingle] })
  assert.equal(needsChoice['hit0.choice'], 'Choose Reuse or Create new product for every hit.')

  const invalidHitQuantity = validateRipDraft(draft({ hits: [hit({ quantity: '1.5' })] }), product)
  assert.equal(invalidHitQuantity['hit0.quantity'], 'Enter a whole number from 1 to 10,000.')
})

test('new hit creation requires single/raw-single taxonomy and never falls back to another type', () => {
  const noType = validateRipDraft(draft({ hits: [hit({ productId: '', choice: 'create' })] }), product, {
    productTypes: [{ ...rawSingle, id: 'sealed', name: 'Booster Box', slug: 'booster-box' }],
  })
  assert.equal(noType.productType, 'Single or Raw Single product types are unavailable; cannot create a hit.')

  const allowed = validateRipDraft(draft({ hits: [hit({ productId: '', choice: 'create' })] }), product, {
    productTypes: [rawSingle],
  })
  assert.equal(allowed.productType, undefined)
})

test('payload preserves decimal strings and sends no client cost calculation', () => {
  const payload = buildRipPayload(draft({
    sourceQuantity: '01',
    hits: [hit({ quantity: '2', value: '0012.50' })],
  }), product)
  assert.deepEqual(payload, {
    product_id: 'box-1',
    quantity: 1,
    from_bucket: 'inventory',
    hits: [{ product_id: 'card-1', quantity: 2, bucket: 'inventory', value: '0012.50' }],
    occurred_on: '2026-09-09',
  })
  assert.equal(payload && 'cost' in payload, false)
  assert.equal(payload && 'bulk_cost' in payload, false)

  const blankValue = buildRipPayload(draft({ hits: [hit({ value: '' })] }), product)
  assert.equal(blankValue?.hits[0]?.value, '0')

  const explicitCost = buildRipPayload(draft({ hits: [hit({ cost: '0.00' })] }), product)
  assert.equal(explicitCost?.hits[0]?.cost, '0.00')
})

test('preview payload allows unresolved identities and omits blank cost overrides', () => {
  const unresolved = buildRipPreviewPayload(draft({ hits: [hit({
    productId: '',
    choice: 'create',
    selectedProductName: '',
    name: 'Unresolved hit',
    value: '0012.50',
    cost: '',
  })] }))
  assert.deepEqual(unresolved, {
    product_id: 'box-1',
    quantity: 1,
    from_bucket: 'inventory',
    occurred_on: '2026-09-09',
    hits: [{ key: '1', quantity: 1, value: '0012.50' }],
  })

  const knownZero = buildRipPreviewPayload(draft({ hits: [hit({ cost: '0.00', value: '0.00' })] }))
  assert.deepEqual(knownZero?.hits[0], { key: '1', quantity: 1, value: '0.00', cost: '0.00' })
})

test('preview validation checks money and quantities but not identity decisions', () => {
  const unresolved = draft({ hits: [hit({
    productId: '',
    choice: 'undecided',
    selectedProductName: '',
    name: 'Unresolved hit',
    quantity: '0',
    value: '12.345',
    cost: '-1.00',
  })] })
  const errors = validateRipPreviewDraft(unresolved)
  assert.equal(errors['hit0.quantity'], 'Enter a whole number from 1 to 10,000.')
  assert.equal(errors['hit0.value'], 'Use digits with up to two decimal places.')
  assert.equal(errors['hit0.cost'], 'Use digits with up to two decimal places.')
  assert.equal(errors['hit0.choice'], undefined)
  assert.equal(errors['hit0.productId'], undefined)

  const valid = validateRipPreviewDraft(draft({ hits: [hit({
    productId: '',
    choice: 'create',
    selectedProductName: '',
    name: 'Unresolved hit',
    quantity: '1',
    value: '0',
    cost: '0',
  })] }))
  assert.deepEqual(valid, {})
})

test('preview identity includes every request field and guards stale responses', () => {
  const input = buildRipPreviewPayload(draft())!
  const changed = buildRipPreviewPayload(draft({ hits: [hit({ value: '13.50' })] }))!
  assert.notEqual(ripPreviewKey(input), ripPreviewKey(changed))
  assert.equal(isRipPreviewCurrent(input, input), true)
  assert.equal(isRipPreviewCurrent(input, changed), false)
})

test('empty rip confirmation changes when source facts change and carries no money', () => {
  const empty = draft({ hits: [] })
  const original = emptyRipConfirmationKey(empty)
  assert.notEqual(original, emptyRipConfirmationKey({ ...empty, sourceQuantity: '2' }))
  assert.notEqual(original, emptyRipConfirmationKey({ ...empty, fromBucket: 'store' }))
  assert.equal(original.includes('cost'), false)
  assert.equal(buildRipPayload(empty, product)?.hits.length, 0)
})
