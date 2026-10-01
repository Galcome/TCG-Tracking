import assert from 'node:assert/strict'
import test from 'node:test'
import type { Transaction } from '../lib/api'
import { costChanges, costError, costUnits, fromCents, openPurchases, toCents } from '../lib/cost-drafts'

const purchase = (id: string, quantity: number, base: string, status = 'active') =>
  ({ kind: 'purchase', id, quantity, base_amount: base, status }) as Transaction

test('cents round-trip exactly without floats', () => {
  assert.equal(toCents('175.09'), 17509)
  assert.equal(toCents('7.3'), 730)
  assert.equal(toCents('650'), 65000)
  assert.equal(fromCents(17509), '175.09')
  assert.equal(fromCents(5), '0.05')
})

test('only active purchases can be repriced', () => {
  const history = [purchase('a', 1, '1.00'), purchase('b', 1, '1.00', 'voided'), { ...purchase('c', 1, '1.00'), kind: 'sale' } as Transaction]
  assert.deepEqual(openPurchases(history).map((entry) => entry.id), ['a'])
})

test('every unit of every purchase gets a row, and odd cents are not lost', () => {
  const units = costUnits([purchase('a', 3, '10.00'), purchase('b', 2, '0.00')])
  assert.deepEqual(units.map((unit) => unit.cost), ['3.34', '3.33', '3.33', '0.00', '0.00'])
  assert.deepEqual(units.map((unit) => unit.purchaseId), ['a', 'a', 'a', 'b', 'b'])
})

test('one price for all becomes a new total; different prices are sent per unit', () => {
  const units = costUnits([purchase('a', 5, '0.00'), purchase('b', 2, '0.00'), purchase('c', 3, '10.00')])
  const costs = ['175.09', '175.09', '175.09', '175.09', '175.09', '100', '120.5', '3.34', '3.33', '3.33']
  assert.deepEqual(costChanges(units, costs), [
    { purchaseId: 'a', kind: 'total', amount: '875.45' },
    { purchaseId: 'b', kind: 'units', unitCosts: ['100.00', '120.50'] },
  ])
})

test('a blank or malformed cost is refused before anything is sent', () => {
  assert.equal(costError(['1.00', ' 2 ']), null)
  assert.ok(costError(['1.00', '']))
  assert.ok(costError(['1.234']))
  assert.ok(costError(['-1']))
})
