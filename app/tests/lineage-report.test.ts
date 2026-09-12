import test from 'node:test'
import assert from 'node:assert/strict'

import {
  flattenLineageNodes,
  lineageHasActivity,
  lineageIndent,
  lineageNodeLabel,
} from '../lib/lineage-report.ts'
import type { LineageNode, LineageRollup } from '../lib/api.ts'

function report(overrides: Partial<LineageRollup>): LineageRollup {
  return {
    product_id: 'root',
    product_name: 'Root product',
    cost: '900.01',
    realized_profit: '0.00',
    remaining_cost: '900.01',
    written_off: '0.00',
    units_sold: 0,
    units_remaining: 1,
    roi: null,
    tree: [],
    ...overrides,
  }
}

function node(overrides: Partial<LineageNode>): LineageNode {
  return {
    product_id: 'child',
    product_name: 'Child product',
    depth: 1,
    quantity_produced: 1,
    cost: null,
    children: [],
    ...overrides,
  }
}

test('lineage activity is based on descendants or sold units, not money guesses', () => {
  assert.equal(lineageHasActivity(report({})), false)
  assert.equal(lineageHasActivity(report({ units_sold: 1 })), true)
  assert.equal(lineageHasActivity(report({ tree: [node({})] })), true)
  assert.equal(lineageHasActivity(report({ written_off: '10.01', remaining_cost: '0.00', units_remaining: 0 })), true)
})

test('lineage node labels identify linked products and indentation stays non-negative', () => {
  assert.equal(lineageNodeLabel(node({ product_name: 'Opened booster box' })), 'Lineage node: Opened booster box')
  assert.equal(lineageIndent(-3), 0)
  assert.equal(lineageIndent(1), 0)
  assert.equal(lineageIndent(3), 28)
  assert.equal(lineageIndent(6), 28)
})

test('lineage nodes flatten in preorder so deep cards stay responsive', () => {
  const rows = flattenLineageNodes([
    node({ product_id: 'first', product_name: 'First', children: [
      node({ product_id: 'grandchild', product_name: 'Grandchild', depth: 3 }),
    ] }),
    node({ product_id: 'second', product_name: 'Second' }),
  ])

  assert.deepEqual(rows.map((item) => item.product_name), ['First', 'Grandchild', 'Second'])
})
