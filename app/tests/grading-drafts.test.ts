import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildGradedProductPayload,
  buildReturnFromGradingPayload,
  buildSendToGradingPayload,
  buildVoidGradingPayload,
  firstGradingValidationError,
  validateGradedProductDraft,
  validateReturnFromGradingDraft,
  validateSendToGradingDraft,
  validateVoidGradingDraft,
  type ReturnFromGradingDraft,
  type SendToGradingDraft,
} from '../lib/grading-drafts'

const sendDraft: SendToGradingDraft = {
  productId: 'raw-1',
  quantity: '2',
  bucket: 'inventory',
  gradingCompany: ' PSA ',
  sentOn: '2026-09-09',
  fees: '001.20',
  notes: '  sent with insurance  ',
}

const returnDraft: ReturnFromGradingDraft = {
  submissionId: 'submission-1',
  sourceProductId: 'raw-1',
  gradedProductId: 'graded-1',
  name: 'Card — PSA 10',
  gameId: 'game-1',
  productTypeId: 'graded-type',
  setName: 'Set',
  collectorNumber: '1/10',
  variant: 'Holo',
  language: 'English',
  condition: '',
  gradingCompany: 'PSA',
  grade: ' 10 ',
  certNumber: '12345',
  storageLocation: 'Shelf 1',
  returnedOn: '2026-09-09',
  extraFees: '2.50',
  notes: '  returned safely  ',
}

test('send validation uses bucket availability and calendar-aware dates', () => {
  const errors = validateSendToGradingDraft({ ...sendDraft, quantity: '3', sentOn: '2026-02-29', fees: '1.999' }, 2)
  assert.equal(errors.quantity, 'Only 2 units are in this bucket.')
  assert.equal(errors.sentOn, 'Enter a date in YYYY-MM-DD format.')
  assert.equal(errors.fees, 'Use digits with up to two decimal places.')
  assert.equal(firstGradingValidationError(errors), errors.quantity)
  assert.deepEqual(validateSendToGradingDraft({ ...sendDraft, quantity: '2' }, 2), {})
})

test('send payload preserves decimal fee text and passes no client cost calculation', () => {
  assert.deepEqual(buildSendToGradingPayload(sendDraft), {
    product_id: 'raw-1',
    quantity: 2,
    bucket: 'inventory',
    grading_company: 'PSA',
    sent_on: '2026-09-09',
    fees: '001.20',
    notes: 'sent with insurance',
  })
})

test('return validation accepts an existing child without requiring inline identity', () => {
  assert.deepEqual(validateReturnFromGradingDraft({
    submissionId: 'submission-1',
    sourceProductId: 'raw-1',
    gradedProductId: 'graded-1',
    returnedOn: '2024-02-29',
    extraFees: '',
  }), {})
  assert.equal(validateReturnFromGradingDraft({
    ...returnDraft,
    gradedProductId: 'raw-1',
  }).gradedProductId, 'The graded card must be a different product from the raw card.')
})

test('inline return identity is required and the return payload preserves fees/date/grade', () => {
  const invalid = validateReturnFromGradingDraft({ ...returnDraft, gradedProductId: '', name: '', productTypeId: '' })
  assert.equal(invalid.name, 'The graded card needs a name.')
  assert.equal(invalid.productTypeId, 'Choose the graded card product type.')

  assert.deepEqual(buildReturnFromGradingPayload(returnDraft), {
    graded_product_id: 'graded-1',
    grade: '10',
    returned_on: '2026-09-09',
    extra_fees: '2.50',
    notes: 'returned safely',
  })
})

test('inline graded child carries identity but never creates an initial purchase', () => {
  assert.deepEqual(validateGradedProductDraft({ name: 'Card — PSA 10', gameId: 'game-1', productTypeId: 'graded-type' }), {})
  assert.deepEqual(buildGradedProductPayload({ ...returnDraft, gradedProductId: '' }), {
    name: 'Card — PSA 10',
    game_id: 'game-1',
    product_type_id: 'graded-type',
    set_name: 'Set',
    collector_number: '1/10',
    variant: 'Holo',
    language: 'English',
    condition: null,
    grading_company: 'PSA',
    grade: '10',
    cert_number: '12345',
    storage_location: 'Shelf 1',
    notes: 'returned safely',
  })
})

test('void validation requires a bounded audit reason and trims it for the server', () => {
  assert.equal(validateVoidGradingDraft({ submissionId: 'submission-1', reason: '  ' }).reason, 'Give a reason for cancelling this grading submission.')
  assert.equal(buildVoidGradingPayload({ submissionId: 'submission-1', reason: '  duplicate entry  ' }), 'duplicate entry')
})
