import type { AgingLot } from './api'

export const AGING_BANDS = [
  { key: '0-30', label: '0–30 days', maximum: 30 },
  { key: '31-90', label: '31–90 days', maximum: 90 },
  { key: '91-180', label: '91–180 days', maximum: 180 },
  { key: '180-plus', label: '180+ days', maximum: null },
] as const

export type AgingBandKey = (typeof AGING_BANDS)[number]['key'] | 'unknown'

const UNKNOWN_AGE_BAND = { key: 'unknown' as const, label: 'Unknown age', maximum: null }

/** Return the server-compatible age bucket without making assumptions about unknown dates. */
export function agingBandFor(days: number | null): AgingBandKey {
  if (days === null || !Number.isFinite(days)) return 'unknown'
  return AGING_BANDS.find((band) => band.maximum !== null && days <= band.maximum)?.key ?? '180-plus'
}

export function agingBandLabel(days: number | null): string {
  const key = agingBandFor(days)
  return [...AGING_BANDS, UNKNOWN_AGE_BAND].find((band) => band.key === key)?.label ?? 'Unknown age'
}

export function agingDescription(days: number | null): string {
  return days === null ? 'Unknown age' : `${days}d held`
}

export function purchaseDateDescription(purchaseDate: string | null): string {
  return purchaseDate === null ? 'no purchase date' : `bought ${purchaseDate}`
}

/** Group lots in the stable display order used by the ageing report. */
export function groupAgingLots(lots: AgingLot[]): { key: AgingBandKey; label: string; lots: AgingLot[] }[] {
  const grouped = new Map<AgingBandKey, AgingLot[]>()
  for (const lot of lots) {
    const key = agingBandFor(lot.days_held)
    const rows = grouped.get(key)
    if (rows) rows.push(lot)
    else grouped.set(key, [lot])
  }

  return [...AGING_BANDS, UNKNOWN_AGE_BAND]
    .map((band) => ({ key: band.key, label: band.label, lots: grouped.get(band.key) ?? [] }))
    .filter((band) => band.lots.length > 0)
}
