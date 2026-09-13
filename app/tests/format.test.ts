import assert from 'node:assert/strict'
import test from 'node:test'
import { money } from '../lib/format'
test('shared CAD display never loses large-value cents or converts unknown to zero', () => {
  assert.equal(money('90071992547409.91'), '$90,071,992,547,409.91')
  assert.equal(money('-0.29'), '-$0.29')
  assert.equal(money('0.00'), '$0.00')
  assert.equal(money(null), 'Unknown')
  assert.equal(money(undefined, '—'), '—')
})
