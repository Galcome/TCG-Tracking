import assert from 'node:assert/strict'
import test from 'node:test'

import type { CardLookup, ProductCandidate, ReadCard } from '../lib/api'
import {
  lineTotal,
  matchingProduct,
  newCards,
  scanKey,
  scanReadyError,
  scanReviewError,
  scanReducer,
  scanTotal,
  type ScanItem,
} from '../lib/scan-session'

function card(overrides: Partial<ReadCard> = {}): ReadCard {
  return {
    name: 'Pikachu ex',
    set_name: 'Surging Sparks',
    collector_number: '057/191',
    variant: 'Holo',
    language: 'English',
    ...overrides,
  }
}

function lookup(overrides: Partial<CardLookup> = {}): CardLookup {
  return {
    set_id: 'set-1',
    set_name: 'Surging Sparks',
    candidates: [{
      listing: {
        product_id: 7,
        category_id: 3,
        group_id: 900001,
        name: 'Pikachu ex',
        clean_name: null,
        image_url: null,
        url: null,
        subtypes: ['Holofoil'],
        number: '057/191',
      },
      subtype: 'Holofoil',
      market: '12.50',
    }],
    suggested_index: 0,
    method: 'exact',
    message: null,
    ...overrides,
  }
}

function seen(...cards: ReadCard[]): ScanItem[] {
  return scanReducer([], { type: 'seen', cards })
}

test('a card is one row however many frames it stays in view', () => {
  let items = seen(card())
  items = scanReducer(items, { type: 'seen', cards: [card({ collector_number: '57/191' })] })
  items = scanReducer(items, { type: 'seen', cards: [card({ name: ' pikachu EX ' })] })

  assert.equal(items.length, 1)
  assert.equal(items[0].quantity, 1)
  assert.equal(items[0].status, 'pricing')
})

test('a frame with two new cards adds both, newest first, and skips blanks', () => {
  let items = seen(card())
  items = scanReducer(items, {
    type: 'seen',
    cards: [card({ name: 'Raichu', collector_number: '58' }), card({ name: '  ' }), card({ name: 'Raichu', collector_number: '058' })],
  })

  assert.deepEqual(items.map((item) => item.name), ['Raichu', 'Pikachu ex'])
})

test('newCards only returns what the session has not got', () => {
  const items = seen(card())
  assert.deepEqual(newCards(items, [card(), card({ name: 'Raichu' })]).map((c) => c.name), ['Raichu'])
  assert.notEqual(scanKey(card()), scanKey(card({ set_name: 'Prismatic Evolutions' })))
})

test('a priced card takes the catalog price, set and listing', () => {
  const [item] = seen(card({ set_name: 'Sparks', collector_number: '' }))
  const [done] = scanReducer([item], { type: 'priced', key: item.key, lookup: lookup() })

  assert.equal(done.status, 'priced')
  assert.equal(done.price, '12.50')
  assert.equal(done.setName, 'Surging Sparks')
  assert.equal(done.collectorNumber, '057/191')
  assert.equal(done.variant, 'Holofoil')
  assert.deepEqual(done.listing, { productId: 7, groupId: 900001, categoryId: 3, subtype: 'Holofoil' })
})

test('a typed price is never overwritten by a late lookup', () => {
  let items = seen(card())
  items = scanReducer(items, { type: 'price', key: items[0].key, price: '9.00' })
  items = scanReducer(items, { type: 'priced', key: items[0].key, lookup: lookup() })

  assert.equal(items[0].price, '9.00')
})

test('no suggestion or no market price leaves the price to the person', () => {
  const [item] = seen(card())

  const [unsure] = scanReducer([item], { type: 'priced', key: item.key, lookup: lookup({ suggested_index: null }) })
  assert.equal(unsure.status, 'unpriced')
  assert.match(unsure.message ?? '', /Several listings/)

  const [none] = scanReducer([item], {
    type: 'priced', key: item.key, lookup: lookup({ candidates: [], suggested_index: null, message: null }),
  })
  assert.match(none.message ?? '', /No catalog listing/)

  const told = scanReducer([item], {
    type: 'priced', key: item.key, lookup: lookup({ candidates: [], suggested_index: null, message: 'Could not tell which set' }),
  })
  assert.equal(told[0].message, 'Could not tell which set')

  const blank = lookup()
  blank.candidates[0].market = null
  const [free] = scanReducer([item], { type: 'priced', key: item.key, lookup: blank })
  assert.equal(free.status, 'unpriced')
  assert.equal(free.price, '')
  assert.ok(free.listing)
})

test('a failed lookup is a row to finish by hand', () => {
  const [item] = seen(card())
  const [failed] = scanReducer([item], { type: 'failed', key: item.key, message: 'offline' })

  assert.equal(failed.status, 'unpriced')
  assert.equal(failed.message, 'offline')
})

test('quantity goes up and down, and to zero removes the row', () => {
  let items = seen(card(), card({ name: 'Raichu' }))
  const key = items[1].key
  items = scanReducer(items, { type: 'quantity', key, delta: 1 })
  assert.equal(items[1].quantity, 2)
  items = scanReducer(items, { type: 'quantity', key, delta: -2 })
  assert.equal(items.length, 1)
  items = scanReducer(items, { type: 'remove', key: items[0].key })
  assert.deepEqual(items, [])
  assert.deepEqual(scanReducer(seen(card()), { type: 'clear' }), [])
})

