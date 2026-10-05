import assert from 'node:assert/strict'
import test from 'node:test'

import { contentsSize, type ProductDetail } from '../lib/api'
import {
  EMPTY_CRACK_SPLIT,
  buildCrackPayload,
  crackInteger,
  crackOutputs,
  crackSplitTotal,
  crackTotal,
  crackWords,
  validateCrackDraft,
  type CrackDraft,
} from '../lib/crack-drafts'
import { nameAfterTypeChange, opensInto, suggestedProductName } from '../lib/product-types'

const product = {
  id: 'case-1',
  stats: {
    by_bucket: { inventory: 2, store: 0, vault: 0 },
  },
} as ProductDetail

function draft(overrides: Partial<CrackDraft> = {}): CrackDraft {
  return {
    sourceProductId: 'case-1',
    sourceQuantity: '1',
    childrenPerSource: '6',
    fromBucket: 'inventory',
    childProductId: 'box-1',
    childName: 'Example Booster Box',
    childTypeId: 'box-type',
    gameId: 'pokemon',
    language: 'English',
    split: { ...EMPTY_CRACK_SPLIT },
    occurredOn: '2026-09-09',
    ...overrides,
  }
}

test('crack counts accept safe whole numbers and derive the total exactly', () => {
  assert.equal(crackInteger('6', true), 6)
  assert.equal(crackInteger('6.5', true), null)
  assert.equal(crackInteger('-1', true), null)
  assert.equal(crackInteger('9007199254740992', true), null)
  assert.equal(crackTotal('2', '36'), 72)
  assert.equal(crackTotal('9007199254740992', '1'), null)
})

test('blank split defaults all children to the source bucket, while explicit buckets must sum', () => {
  const untouched = crackOutputs(draft(), 'box-1')
  assert.deepEqual(untouched, {
    total: 6,
    allocated: 0,
    untouched: true,
    outputs: [{ product_id: 'box-1', quantity: 6, bucket: 'inventory' }],
  })

  const split = { inventory: '4', store: '1', vault: '1' }
  assert.equal(crackSplitTotal(split), 6)
  assert.deepEqual(crackOutputs(draft({ split }), 'box-1')?.outputs, [
    { product_id: 'box-1', quantity: 4, bucket: 'inventory' },
    { product_id: 'box-1', quantity: 1, bucket: 'store' },
    { product_id: 'box-1', quantity: 1, bucket: 'vault' },
  ])
  assert.equal(validateCrackDraft(draft({ split: { inventory: '4', store: '0', vault: '0' } }), product).split, 'The split adds up to 4, but 6 children come out.')
})

test('crack validation requires child identity only for a new child', () => {
  assert.deepEqual(validateCrackDraft(draft({ childProductId: '' }), product), {})
  const missing = validateCrackDraft(draft({ childProductId: '', childName: '', childTypeId: '', gameId: '', language: '' }), product)
  assert.equal(missing.childName, 'Give the new child product a name.')
  assert.equal(missing.childTypeId, 'Choose the child product type.')
  assert.equal(missing.gameId, 'Choose the child product game.')
  assert.equal(missing.language, 'Choose or enter the child language.')
})

test('crack payload contains no client cost math and preserves opened date', () => {
  const payload = buildCrackPayload(draft({ split: { inventory: '4', store: '1', vault: '1' } }), 'created-box', product)
  assert.deepEqual(payload, {
    product_id: 'case-1',
    quantity: 1,
    from_bucket: 'inventory',
    outputs: [
      { product_id: 'created-box', quantity: 4, bucket: 'inventory' },
      { product_id: 'created-box', quantity: 1, bucket: 'store' },
      { product_id: 'created-box', quantity: 1, bucket: 'vault' },
    ],
    occurred_on: '2026-09-09',
  })
  assert.equal(payload && 'cost' in payload, false)
  assert.deepEqual(buildCrackPayload(draft(), 'created-box', product), buildCrackPayload(draft(), 'created-box', product))
})

test('crack words and child naming follow the operation and type identity', () => {
  assert.deepEqual(crackWords('sealed-case'), { source: 'case', sources: 'cases', child: 'box', children: 'boxes' })
  assert.deepEqual(crackWords('booster-box'), { source: 'box', sources: 'boxes', child: 'pack', children: 'packs' })
  assert.equal(crackWords('single'), null)
  for (const type of ['lot', 'collection', 'binder', 'deck', 'other']) {
    assert.deepEqual(crackWords(type), { source: 'container', sources: 'containers', child: 'item', children: 'items' })
  }
  assert.equal(suggestedProductName('Stellar Crown', { name: 'Booster Box', slug: 'booster-box' }), 'Stellar Crown Booster Box')
})

test('the named sealed products open into packs, and an ETB case into ETBs', () => {
  for (const type of ['elite-trainer-box', 'pokemon-center-elite-trainer-box', 'booster-bundle', 'collector-booster-box', 'illumineers-trove', 'premium-collection', 'ultra-premium-collection', 'super-premium-collection', 'build-and-battle-box', 'mini-tin', 'tin', 'blister']) {
    assert.equal(opensInto(type), 'booster-pack')
    assert.deepEqual(crackWords(type), { source: 'product', sources: 'products', child: 'pack', children: 'packs' })
  }
  assert.equal(opensInto('etb-case'), 'elite-trainer-box')
  assert.deepEqual(crackWords('etb-case'), { source: 'case', sources: 'cases', child: 'ETB', children: 'ETBs' })
  assert.equal(opensInto('secret-lair'), undefined)
})

test('the suggested contents depend on the type and the game', () => {
  assert.equal(contentsSize('elite-trainer-box', 'pokemon'), 9)
  assert.equal(contentsSize('pokemon-center-elite-trainer-box', 'pokemon'), 11)
  assert.equal(contentsSize('booster-bundle', 'pokemon'), 6)
  assert.equal(contentsSize('booster-bundle', 'magic-the-gathering'), 9)
  assert.equal(contentsSize('illumineers-trove', 'lorcana'), 8)
  assert.equal(contentsSize('booster-box', 'lorcana'), 24)
  assert.equal(contentsSize('booster-box', 'pokemon', 'Japanese'), 30)
  assert.equal(contentsSize('sealed-case', 'pokemon'), 6)
  assert.equal(contentsSize('build-and-battle-box', 'pokemon'), 4)
  assert.equal(contentsSize('trainers-toolkit', 'pokemon'), 4)
  assert.equal(contentsSize('mini-tin', 'pokemon'), 2)
  assert.equal(contentsSize('tin', 'pokemon'), undefined)
  assert.equal(contentsSize('elite-trainer-box', 'lorcana'), undefined)
})

test('a set-derived name follows a corrected type, a hand-typed name does not', () => {
  const center = { name: 'Pokémon Center Elite Trainer Box', slug: 'pokemon-center-elite-trainer-box' }
  const retail = { name: 'Elite Trainer Box', slug: 'elite-trainer-box' }
  const single = { name: 'Single', slug: 'single' }
  assert.equal(nameAfterTypeChange('Delta Reign Pokémon Center Elite Trainer Box', 'Delta Reign', center, retail), 'Delta Reign Elite Trainer Box')
  assert.equal(nameAfterTypeChange('My PC ETB', 'Delta Reign', center, retail), 'My PC ETB')
  assert.equal(nameAfterTypeChange('Delta Reign Pokémon Center Elite Trainer Box', 'Delta Reign', center, single), 'Delta Reign Pokémon Center Elite Trainer Box')
})
