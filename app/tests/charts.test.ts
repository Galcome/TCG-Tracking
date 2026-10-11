import assert from 'node:assert/strict'
import test from 'node:test'
import { linePaths, plotValue, stackHeights } from '../lib/charts'

test('plot values read decimal strings and treat unknown as zero', () => {
  assert.equal(plotValue('1234.56'), 1234.56)
  assert.equal(plotValue('-0.29'), -0.29)
  assert.equal(plotValue(null), 0)
  assert.equal(plotValue(undefined), 0)
  assert.equal(plotValue('not money'), 0)
})

test('lines share one scale, highest value at the top', () => {
  const [value, cost] = linePaths([[10, 30], [10, 20]], 100, 50, 5)
  assert.equal(value, 'M0 45 L100 5')
  assert.equal(cost, 'M0 45 L100 25')
})

test('a single point draws a flat line across the chart', () => {
  assert.deepEqual(linePaths([[500]], 200, 60), ['M0 30 H200'])
})

test('no points draw nothing', () => {
  assert.deepEqual(linePaths([[], []], 200, 60), ['', ''])
})

test('stacks share one scale, the tallest stack fills the height', () => {
  // Spent $100 of own money and $300 of house money, against $200 of revenue.
  assert.deepEqual(stackHeights([[100, 300], [200]], 80), [[20, 60], [40]])
})

test('a negative part takes no room and nothing draws when every stack is empty', () => {
  assert.deepEqual(stackHeights([[50, -20], [25]], 100), [[100, 0], [50]])
  assert.deepEqual(stackHeights([[0, 0], [0]], 80), [[0, 0], [0]])
  assert.deepEqual(stackHeights([], 80), [])
})
