import type { GroupBy, GroupRow } from './api'

/** Format the API's CAD decimal string without passing it through an imprecise Number. */
export function reportMoney(value: string | null | undefined, fallback = 'Unknown'): string {
  if (value === null || value === undefined) return fallback

  const match = value.trim().match(/^([+-]?)(\d+)(?:\.(\d+))?$/)
  if (!match) return fallback

  const [, sign, rawInteger, rawFraction = ''] = match
  const integer = rawInteger.replace(/^0+(?=\d)/, '') || '0'
  const fraction = rawFraction.slice(0, 2).padEnd(2, '0')
  const negative = sign === '-' && (integer !== '0' || fraction !== '00')
  return `${negative ? '-' : ''}$${groupInteger(integer)}.${fraction}`
}

/** Exact `left - right` for the API's two-decimal money strings, in integer cents. */
export function minus(left: string, right: string): string {
  const cents = BigInt(left.replace('.', '')) - BigInt(right.replace('.', ''))
  const size = cents < 0n ? -cents : cents
  return `${cents < 0n ? '-' : ''}${size / 100n}.${(size % 100n).toString().padStart(2, '0')}`
}

/** What takes a period's revenue down to its trading profit, in the order it comes off. */
export function tradingDeductions(figures: { uncosted_revenue: string; sale_fees: string; cost_of_sales: string }) {
  const zero = (value: string) => minus(value, '0.00') === '0.00'
  return [
    ...(zero(figures.uncosted_revenue) ? [] : [{ label: 'Sales with no cost recorded', amount: figures.uncosted_revenue }]),
    ...(zero(figures.sale_fees) ? [] : [{ label: 'Fees and shipping', amount: figures.sale_fees }]),
    { label: 'Cost of the stock sold', amount: figures.cost_of_sales },
  ]
}

/** The sum behind a trading profit, spelled out: "$10.00 revenue − $4.00 cost of the stock sold = $6.00 trading profit". */
export function tradingSum(figures: { revenue: string; realized_profit: string; uncosted_revenue: string; sale_fees: string; cost_of_sales: string }): string {
  const parts = [`${reportMoney(figures.revenue)} revenue`, ...tradingDeductions(figures).map(line => `${reportMoney(line.amount)} ${line.label.toLowerCase()}`)]
  return `${parts.join(' − ')} = ${reportMoney(figures.realized_profit)} trading profit`
}

export const REPORT_GROUPS: readonly {
  value: GroupBy
  label: string
  noun: string
}[] = [
  { value: 'game', label: 'Game', noun: 'game' },
  { value: 'product', label: 'Product', noun: 'product' },
  { value: 'product-type', label: 'Type', noun: 'product type' },
  { value: 'set-performance', label: 'Set', noun: 'set' },
  { value: 'marketplace', label: 'Channel', noun: 'channel' },
  { value: 'seller', label: 'Seller', noun: 'seller' },
]

export type ReportSort = 'profit' | 'roi' | 'perDay' | 'days'

export const REPORT_SORTS: readonly { value: ReportSort; label: string }[] = [
  { value: 'profit', label: 'Profit' },
  { value: 'roi', label: 'ROI' },
  { value: 'perDay', label: '$/day' },
  { value: 'days', label: 'Days held' },
]

/** Compare signed decimal strings without converting money to an imprecise float. */
export function compareDecimalStrings(left: string, right: string): number {
  const a = normaliseDecimal(left)
  const b = normaliseDecimal(right)
  if (a.sign !== b.sign) return a.sign > b.sign ? 1 : -1

  const magnitude = compareMagnitude(a.integer, a.fraction, b.integer, b.fraction)
  return a.sign < 0 ? -magnitude : magnitude
}

/**
 * Sort report rows for display. Null server values stay unknown and are placed after known
 * values; zero remains a real value and therefore sorts normally. This only orders rows and
 * never creates financial totals on the client.
 */
export function sortGroupRows(rows: GroupRow[], sort: ReportSort): GroupRow[] {
  const list = rows.slice()
  list.sort((left, right) => {
    if (sort === 'profit') {
      return compareDecimalStrings(right.realized_profit, left.realized_profit)
    }
    if (sort === 'perDay') {
      return compareNullableDecimalDescending(left.profit_per_day, right.profit_per_day)
    }
    if (sort === 'roi') {
      return compareNullableNumberDescending(left.roi, right.roi)
    }
    return compareNullableNumber(left.avg_days_held, right.avg_days_held)
  })
  return list
}

/** "2026-08-01" -> "Aug"; include a short year when the month is January. */
export function monthLabel(iso: string): string {
  const when = new Date(`${iso}T00:00:00`)
  return when.toLocaleDateString(undefined, {
    month: 'short',
    ...(when.getMonth() === 0 ? { year: '2-digit' } : {}),
  })
}

interface DecimalParts {
  sign: -1 | 1
  integer: string
  fraction: string
}

function normaliseDecimal(value: string): DecimalParts {
  const trimmed = value.trim()
  const negative = trimmed.startsWith('-')
  const unsigned = negative || trimmed.startsWith('+') ? trimmed.slice(1) : trimmed
  const [integerPart = '0', fractionPart = ''] = unsigned.split('.', 2)
  const integer = integerPart.replace(/^0+(?=\d)/, '') || '0'
  const fraction = fractionPart.replace(/0+$/, '')
  const isZero = integer === '0' && fraction.length === 0
  return { sign: negative && !isZero ? -1 : 1, integer, fraction }
}

function groupInteger(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function compareMagnitude(
  leftInteger: string,
  leftFraction: string,
  rightInteger: string,
  rightFraction: string,
): number {
  if (leftInteger.length !== rightInteger.length) {
    return leftInteger.length > rightInteger.length ? 1 : -1
  }
  if (leftInteger !== rightInteger) return leftInteger > rightInteger ? 1 : -1

  const width = Math.max(leftFraction.length, rightFraction.length)
  const left = leftFraction.padEnd(width, '0')
  const right = rightFraction.padEnd(width, '0')
  if (left === right) return 0
  return left > right ? 1 : -1
}

function compareNullableDecimalDescending(
  left: string | null,
  right: string | null,
): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return compareDecimalStrings(right, left)
}

function compareNullableNumber(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return left === right ? 0 : left > right ? 1 : -1
}

function compareNullableNumberDescending(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return left === right ? 0 : left > right ? -1 : 1
}
