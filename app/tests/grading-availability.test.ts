import assert from 'node:assert/strict';
import test from 'node:test';
import type { GradingSubmission } from '../lib/api';
import { gradingAvailable, validateGradingReturnContext } from '../lib/grading-drafts';

const submission: GradingSubmission = { id: 's1', product_id: 'p1', product_name: 'Card', quantity: 1,
  bucket: 'inventory', grading_company: 'PSA', sent_on: '2026-09-09', fees: '30.29', status: 'out',
  returned_on: null, grade: null, days_out: 0, notes: null };
test('grading availability subtracts only outstanding units of this product and bucket', () => {
  assert.deepEqual(gradingAvailable('p1', { inventory: 1, store: 2, vault: 0 }, [submission,
    { ...submission, id: 'returned', status: 'returned' }, { ...submission, product_id: 'p2' },
    { ...submission, id: 'store', bucket: 'store' }]), { inventory: 0, store: 1, vault: 0 });
  assert.equal(gradingAvailable('p1', { inventory: 1, store: 0, vault: 0 }, [submission, submission]).inventory, 0);
});
test('grading return rejects missing stock, completed submissions and impossible chronology', () => {
  const held = { inventory: 1, store: 0, vault: 0 };
  assert.deepEqual(validateGradingReturnContext(submission, held, '2026-09-09'), {});
  assert.match(validateGradingReturnContext(submission, held, '2026-09-08').returnedOn!, /before/);
  assert.match(validateGradingReturnContext(submission, held, '2026-02-30').returnedOn!, /date/);
  assert.match(validateGradingReturnContext(submission, { ...held, inventory: 0 }, '2026-09-09').quantity!, /stock/);
  assert.match(validateGradingReturnContext({ ...submission, status: 'returned' }, held, '2026-09-09').submissionId!, /outstanding/);
});
