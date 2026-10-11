import assert from 'node:assert/strict'
import test from 'node:test'
import { barHeights, linePaths, plotValue, shares } from '../lib/charts'

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

test('bars scale to the tallest and never go below the axis', () => {
  assert.deepEqual(barHeights([50, 100, -20, 0], 80), [40, 80, 0, 0])
  assert.deepEqual(barHeights([0, 0], 80), [0, 0])
  assert.deepEqual(barHeights([], 80), [])
})

test('a stacked bar splits by share and gives a negative part no room', () => {
  assert.deepEqual(shares(25, 75), [0.25, 0.75])
  assert.deepEqual(shares(100, -40), [1, 0])
  assert.deepEqual(shares(0, 0), [0, 0])
})
