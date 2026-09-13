import assert from 'node:assert/strict'
import test from 'node:test'

import type { Taxonomy } from '../lib/api'
import { effectiveProductName, firstValidationError, validateDraft } from '../lib/product-drafts'

const sealedBox: Taxonomy = {
  id: 'box-type',
  name: 'Booster Box',
  slug: 'booster-box',
  is_system: true,
  sort_order: 0,
}

const rawCard: Taxonomy = {
  id: 'single-type',
  name: 'Single',
  slug: 'single',
  is_system: true,
  sort_order: 1,
}

const gradedCard: Taxonomy = {
  id: 'graded-type',
  name: 'Graded Card',
  slug: 'graded-card',
  is_system: true,
  sort_order: 2,
}

test('sealed product names derive from set and type until a manual edit takes over permanently', () => {
  assert.equal(effectiveProductName('', false, 'Stellar Crown', sealedBox), 'Stellar Crown Booster Box')
  assert.equal(
    effectiveProductName('My sealed name', true, 'Different set', sealedBox),
    'My sealed name',
  )
  assert.equal(effectiveProductName('', true, 'Different set', sealedBox), '')
  assert.equal(effectiveProductName('', false, 'Stellar Crown', rawCard), '')
  assert.equal(effectiveProductName('', false, 'Stellar Crown', gradedCard), '')
})

test('add validation and submission input can use a derived sealed name, while cards stay required', () => {
  const derivedName = effectiveProductName('', false, 'Stellar Crown', sealedBox)
  const sealedErrors = validateDraft('add', {
    name: derivedName,
    gameId: 'pokemon',
    productTypeId: sealedBox.id,
    quantity: '1',
    amount: '10.00',
    date: '2026-09-13',
  })
  assert.deepEqual(sealedErrors, {})

  const cardErrors = validateDraft('add', {
    name: effectiveProductName('', false, 'Stellar Crown', rawCard),
    gameId: 'pokemon',
    productTypeId: rawCard.id,
    quantity: '1',
    amount: '10.00',
    date: '2026-09-13',
  })
  assert.equal(cardErrors.name, 'Name is required.')
  assert.equal(firstValidationError(cardErrors), cardErrors.name)
})
