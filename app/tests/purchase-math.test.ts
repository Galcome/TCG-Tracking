import assert from 'node:assert/strict'
import test from 'node:test'

import { ontarioHst, purchaseGrandTotal, totalFromEach, withOntarioHst } from '../lib/purchase-math'

test('the total paid is the quantity times the price of one', () => {
  assert.equal(totalFromEach('4', '80.99'), '323.96')
  assert.equal(totalFromEach(' 3 ', '5'), '15.00')
  assert.equal(totalFromEach('1', '0.5'), '0.50')
  assert.equal(totalFromEach('0', '80.99'), null)
  assert.equal(totalFromEach('4', '80.999'), null)
  assert.equal(totalFromEach('4', ''), null)
})

test('Ontario HST is 13% of the price and shipping, rounded half up', () => {
  assert.equal(ontarioHst('323.96', ''), '42.11')
  assert.equal(ontarioHst('100', '10'), '14.30')
  assert.equal(ontarioHst('0.50', ''), '0.07')
  assert.equal(ontarioHst('', ''), null)
  assert.equal(ontarioHst('100', 'ten'), null)
})

test('the grand total adds shipping, tax and fees to the total paid', () => {
  assert.equal(purchaseGrandTotal('323.96', '', '42.11', ''), '366.07')
  assert.equal(purchaseGrandTotal('100', '10', '14.30', '2.5'), '126.80')
  assert.equal(purchaseGrandTotal('100', 'x', '', ''), null)
})

test('an expense with HST added is the amount plus 13%, rounded half up', () => {
  assert.equal(withOntarioHst('100'), '113.00')
  assert.equal(withOntarioHst('19.99'), '22.59')
  assert.equal(withOntarioHst(''), null)
  assert.equal(withOntarioHst('ten'), null)
})
