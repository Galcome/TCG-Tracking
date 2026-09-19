import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCsv, collectPages, csvFilename, expensesCsv, saleDerivedCells } from '../lib/csv.ts'
import type { Movement, SaleRow } from '../lib/api.ts'

test('CSV quotes cells, supports Excel UTF-8, keeps unknown blank and zero explicit', () => {
  assert.equal(buildCsv({ name: 'test', header: ['name', 'value'], rows: [['Pokémon, "box"', null], ['zero', '0.00']] }),
    '\ufeff"name","value"\r\n"Pokémon, ""box""",""\r\n"zero","0.00"')
  assert.equal(csvFilename('../bad/name', new Date('2026-09-12T12:00:00Z')), '---bad-name-2026-09-12.csv')
})
test('spreadsheet formula text is neutralized without altering negative decimal amounts', () => {
  const csv = buildCsv({ name: 'test', header: ['value'], rows: [['=SUM(A1)'], [' +cmd'], ['@evil'], ['\t=evil'], ['-0.01']] })
  assert.ok(csv.includes('"\'=SUM(A1)"'))
  assert.ok(csv.includes('"\' +cmd"'))
  assert.ok(csv.includes('"\'@evil"'))
  assert.ok(csv.includes('"\'\t=evil"'))
  assert.ok(csv.endsWith('"-0.01"'))
})
test('all export pages are collected without a 200-row cap', async () => {
  const offsets: number[] = []
  const all = await collectPages(async (offset, limit) => {
    offsets.push(offset)
    assert.equal(limit, 200)
    return { total: 201, items: Array.from({ length: Math.min(limit, 201 - offset) }, (_, index) => ({ id: String(offset + index) })) }
  })
  assert.equal(all.length, 201)
  assert.deepEqual(offsets, [0, 200])
})
test('exports refuse duplicate, changed-total and incomplete pages', async () => {
  await assert.rejects(collectPages(async offset => ({ total: 2, items: [{ id: 'same' }] })), /Data changed/)
  await assert.rejects(collectPages(async offset => ({ total: offset ? 3 : 2, items: [{ id: String(offset) }] })), /Data changed/)
  await assert.rejects(collectPages(async () => ({ total: 1, items: [] })), /incomplete/)
})
test('export-only unit cost and ROI use exact cents and preserve unknown/zero distinctions', () => {
  const row = { has_unknown_cost: false, cost_basis: '10.01', realized_profit: '-0.01', quantity: 2 } as SaleRow
  assert.deepEqual(saleDerivedCells(row), ['5.01', '-0.10'])
  assert.deepEqual(saleDerivedCells({ ...row, cost_basis: '0.00' }), ['0.00', ''])
  assert.deepEqual(saleDerivedCells({ ...row, has_unknown_cost: true }), ['', ''])
  assert.deepEqual(saleDerivedCells({ ...row, cost_basis: '90071992547409.91', quantity: 1 }), ['90071992547409.91', '0.00'])
})

test('expenses export names the category and every payer, and flags voids', () => {
  const leg = (account_name: string, amount: string) => ({ account_id: account_name, account_name, account_kind: 'member' as const, amount })
  const row: Movement = { id: '1', kind: 'expense', occurred_on: '2026-09-19', amount: '30.00', legs: [leg('Joint', '-10.00'), leg('Jason', '-20.00')],
    purchase_id: null, sale_id: null, product_name: null, expense_category: 'shipping_supplies', notes: 'mailers', status: 'active' }
  const document = expensesCsv([row, { ...row, status: 'voided', expense_category: null, notes: null }])
  assert.deepEqual(document.header, ['date', 'category', 'amount', 'paid_from', 'note', 'status'])
  assert.deepEqual(document.rows[0], ['2026-09-19', 'Shipping supplies', '30.00', 'Joint + Jason', 'mailers', 'active'])
  assert.deepEqual(document.rows[1].slice(1, 2).concat(document.rows[1].slice(4)), ['', null, 'voided'])
})
