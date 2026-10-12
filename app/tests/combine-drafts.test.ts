import assert from 'node:assert/strict'
import test from 'node:test'

import type { Product } from '../lib/api'
import { addProducts, bucketsFree, combineInputs, combineQuantity, linesFor, sharedGame } from '../lib/combine-drafts'

function product(id: string, byBucket: { inventory?: number; store?: number; vault?: number }, game = 'pokemon'): Product {
  return {
    id,
    name: 'Card ' + id,
    game: { id: game, name: game, slug: game, is_system: true, sort_order: 0 },
    stats: { by_bucket: { inventory: 0, store: 0, vault: 0, ...byBucket } },
  } as Product
}

test('one of each takes a single copy from the first bucket holding it', () => {
  const [line] = linesFor(product('mew', { store: 3, vault: 1 }), 'one')
  assert.equal(line.bucket, 'store')
  assert.equal(line.quantity, '1')
})

test('every copy takes the whole holding, a row per bucket', () => {
  const lines = linesFor(product('mew', { inventory: 2, vault: 1 }), 'all')
  assert.deepEqual(lines.map(l => [l.bucket, l.quantity]), [['inventory', '2'], ['vault', '1']])
})

test('nothing on hand adds nothing', () => {
  assert.deepEqual(linesFor(product('gone', {}), 'one'), [])
})

test('adding leaves a product already chosen exactly as it was', () => {
  const first = addProducts([], [product('mew', { inventory: 4 })], 'one')
  const edited = [{ ...first[0], quantity: '3' }]
  const again = addProducts(edited, [product('mew', { inventory: 4 }), product('pika', { inventory: 1 })], 'all')
  assert.deepEqual(again.map(l => [l.product_id, l.quantity]), [['mew', '3'], ['pika', '1']])
  assert.equal(addProducts(edited, [product('mew', { inventory: 4 })], 'one'), edited)
})

test('quantities must be positive whole numbers before anything is sent', () => {
  assert.equal(combineQuantity('2'), 2)
  assert.equal(combineQuantity('0'), null)
  assert.equal(combineQuantity('1.5'), null)
  assert.equal(combineQuantity(''), null)
  const lines = addProducts([], [product('mew', { inventory: 2 })], 'all')
  assert.deepEqual(combineInputs(lines), [{ product_id: 'mew', bucket: 'inventory', quantity: 2 }])
  assert.equal(combineInputs([{ ...lines[0], quantity: 'x' }]), null)
})

test('the bundle game is the one every row shares, else the form asks', () => {
  const pokemon = addProducts([], [product('mew', { inventory: 1 }), product('pika', { inventory: 1 })], 'one')
  assert.equal(sharedGame(pokemon), 'pokemon')
  assert.equal(sharedGame([...pokemon, ...linesFor(product('elsa', { inventory: 1 }, 'lorcana'), 'one')]), null)
  assert.equal(sharedGame([]), null)
})

test('a row can move only to a bucket that holds the card and no sibling row uses', () => {
  const lines = linesFor(product('mew', { inventory: 2, store: 1, vault: 0 }), 'all')
  assert.deepEqual(bucketsFree(lines, lines[0]), ['inventory'])
  const single = linesFor(product('mew', { inventory: 2, store: 1 }), 'one')
  assert.deepEqual(bucketsFree(single, single[0]), ['inventory', 'store'])
})
