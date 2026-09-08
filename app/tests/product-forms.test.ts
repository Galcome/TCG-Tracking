import assert from 'node:assert/strict'
import test from 'node:test'

import {
  firstValidationError,
  isIsoDate,
  isMoneyString,
  parseIntegerQuantity,
  validateDraft,
} from '../lib/product-drafts'
import type { Transaction } from '../lib/api'

test('quantities accept only safe whole numbers', () => {
  assert.equal(parseIntegerQuantity('12', { positive: true }), 12)
  assert.equal(parseIntegerQuantity(' 12 ', { positive: true }), 12)
  assert.equal(parseIntegerQuantity('0', { positive: true }), null)
  assert.equal(parseIntegerQuantity('1.5', { positive: true }), null)
  assert.equal(parseIntegerQuantity('not-a-number'), null)
  assert.equal(parseIntegerQuantity('9007199254740992'), null)
})

test('money remains a decimal string with at most two places', () => {
  assert.equal(isMoneyString('150.00', true), true)
  assert.equal(isMoneyString('0', true), true)
  assert.equal(isMoneyString('', false), true)
  assert.equal(isMoneyString('', true), false)
  assert.equal(isMoneyString('150.000', true), false)
  assert.equal(isMoneyString('-1.00', true), false)
  assert.equal(isMoneyString('$1.00', true), false)
})

test('date validation stays platform-neutral', () => {
  assert.equal(isIsoDate('2026-09-08'), true)
  assert.equal(isIsoDate('09/08/2026'), false)
  assert.equal(isIsoDate(''), false)
  assert.equal(isIsoDate('2026-02-29'), false)
  assert.equal(isIsoDate('2024-02-29'), true)
  assert.equal(isIsoDate('2026-09-31'), false)
})

test('add draft requires identity, quantity, amount and date', () => {
  const errors = validateDraft('add', {
    name: '',
    gameId: '',
    productTypeId: '',
    quantity: '2.5',
    amount: '12.345',
    date: '',
  })

  assert.equal(errors.name, 'Name is required.')
  assert.equal(errors.gameId, 'Choose a game.')
  assert.equal(errors.productTypeId, 'Choose a product type.')
  assert.equal(errors.quantity, 'Enter a whole number greater than zero.')
  assert.equal(errors.amount, 'Enter an amount with up to two decimal places.')
  assert.equal(errors.date, 'Enter a date in YYYY-MM-DD format.')
  assert.equal(firstValidationError(errors), errors.name)
})

test('adjustment rejects zero and validates cost only for added stock', () => {
  const zero = validateDraft('adjust', {
    productId: 'product-1',
    quantity: '0',
    reason: 'correction',
    cost: '',
  })
  assert.equal(zero.quantity, 'Enter a non-zero whole number.')

  const invalidCost = validateDraft('adjust', {
    productId: 'product-1',
    quantity: '2',
    reason: 'opening_inventory',
    cost: '2.999',
  })
  assert.equal(invalidCost.cost, 'Use digits with up to two decimal places.')

  const removal = validateDraft('adjust', {
    productId: 'product-1',
    quantity: '-2',
    reason: 'damaged',
    cost: 'not-used-for-removals',
  })
  assert.equal(removal.cost, undefined)
})

test('move draft cannot send stock to the same bucket', () => {
  const errors = validateDraft('move', {
    productId: 'product-1',
    quantity: '1',
    date: '2026-09-08',
    fromBucket: 'inventory',
    toBucket: 'inventory',
  })
  assert.equal(errors.toBucket, 'Choose a different destination bucket.')
})

test('transaction validation keeps an existing unknown amount untouched', () => {
  const sale: Transaction = {
    kind: 'sale',
    id: 'sale-1',
    occurred_on: '2026-09-08',
    quantity: -1,
    bucket: null,
    from_bucket: null,
    amount: null,
    base_amount: null,
    shipping: null,
    tax: null,
    fees: null,
    platform_fees: null,
    payment_fees: null,
    shipping_paid: null,
    cost: null,
    profit: null,
    has_unknown_cost: true,
    member_id: null,
    label: null,
    notes: null,
    status: 'posted',
  }
  const errors = validateDraft('transaction', {
    transaction: sale,
    quantity: '1',
    amount: '',
    date: '2026-09-08',
  })
  assert.deepEqual(errors, {})
  assert.deepEqual(validateDraft('transaction', {
    transaction: { ...sale, occurred_on: null }, quantity: '1', amount: '', date: '',
  }), {})
})
