import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_ADJUSTMENT_CENTS,
  buildBalanceAdjustmentPayload,
  buildTransferPayload,
  parseAdjustmentCents,
  positiveMoney,
  storeCreditMeaning,
  validateBalanceAdjustmentDraft,
  validateTransferDraft,
  validateVoidMovementDraft,
} from '../lib/money-drafts'

const date = '2026-09-09'

test('money inputs stay decimal strings and reject zero, fractions over two places, and negatives', () => {
  assert.equal(positiveMoney('19.99'), true)
  assert.equal(positiveMoney('0.29'), true)
  assert.equal(positiveMoney('0.00'), false)
  assert.equal(positiveMoney('-1.00'), false)
  assert.equal(positiveMoney('19.999'), false)
})

test('adjustment cents are parsed exactly without float rounding', () => {
  assert.equal(parseAdjustmentCents('19.99'), 1999)
  assert.equal(parseAdjustmentCents('0.29'), 29)
  assert.equal(parseAdjustmentCents('1.2'), 120)
  assert.equal(parseAdjustmentCents('1000000000.00'), MAX_ADJUSTMENT_CENTS)
  assert.equal(parseAdjustmentCents('1000000000.01'), null)
})

test('transfer validation requires different accounts, positive bounded money, and a valid date', () => {
  const errors = validateTransferDraft({
    fromAccountId: 'joint',
    toAccountId: 'joint',
    amount: '1000000000.01',
    occurredOn: '2026-02-30',
  })
  assert.equal(errors.toAccountId, 'Choose a different destination account.')
  assert.equal(errors.amount, 'Enter an amount no larger than 1 billion dollars with up to two decimal places.')
  assert.equal(errors.occurredOn, 'Enter a date in YYYY-MM-DD format.')
})

test('transfer payload preserves the exact decimal amount and trims optional notes', () => {
  assert.deepEqual(buildTransferPayload({
    fromAccountId: 'joint',
    toAccountId: 'member-1',
    amount: '0019.99',
    occurredOn: date,
    notes: '  reimbursement  ',
  }), {
    from_account_id: 'joint',
    to_account_id: 'member-1',
    amount: '0019.99',
    occurred_on: date,
    notes: 'reimbursement',
  })
})

test('balance adjustment payload sends signed integer cents for both directions', () => {
  const base = {
    accountId: 'member-1',
    amount: '0.29',
    occurredOn: date,
    notes: '',
  }
  assert.deepEqual(buildBalanceAdjustmentPayload({ ...base, direction: 'up' }), {
    account_id: 'member-1',
    amount: 29,
    occurred_on: date,
    notes: null,
  })
  assert.deepEqual(buildBalanceAdjustmentPayload({ ...base, direction: 'down' }), {
    account_id: 'member-1',
    amount: -29,
    occurred_on: date,
    notes: null,
  })
  assert.equal(validateBalanceAdjustmentDraft({ ...base, amount: '0.00' }).amount, 'Enter an amount greater than zero with up to two decimal places.')
})

test('voiding a movement requires an audit reason and trims it at submit time', () => {
  assert.deepEqual(validateVoidMovementDraft({ reason: '  wrong direction  ' }), {})
  assert.equal(validateVoidMovementDraft({ reason: '  ' }).reason, 'Give a reason for voiding this movement.')
})

test('store credit wording distinguishes positive, zero, and negative balances', () => {
  assert.equal(storeCreditMeaning('25.00', 'Card Shop'), 'Credit to spend at Card Shop; not cash')
  assert.equal(storeCreditMeaning('0.00', 'Card Shop'), 'Nothing left here')
  assert.equal(storeCreditMeaning('-5.00', 'Card Shop'), 'Store credit is below zero at Card Shop')
})
