import type { Transaction } from './api'
import { isMoneyString } from './product-drafts'

/** Past this, a row per unit is not a form anyone fills in; one price for all still works. */
export const MAX_INDIVIDUAL_UNITS = 50

/** One unit of an open purchase, with what it cost before shipping, tax and fees. */
export interface CostUnit {
  purchaseId: string
  cost: string
}

/** What to send for one purchase: a new total, or a price per unit when they differ. */
export type CostChange =
  | { purchaseId: string; kind: 'total'; amount: string }
  | { purchaseId: string; kind: 'units'; unitCosts: string[] }

// Exact integer cents from an API decimal string, so no price ever passes through a float.
export function toCents(value: string): number {
  const [whole, fraction = ''] = value.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}

export function fromCents(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

/** Purchases whose cost can still be corrected. */
export function openPurchases(history: Transaction[]): Transaction[] {
  return history.filter((entry) => entry.kind === 'purchase' && entry.status === 'active')
}

/** Every unit of every open purchase. An uneven total gives its odd cents to the first units. */
export function costUnits(purchases: Transaction[]): CostUnit[] {
  return purchases.flatMap((purchase) => {
    const total = toCents(purchase.base_amount ?? '0')
    const each = Math.floor(total / purchase.quantity)
    const extra = total % purchase.quantity
    return Array.from({ length: purchase.quantity }, (_, index) => ({
      purchaseId: purchase.id,
      cost: fromCents(each + (index < extra ? 1 : 0)),
    }))
  })
}

export function costError(costs: string[]): string | null {
  return costs.every((cost) => isMoneyString(cost.trim(), true)) ? null : 'Enter each cost as dollars and cents, like 175.09.'
}

/** Only the purchases whose units were actually repriced, each as the smallest change. */
export function costChanges(units: CostUnit[], costs: string[]): CostChange[] {
  const changes: CostChange[] = []
  const ids = [...new Set(units.map((unit) => unit.purchaseId))]
  for (const purchaseId of ids) {
    const before: number[] = []
    const after: number[] = []
    units.forEach((unit, index) => {
      if (unit.purchaseId !== purchaseId) return
      before.push(toCents(unit.cost))
      after.push(toCents(costs[index].trim()))
    })
    if (after.every((cents, index) => cents === before[index])) continue
    if (after.every((cents) => cents === after[0])) {
      changes.push({ purchaseId, kind: 'total', amount: fromCents(after[0] * after.length) })
    } else {
      changes.push({ purchaseId, kind: 'units', unitCosts: after.map(fromCents) })
    }
  }
  return changes
}
