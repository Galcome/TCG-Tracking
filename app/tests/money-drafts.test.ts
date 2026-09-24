import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_ADJUSTMENT_CENTS,
  adjustmentDraftFromMovement,
  buildBalanceAdjustmentPayload,
  buildExpensePayload,
  buildTransferPayload,
  parseAdjustmentCents,
  positiveMoney,
  storeCreditMeaning,
  validateBalanceAdjustmentDraft,
  validateExpenseDraft,
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

test('an expense defaults to one payer and trims its note', () => {
  const draft = { category: 'supplies' as const, amount: '25.00', occurredOn: date, paidFrom: 'joint', split: null, notes: '  sleeves  ' }
  assert.deepEqual(buildExpensePayload(draft, date), {
    category: 'supplies', amount: '25.00', occurred_on: date, paid_from: [{ account_id: 'joint' }], notes: 'sleeves',
  })
  const split = [{ account_id: 'a', amount: '10.00' }, { account_id: 'b', amount: '15.00' }]
  assert.deepEqual(buildExpensePayload({ ...draft, paidFrom: '', split, notes: '' }, date)?.paid_from, split)
})

test('expense validation refuses future dates, no payer, and an unexplained other', () => {
  const errors = validateExpenseDraft({ category: 'other', amount: '0', occurredOn: '2026-09-10', paidFrom: '', split: null, notes: ' ' }, date)
  assert.ok(errors.amount)
  assert.match(errors.occurredOn ?? '', /future/)
  assert.ok(errors.accountId)
  assert.ok(errors.notes)
  assert.ok(validateExpenseDraft({}, date).category)
  assert.equal(buildExpensePayload({ category: 'other', amount: '5.00', occurredOn: date, paidFrom: 'joint', split: null, notes: '' }, date), null)
})

const adjustment = (amount: string, overrides: Record<string, unknown> = {}) => ({
  kind: 'adjustment',
  legs: [{ account_id: 'acct', amount }],
  occurred_on: date,
  notes: 'Opening balance',
  ...overrides,
})

test('a posted adjustment re-opens as the draft that produced it', () => {
  assert.deepEqual(adjustmentDraftFromMovement(adjustment('790.00'), false, date), {
    accountId: 'acct',
    direction: 'up',
    amount: '790.00',
    occurredOn: date,
    notes: 'Opening balance',
  })
  assert.equal(adjustmentDraftFromMovement(adjustment('-12.05'), false, date)?.direction, 'down')
  assert.equal(adjustmentDraftFromMovement(adjustment('-12.05'), false, date)?.amount, '12.05')
})

test('a liability account reads back in its own terms, not raw cash flow', () => {
  // "Jason is owed $5,613" posts as -5613 of cash flow; re-opening must say owed more.
  const draft = adjustmentDraftFromMovement(adjustment('-5613.00'), true, date)
  assert.equal(draft?.direction, 'up')
  assert.equal(draft?.amount, '5613.00')
  assert.equal(adjustmentDraftFromMovement(adjustment('5613.00'), true, date)?.direction, 'down')
})

test('a re-opened draft round-trips back to the payload that posted it', () => {
  const draft = adjustmentDraftFromMovement(adjustment('-1296.22'), true, date)
  assert.deepEqual(buildBalanceAdjustmentPayload(draft!), {
    account_id: 'acct',
    amount: 129622,
    occurred_on: date,
    notes: 'Opening balance',
  })
})

test('only a single-leg adjustment with a real amount can be re-opened', () => {
  assert.equal(adjustmentDraftFromMovement(adjustment('10.00', { kind: 'transfer' }), false, date), null)
  assert.equal(adjustmentDraftFromMovement(adjustment('0.00'), false, date), null)
  assert.equal(
    adjustmentDraftFromMovement(
      adjustment('10.00', { legs: [{ account_id: 'a', amount: '10.00' }, { account_id: 'b', amount: '-10.00' }] }),
      false,
      date,
    ),
    null,
  )
})

test('an undated adjustment re-opens on today rather than blank', () => {
  const draft = adjustmentDraftFromMovement(adjustment('5.00', { occurred_on: null, notes: null }), false, date)
  assert.equal(draft?.occurredOn, date)
  assert.equal(draft?.notes, '')
})
