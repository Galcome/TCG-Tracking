import { EXPENSE_CATEGORY_LABELS, type GroupRow, type Movement, type Product, type SaleRow } from './api'

export type CsvCell = string | number | null | undefined
export interface CsvDocument { name: string; header: string[]; rows: CsvCell[][] }

function escapeCell(cell: CsvCell): string {
  let value = cell == null ? '' : String(cell)
  // Quoting alone does not stop spreadsheet formulas in catalogue/user-entered text.
  if (typeof cell === 'string' && !/^[+-]?\d+(?:\.\d+)?$/.test(value) &&
    (/^\s*[=+@-]/.test(value) || /^[\t\r\n]/.test(value))) value = "'" + value
  return '"' + value.replace(/"/g, '""') + '"'
}

export function buildCsv(csv: CsvDocument): string {
  return '\ufeff' + [csv.header, ...csv.rows].map(row => row.map(escapeCell).join(',')).join('\r\n')
}

export function csvFilename(name: string, now = new Date()): string {
  return `${name.replace(/[^a-z0-9_-]/gi, '-')}-${now.toISOString().slice(0, 10)}.csv`
}

export const percentCell = (value: number | null | undefined) => value == null ? '' : (value * 100).toFixed(2)

/** Live paginated reads: refuse changed totals, duplicate rows or premature empty pages. */
export async function collectPages<T extends { id: string }>(
  fetchPage: (offset: number, limit: number) => Promise<{ items: T[]; total: number }>,
): Promise<T[]> {
  const rows: T[] = []
  const seen = new Set<string>()
  let total: number | undefined
  for (;;) {
    const page = await fetchPage(rows.length, 200)
    if (!Number.isSafeInteger(page.total) || page.total < 0 || page.items.length > 200) throw new Error('Invalid export page.')
    if (total !== undefined && page.total !== total) throw new Error('Data changed while exporting. Please try again.')
    total = page.total
    if (page.items.length === 0 && rows.length < total) throw new Error('Export was incomplete. Please try again.')
    for (const row of page.items) {
      if (seen.has(row.id)) throw new Error('Data changed while exporting. Please try again.')
      seen.add(row.id)
      rows.push(row)
    }
    if (rows.length > total) throw new Error('Invalid export page.')
    if (rows.length === total) return rows
  }
}

export function groupCsv(name: string, rows: GroupRow[]): CsvDocument {
  return { name, header: ['group', 'units_purchased', 'units_sold', 'units_in_stock', 'revenue', 'cost_of_sales',
    'realized_profit', 'roi_percent', 'inventory_at_cost', 'avg_days_held', 'sell_through_percent', 'profit_per_day', 'sales_missing_cost'],
  rows: rows.map(row => [row.label, row.units_purchased, row.units_sold, row.units_in_stock, row.revenue,
    row.cost_of_sales, row.realized_profit, percentCell(row.roi), row.inventory_at_cost, row.avg_days_held,
    percentCell(row.sell_through), row.profit_per_day, row.sales_missing_cost]) }
}

export function inventoryCsv(rows: Product[]): CsvDocument {
  return { name: 'tcg-inventory', header: ['product', 'set', 'game', 'type', 'language', 'units', 'inventory',
    'store', 'vault', 'unit_cost', 'inventory_at_cost', 'realized_profit_to_date'],
  rows: rows.map(row => [row.name, row.set_name, row.game.name, row.product_type.name, row.language,
    row.stats.quantity_on_hand, row.stats.by_bucket.inventory, row.stats.by_bucket.store, row.stats.by_bucket.vault,
    row.stats.average_unit_cost, row.stats.remaining_cost, row.stats.realized_profit]) }
}

/** Voided expenses stay in the export, flagged, so the file reconciles with the ledger. */
export function expensesCsv(rows: Movement[]): CsvDocument {
  return { name: 'tcg-expenses', header: ['date', 'category', 'amount', 'paid_from', 'note', 'status'],
  rows: rows.map(row => [row.occurred_on, row.expense_category ? EXPENSE_CATEGORY_LABELS[row.expense_category] : '',
    row.amount, row.legs.map(leg => leg.account_name).join(' + '), row.notes, row.status]) }
}

function cents(value: string): bigint {
  const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(value)
  if (!match) throw new Error('Invalid monetary value in export.')
  return BigInt((match[1] === '-' ? '-' : '') + match[2] + (match[3] ?? '').padEnd(2, '0'))
}
function roundDivide(value: bigint, divisor: bigint): bigint {
  const sign = value < 0n ? -1n : 1n
  const positive = value * sign
  return sign * (positive / divisor + (positive % divisor * 2n >= divisor ? 1n : 0n))
}
function decimal(value: bigint): string {
  const text = (value < 0n ? -value : value).toString().padStart(3, '0')
  return (value < 0n ? '-' : '') + text.slice(0, -2) + '.' + text.slice(-2)
}
/** Export-only derived columns; never used as ledger inputs or authoritative totals. */
export function saleDerivedCells(row: SaleRow): [CsvCell, CsvCell] {
  if (row.has_unknown_cost || row.cost_basis === null) return ['', '']
  const cost = cents(row.cost_basis)
  const unit = row.quantity > 0 ? decimal(roundDivide(cost, BigInt(row.quantity))) : ''
  const roi = cost > 0n && row.realized_profit !== null
    ? decimal(roundDivide(cents(row.realized_profit) * 10000n, cost)) : ''
  return [unit, roi]
}
export function salesCsv(rows: SaleRow[], members: ReadonlyMap<string, string>): CsvDocument {
  return { name: 'tcg-sales', header: ['date', 'product', 'set', 'game', 'type', 'language', 'marketplace', 'sold_by',
    'quantity', 'gross', 'platform_fees', 'payment_fees', 'shipping_paid', 'net', 'cost_basis', 'unit_cost', 'profit',
    'roi_percent', 'days_held', 'status', 'has_unknown_cost'],
  rows: rows.map(row => {
    const [unit, roi] = saleDerivedCells(row)
    return [row.sale_date, row.product.name, row.product.set_name, row.product.game.name, row.product.product_type.name,
      row.product.language, row.marketplace, row.sold_by_member_id ? members.get(row.sold_by_member_id) : null,
      row.quantity, row.amount, row.platform_fees, row.payment_fees, row.shipping_paid, row.net_proceeds,
      row.has_unknown_cost ? null : row.cost_basis, unit, row.has_unknown_cost ? null : row.realized_profit,
      roi, row.days_held_weighted, row.status, row.has_unknown_cost ? 'true' : 'false']
  }) }
}
