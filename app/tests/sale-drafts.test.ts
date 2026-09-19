import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildSaleOrderPayload,
  buildSalePayload,
  orderPreviewInput,
  orderPreviewKey,
  validateExtraLines,
  type ExtraSaleLine,
  isPreviewCurrent,
  previewInput,
  resolveSaleProceeds,
  saleDate,
  saleInteger,
  saleMoney,
  salePreviewKey,
  validateSaleDraft,
  type SaleDraft,
} from '../lib/sale-drafts'

function draft(overrides: Partial<SaleDraft> = {}): SaleDraft {
  return {
    productId: 'product-1',
    quantity: '2',
    amount: '150.00',
    platformFees: '19.88',
    paymentFees: '',
    shippingPaid: '0.00',
    saleDate: '2026-09-08',
    bucket: 'inventory',
    soldByMemberId: '',
    marketplace: 'eBay',
    notes: '',
    allowOversell: false,
    proceeds: { kind: 'account', accountId: 'account-1' },
    ...overrides,
  }
}

test('sale draft quantities and money reject fractional or negative values', () => {
  assert.equal(saleInteger('2'), 2)
  assert.equal(saleInteger('2.5'), null)
  assert.equal(saleInteger('-1'), null)
  assert.equal(saleInteger('9007199254740992'), null)
  assert.equal(saleMoney('150.00', true), true)
  assert.equal(saleMoney('150.000', true), false)
  assert.equal(saleMoney('-1.00', true), false)
})

test('sale dates reuse calendar-aware ISO validation', () => {
  assert.equal(saleDate('2026-09-08'), true)
  assert.equal(saleDate('2026-02-30'), false)
  assert.equal(previewInput(draft({ saleDate: '2026-02-30' })), null)
})

test('preview input carries money strings verbatim and uses server zero defaults', () => {
  const input = previewInput(draft({ amount: '00150.00', platformFees: '', paymentFees: '2.5' }))
  assert.deepEqual(input, {
    product_id: 'product-1',
    quantity: 2,
    amount: '00150.00',
    platform_fees: '0',
    payment_fees: '2.5',
    shipping_paid: '0.00',
    sale_date: '2026-09-08',
  })
})

test('preview identity rejects a response after any sale input changes', () => {
  const original = previewInput(draft())!
  const changed = previewInput(draft({ amount: '151.00' }))!
  assert.equal(isPreviewCurrent(original, original), true)
  assert.equal(isPreviewCurrent(original, changed), false)
  assert.notEqual(salePreviewKey(original), salePreviewKey(changed))
})

test('store-credit proceeds require a shop name, while an explicit no-account destination is valid', () => {
  assert.equal(validateSaleDraft(draft({ proceeds: { kind: 'store', store: '  ' } })).proceeds, 'Enter the store that holds the credit.')
  assert.equal(validateSaleDraft(draft({ proceeds: { kind: 'none' } })).proceeds, undefined)
})

test('untouched proceeds follow the selected seller account, while explicit destinations stay fixed', () => {
  const accounts = [
    { id: 'alice-account', member_id: 'alice' },
    { id: 'bob-account', member_id: 'bob' },
  ]
  const untouched = { kind: 'account' as const, accountId: '' }
  assert.deepEqual(resolveSaleProceeds(untouched, null, 'bob', 'alice', accounts), {
    kind: 'account',
    accountId: 'bob-account',
  })
  assert.deepEqual(resolveSaleProceeds(untouched, null, '', 'alice', accounts), {
    kind: 'account',
    accountId: 'alice-account',
  })
  assert.deepEqual(resolveSaleProceeds({ kind: 'account', accountId: 'alice-account' }, 'alice-account', 'bob', 'alice', accounts), {
    kind: 'account',
    accountId: 'alice-account',
  })
  assert.deepEqual(resolveSaleProceeds({ kind: 'store', store: 'Card Shop' }, '', 'bob', 'alice', accounts), {
    kind: 'store',
    store: 'Card Shop',
  })
  assert.deepEqual(resolveSaleProceeds({ kind: 'none' }, '', 'bob', 'alice', accounts), { kind: 'none' })
})

test('sale payload preserves exact money strings and encodes store credit separately', () => {
  const payload = buildSalePayload(draft({
    quantity: '03',
    amount: '00150.00',
    platformFees: '',
    paymentFees: '2.50',
    shippingPaid: '0.00',
    soldByMemberId: 'member-1',
    proceeds: { kind: 'store', store: ' Card Shop ' },
  }))
  assert.deepEqual(payload, {
    product_id: 'product-1',
    quantity: 3,
    amount: '00150.00',
    bucket: 'inventory',
    platform_fees: undefined,
    payment_fees: '2.50',
    shipping_paid: '0.00',
    sale_date: '2026-09-08',
    sold_by_member_id: 'member-1',
    marketplace: 'eBay',
    notes: null,
    proceeds: [{ store: 'Card Shop' }],
    allow_oversell: false,
  })
})

const extra: ExtraSaleLine = { productId: 'product-2', name: 'Charizard', quantity: '1', amount: '48.50', bucket: 'vault' }

test('an order keeps the first product as line one and each extra line verbatim', () => {
  const payload = buildSaleOrderPayload(draft({ notes: '  table 12 ', proceeds: { kind: 'store', store: ' Shop ' } }), [extra])
  assert.deepEqual(payload?.lines, [
    { product_id: 'product-1', quantity: 2, amount: '150.00', bucket: 'inventory' },
    { product_id: 'product-2', quantity: 1, amount: '48.50', bucket: 'vault' },
  ])
  assert.equal(payload?.platform_fees, '19.88')
  assert.equal(payload?.payment_fees, undefined)
  assert.equal(payload?.notes, 'table 12')
  assert.deepEqual(payload?.proceeds, [{ store: 'Shop' }])
  assert.deepEqual(buildSaleOrderPayload(draft({ proceeds: { kind: 'none' } }), [extra])?.proceeds, [])
})

test('an order with a bad line builds nothing and names the line', () => {
  const bad = { ...extra, amount: '' }
  assert.equal(buildSaleOrderPayload(draft(), [bad]), null)
  assert.equal(buildSaleOrderPayload(draft({ amount: '' }), [extra]), null)
  assert.match(validateExtraLines([bad]).line0 ?? '', /Charizard: enter what it sold for/)
  assert.match(validateExtraLines([{ ...extra, quantity: '0' }]).line0 ?? '', /whole quantity/)
  assert.deepEqual(validateExtraLines([extra]), {})
})

test('order preview input sends zero fee defaults and changes identity with any line', () => {
  const input = orderPreviewInput(draft({ platformFees: '' }), [extra])
  assert.equal(input?.platform_fees, '0')
  assert.equal(input?.lines.length, 2)
  assert.equal(orderPreviewInput(draft({ saleDate: 'soon' }), [extra]), null)
  assert.equal(orderPreviewInput(draft(), [{ ...extra, quantity: 'x' }]), null)
  const changed = orderPreviewInput(draft({ platformFees: '' }), [{ ...extra, amount: '48.51' }])
  assert.notEqual(orderPreviewKey(input!), orderPreviewKey(changed!))
})
