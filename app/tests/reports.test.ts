import test from 'node:test'
import assert from 'node:assert/strict'

import {
  REPORT_GROUPS,
  compareDecimalStrings,
  reportMoney,
  sortGroupRows,
} from '../lib/reports.ts'
import type { GroupRow } from '../lib/api.ts'

function row(overrides: Partial<GroupRow>): GroupRow {
  return {
    key: 'row',
    label: 'Row',
    realized_profit: '0.00',
    cost_of_sales: '0.00',
    revenue: '0.00',
    inventory_at_cost: '0.00',
    roi: null,
    units_in_stock: 0,
    sale_count: 0,
    sales_missing_cost: 0,
    units_sold: 0,
    units_purchased: 0,
    avg_days_held: null,
    sell_through: null,
    profit_per_day: null,
    units_by_age: { d0_30: 0, d31_90: 0, d91_180: 0, d180_plus: 0 },
    ...overrides,
  }
}

test('reports expose the six supported grouping axes', () => {
  assert.deepEqual(REPORT_GROUPS.map((group) => group.value), [
    'game',
    'product',
    'product-type',
    'set-performance',
    'marketplace',
    'seller',
  ])
})

test('decimal comparison preserves large money ordering without float conversion', () => {
  assert.equal(compareDecimalStrings('90071992547409.91', '90071992547409.90'), 1)
  assert.equal(compareDecimalStrings('-0.01', '0.00'), -1)
  assert.equal(compareDecimalStrings('0.00', '-0.00'), 0)
})

test('report money formatting preserves exact large, negative, zero, and unknown values', () => {
  assert.equal(reportMoney('90071992547409.91'), '$90,071,992,547,409.91')
  assert.equal(reportMoney('-0.01'), '-$0.01')
  assert.equal(reportMoney('0.00'), '$0.00')
  assert.equal(reportMoney(null), 'Unknown')
})

test('row sorting keeps zero known and unknown values distinct', () => {
  const rows = [
    row({ key: 'unknown', label: 'Unknown', roi: null, profit_per_day: null, avg_days_held: null }),
    row({ key: 'zero', label: 'Zero', roi: 0, profit_per_day: '0.00', avg_days_held: 0 }),
    row({ key: 'winner', label: 'Winner', roi: 0.25, profit_per_day: '10.00', avg_days_held: 10 }),
  ]

  assert.deepEqual(sortGroupRows(rows, 'roi').map((item) => item.key), [
    'winner',
    'zero',
    'unknown',
  ])
  assert.deepEqual(sortGroupRows(rows, 'days').map((item) => item.key), [
    'zero',
    'winner',
    'unknown',
  ])
  assert.deepEqual(sortGroupRows([
    row({ key: 'negative', profit_per_day: '-1.00' }),
    ...rows,
  ], 'perDay').map((item) => item.key), [
    'winner',
    'zero',
    'negative',
    'unknown',
  ])
})