test('the total is exact cents and ignores unpriced rows', () => {
  let items = seen(card(), card({ name: 'Raichu' }), card({ name: 'Zapdos' }))
  items = scanReducer(items, { type: 'price', key: items[0].key, price: '0.10' })
  items = scanReducer(items, { type: 'quantity', key: items[0].key, delta: 2 })
  items = scanReducer(items, { type: 'price', key: items[1].key, price: '0.20' })
  items = scanReducer(items, { type: 'price', key: items[2].key, price: 'abc' })

  assert.equal(scanTotal(items), '0.50')
  assert.equal(scanTotal([]), '0.00')
})

test('adding needs every row priced and nothing still pricing', () => {
  assert.equal(scanReadyError([]), 'Scan at least one card.')

  let items = seen(card())
  assert.equal(scanReadyError(items), 'Still pricing a card.')
  items = scanReducer(items, { type: 'failed', key: items[0].key, message: 'x' })
  assert.equal(scanReadyError(items), 'Review Pikachu ex before saving.')
  items = scanReducer(items, { type: 'reviewed', key: items[0].key })
  assert.equal(scanReadyError(items), 'Enter what you paid for Pikachu ex.')
  items = scanReducer(items, { type: 'paid', key: items[0].key, paidEach: '3' })
  assert.equal(scanReadyError(items), null)
})

test('a purchase line uses paid cost, never the market estimate', () => {
  assert.equal(lineTotal({ paidEach: '12.50', quantity: 3 }), '37.50')
  assert.equal(lineTotal({ paidEach: '', quantity: 1 }), null)
})

test('rip review requires confirmation but not a paid cost', () => {
  let items = seen(card())
  items = scanReducer(items, { type: 'failed', key: items[0].key, message: 'x' })
  assert.equal(scanReviewError(items), 'Review Pikachu ex before saving.')
  items = scanReducer(items, { type: 'reviewed', key: items[0].key })
  assert.equal(scanReviewError(items), null)
})

test('the person can choose an ambiguous catalog listing and edit identity before confirming', () => {
  const ambiguous = lookup({
    suggested_index: null,
    candidates: [lookup().candidates[0], {
      ...lookup().candidates[0],
      listing: { ...lookup().candidates[0].listing, product_id: 8, number: '238/191' },
      subtype: 'Reverse Holofoil',
      market: '20.00',
    }],
  })
  let items = seen(card())
  items = scanReducer(items, { type: 'priced', key: items[0].key, lookup: ambiguous })
  assert.equal(scanReviewError(items), 'Choose the catalog match for Pikachu ex.')
  items = scanReducer(items, { type: 'listing', key: items[0].key, index: 1 })
  assert.equal(items[0].collectorNumber, '238/191')
  assert.equal(items[0].variant, 'Reverse Holofoil')
  assert.equal(items[0].price, '20.00')
  assert.equal(items[0].listing?.productId, 8)
  items = scanReducer(items, { type: 'reviewed', key: items[0].key })
  items = scanReducer(items, { type: 'identity', key: items[0].key, field: 'language', value: 'Japanese' })
  assert.equal(items[0].language, 'Japanese')
  assert.equal(items[0].reviewed, false)
  assert.equal(items[0].listing, null)
  assert.equal(items[0].price, '')
})

function candidate(overrides: Partial<ProductCandidate> = {}): ProductCandidate {
  return {
    id: 'p1',
    name: 'Pikachu ex',
    game: { id: 'g', name: 'Pokemon', slug: 'pokemon', is_system: true, sort_order: 1 },
    product_type: { id: 't', name: 'Raw Single', slug: 'raw-single', is_system: true, sort_order: 1 },
    set_id: null,
    set_name: 'Surging Sparks',
    collector_number: '57/191',
    variant: 'Holofoil',
    language: 'English',
    condition: null,
    grading_company: null,
    grade: null,
    cert_number: null,
    external_ref: null,
    ...overrides,
  } as ProductCandidate
}

test('an existing raw single is reused only when it is plainly the same card', () => {
  const item = { name: 'Pikachu ex', setName: 'Surging Sparks', collectorNumber: '057/191', variant: 'Holofoil' }

  assert.equal(matchingProduct([candidate()], item)?.id, 'p1')
  assert.equal(matchingProduct([candidate({ collector_number: '238/191' })], item), null)
  assert.equal(matchingProduct([candidate({ variant: 'Reverse Holofoil' })], item), null)
  assert.equal(matchingProduct([candidate({ variant: null })], { ...item, variant: '' })?.id, 'p1')
  assert.equal(matchingProduct([candidate({ grade: '10' })], item), null)
  assert.equal(matchingProduct([candidate({ product_type: { ...candidate().product_type, slug: 'booster-box' } })], item), null)
  // Two that fit is a choice for a person, not a guess.
  assert.equal(matchingProduct([candidate(), candidate({ id: 'p2' })], item), null)

  const unnumbered = { ...item, collectorNumber: '', variant: 'Holo' }
  assert.equal(matchingProduct([candidate({ collector_number: null })], unnumbered), null)
  assert.equal(matchingProduct([candidate({ collector_number: null, variant: 'holo' })], unnumbered)?.id, 'p1')
})
