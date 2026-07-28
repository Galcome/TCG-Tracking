/**
 * Display formatting.
 *
 * Money arrives as a decimal string and is only ever *formatted* here - never re-derived.
 * Intl.NumberFormat does the rendering, so there is no hand-rolled arithmetic to get wrong.
 */

const CURRENCY = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  currencyDisplay: 'narrowSymbol',
})

const CURRENCY_COMPACT = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  currencyDisplay: 'narrowSymbol',
  maximumFractionDigits: 0,
})

/** "150.00" -> "$150.00". null renders as "Unknown", never as zero. */
export function money(value: string | null | undefined, fallback = 'Unknown'): string {
  if (value === null || value === undefined) return fallback
  return CURRENCY.format(Number(value))
}

/** Same, but without cents - for large headline figures. */
export function moneyCompact(value: string | null | undefined, fallback = 'Unknown'): string {
  if (value === null || value === undefined) return fallback
  return CURRENCY_COMPACT.format(Number(value))
}

/** Signed, so a profit reads "+$70.00" and a loss "-$12.00". */
export function signedMoney(value: string | null | undefined, fallback = 'Unknown'): string {
  if (value === null || value === undefined) return fallback
  const amount = Number(value)
  return `${amount > 0 ? '+' : ''}${CURRENCY.format(amount)}`
}

export function percent(value: number | null | undefined, fallback = '—'): string {
  if (value === null || value === undefined) return fallback
  return `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
}

export function shortDate(value: string | null | undefined): string {
  if (!value) return 'No date'
  // Parse as calendar parts, not UTC: "2026-03-14" must not drift a day westward.
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function todayIso(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** "opening_inventory" -> "Opening inventory" */
export function humanise(value: string): string {
  const spaced = value.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Tailwind colour class for a signed figure. */
export function toneFor(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return 'text-(--color-muted)'
  const amount = typeof value === 'string' ? Number(value) : value
  if (amount > 0) return 'text-(--color-gain)'
  if (amount < 0) return 'text-(--color-loss)'
  return ''
}
