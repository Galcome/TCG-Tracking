import assert from 'node:assert/strict'
import test from 'node:test'
import { allocationError, allocationPayload, emptyAllocation } from '../lib/allocation-drafts'
test('allocation validation uses exact cents and requires a complete unique split', () => {
  const rows = [{...emptyAllocation('one'),amount:'0.10'}, {...emptyAllocation('two'),amount:'0.19'}]
  assert.equal(allocationError(rows,['0.20','0.09'],true),null)
  assert.ok(allocationError(rows,['0.30'],true))
  assert.ok(allocationError([...rows,rows[0]],['0.39'],true))
  assert.ok(allocationError([{...rows[0],amount:'0.001'}],['0.001'],true))
  assert.equal(allocationError([{...rows[0],amount:'90071992547409.91'}],['90071992547409.91'],true),null)
  const mixed = [rows[0], {...emptyAllocation(),kind:'store' as const,store:' New shop ',amount:'0.19'}]
  assert.equal(allocationError(mixed,['0.29']),null)
  assert.ok(allocationError(mixed,['0.29'],true))
  assert.deepEqual(allocationPayload(mixed),[{account_id:'one',amount:'0.10'},{store:'New shop',amount:'0.19'}])
})
