import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildValuationPayload,
  firstValuationValidationError,
  validateValuationDraft,
  valuationDate,
  valuationMoney,
  type ValuationDraft,
} from '../lib/valuation-drafts'

const base: ValuationDraft = {
  productId: 'product-1',
  value: '19.99',
  capturedOn: '2026-09-09',
  notes: '',
}

test('valuation money accepts decimal CAD values including zero, but not blank or invalid precision', () => {
  assert.equal(valuationMoney('19.99', true), true)
  assert.equal(valuationMoney('0', true), true)
  assert.equal(valuationMoney('0.00', true), true)
  assert.equal(valuationMoney('', true), false)
  assert.equal(valuationMoney('-1.00', true), false)
  assert.equal(valuationMoney('19.999', true), false)
})

test('valuation dates use calendar-aware ISO validation', () => {
  assert.equal(valuationDate('2024-02-29'), true)
  assert.equal(valuationDate('2026-02-29'), false)
  assert.equal(valuationDate('2026-09-09'), true)
})

test('blank values and malformed dates are rejected while zero is valid', () => {
  const invalid = validateValuationDraft({ ...base, value: '', capturedOn: '2026-02-29' })
  assert.equal(invalid.value, 'Enter a per-unit estimate with up to two decimal places.')
  assert.equal(invalid.capturedOn, 'Enter a date in YYYY-MM-DD format.')
  assert.equal(firstValuationValidationError(invalid), invalid.value)
  assert.deepEqual(validateValuationDraft({ ...base, value: '0' }), {})
})

test('valuation payload preserves exact money/date strings and only trims optional notes', () => {
  assert.deepEqual(buildValuationPayload({
    ...base,
    productId: ' product-1 ',
    value: '0019.99',
    capturedOn: '2026-09-08',
    notes: '  slab lookup  ',
  }), {
    product_id: 'product-1',
    value: '0019.99',
    captured_on: '2026-09-08',
    notes: 'slab lookup',
  })

  assert.deepEqual(buildValuationPayload({ ...base, value: '0', notes: '' }), {
    product_id: 'product-1',
    value: '0',
    captured_on: '2026-09-09',
    notes: null,
  })
})
