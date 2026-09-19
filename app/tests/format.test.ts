import assert from 'node:assert/strict'
import test from 'node:test'
import { dateFromIso, describeDate, money, todayIso, tone, yesterdayIso } from '../lib/format'
test('shared CAD display never loses large-value cents or converts unknown to zero', () => {
  assert.equal(money('90071992547409.91'), '$90,071,992,547,409.91')
  assert.equal(money('-0.29'), '-$0.29')
  assert.equal(money('0.00'), '$0.00')
  assert.equal(money(null), 'Unknown')
  assert.equal(money(undefined, '—'), '—')
})

test('signed figures tone by direction without float parsing', () => {
  assert.equal(tone('12.50'), 'gain')
  assert.equal(tone('+0.01'), 'gain')
  assert.equal(tone('-0.29'), 'loss')
  assert.equal(tone('0.00'), null)
  assert.equal(tone('-0.00'), null)
  assert.equal(tone('90071992547409.91'), 'gain')
  assert.equal(tone(null), null)
  assert.equal(tone(undefined), null)
  assert.equal(tone('n/a'), null)
  assert.equal(tone(0.12), 'gain')
  assert.equal(tone(-0.5), 'loss')
  assert.equal(tone(0), null)
  assert.equal(tone(Number.NaN), null)
})

test('form dates are local calendar days that default to today and step back to yesterday', () => {
  const lateEvening = new Date(2026, 0, 1, 23, 30)
  assert.equal(todayIso(lateEvening), '2026-01-01')
  assert.equal(yesterdayIso(lateEvening), '2025-12-31')
  assert.equal(describeDate('2026-01-01', lateEvening), 'Today')
  assert.equal(describeDate('2025-12-31', lateEvening), 'Yesterday')
  assert.match(describeDate('2025-09-12', lateEvening), /Sep.*12.*2025/)
  assert.equal(describeDate('', lateEvening), 'Choose a date')
})

test('only real calendar days parse', () => {
  assert.equal(dateFromIso('2026-02-29'), null)
  assert.equal(dateFromIso('2026-9-1'), null)
  assert.equal(dateFromIso('2024-02-29')?.getDate(), 29)
})
