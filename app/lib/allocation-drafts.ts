import type { FundingLeg, ProceedsLeg } from './api'
export interface AllocationDraft { kind: 'account' | 'store'; accountId: string; store: string; amount: string }
export function emptyAllocation(accountId = ''): AllocationDraft { return { kind: 'account', accountId, store: '', amount: '' } }
function cents(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim())
  return match ? BigInt(match[1] + (match[2] ?? '').padEnd(2, '0')) : null
}
/** Input validation only. The API independently enforces ledger totals and account access. */
export function allocationError(rows: AllocationDraft[], totals: string[], funding = false): string | null {
  if (!rows.length || rows.length > 20) return 'Use between one and twenty allocation rows.'
  const seen = new Set<string>()
  let allocated = 0n
  for (const row of rows) {
    if (funding && row.kind !== 'account') return 'Funding requires an existing account.'
    const identity = row.kind === 'account' ? row.accountId : row.store.trim().toLowerCase()
    if (!identity) return 'Choose an account or enter a store for every allocation.'
    const key = `${row.kind}:${identity}`
    if (seen.has(key)) return 'Each destination can only appear once in a split.'
    seen.add(key)
    const amount = cents(row.amount)
    if (amount === null || amount <= 0n) return 'Every split amount must be a positive CAD amount with at most two decimal places.'
    allocated += amount
  }
  let expected = 0n
  for (const value of totals) {
    const amount = cents(value || '0')
    if (amount === null) return 'Enter valid transaction amounts before allocating money.'
    expected += amount
  }
  return allocated === expected ? null : 'The split must equal the full transaction total, including fees for funding or excluding fees for proceeds.'
}
export function allocationPayload(rows: AllocationDraft[]): ProceedsLeg[] {
  return rows.map(row => row.kind === 'account'
    ? { account_id: row.accountId, amount: row.amount.trim() }
    : { store: row.store.trim(), amount: row.amount.trim() })
}
export function fundingPayload(rows: AllocationDraft[]): FundingLeg[] {
  return rows.map(row => ({ account_id: row.accountId, amount: row.amount.trim() }))
}
