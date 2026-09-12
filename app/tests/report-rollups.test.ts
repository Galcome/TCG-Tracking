import test from 'node:test'
import assert from 'node:assert/strict'

import {
  agingBandFor,
  agingBandLabel,
  agingDescription,
  groupAgingLots,
  purchaseDateDescription,
} from '../lib/report-rollups.ts'
import type { AgingLot } from '../lib/api.ts'

function lot(overrides: Partial<AgingLot>): AgingLot {
  return {
    purchase_id: 'purchase',
    product_id: 'product',
    product_name: 'Product',
    game_slug: 'pokemon',
    units: 1,
    cost: '10.00',
    purchase_date: '2026-09-12',
    days_held: 0,
    ...overrides,
  }
}

test('age bands keep boundary days and unknown dates distinct', () => {
  assert.equal(agingBandFor(0), '0-30')
  assert.equal(agingBandFor(30), '0-30')
  assert.equal(agingBandFor(31), '31-90')
  assert.equal(agingBandFor(90), '31-90')
  assert.equal(agingBandFor(91), '91-180')
  assert.equal(agingBandFor(180), '91-180')
  assert.equal(agingBandFor(181), '180-plus')
  assert.equal(agingBandFor(null), 'unknown')
  assert.equal(agingBandLabel(null), 'Unknown age')
})

test('age descriptions preserve zero and make undated stock explicit', () => {
  assert.equal(agingDescription(0), '0d held')
  assert.equal(agingDescription(null), 'Unknown age')
  assert.equal(purchaseDateDescription('2026-09-12'), 'bought 2026-09-12')
  assert.equal(purchaseDateDescription(null), 'no purchase date')
})

test('aging lots are grouped in stable display bands without combining money', () => {
  const groups = groupAgingLots([
    lot({ purchase_id: 'old', product_name: 'Old', days_held: 181 }),
    lot({ purchase_id: 'today', product_name: 'Today', days_held: 0 }),
    lot({ purchase_id: 'unknown', product_name: 'Unknown', days_held: null }),
    lot({ purchase_id: 'middle', product_name: 'Middle', days_held: 31 }),
  ])

  assert.deepEqual(groups.map((group) => group.label), ['0–30 days', '31–90 days', '180+ days', 'Unknown age'])
  assert.deepEqual(groups.map((group) => group.lots[0].purchase_id), ['today', 'middle', 'old', 'unknown'])
  assert.deepEqual(groups.flatMap((group) => group.lots).map((item) => item.cost), [
    '10.00',
    '10.00',
    '10.00',
    '10.00',
  ])
})
