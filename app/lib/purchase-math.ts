import { decimalCents } from './money-drafts'
import { parseIntegerQuantity } from './product-drafts'

/** Ontario HST. Shipping on taxable goods is taxed too, so it is part of the base. */
export const ONTARIO_HST_PERCENT = 13n

function centsText(cents: bigint): string {
  const whole = cents / 100n
  const fraction = cents % 100n
  return `${whole}.${fraction.toString().padStart(2, '0')}`
}

function optionalCents(value: string): bigint | null {
  return value.trim() === '' ? 0n : decimalCents(value.trim())
}

/** Quantity times the price of one, as the "Total paid" string, or null if either is not usable. */
export function totalFromEach(quantity: string, each: string): string | null {
  const units = parseIntegerQuantity(quantity, { positive: true })
  const cents = decimalCents(each.trim())
  if (units === null || cents === null) return null
  return centsText(BigInt(units) * cents)
}

/** Ontario HST on what was paid plus shipping, rounded half up to the cent. */
export function ontarioHst(amount: string, shipping: string): string | null {
  const paid = decimalCents(amount.trim())
  const shipped = optionalCents(shipping)
  if (paid === null || shipped === null) return null
  return centsText(((paid + shipped) * ONTARIO_HST_PERCENT + 50n) / 100n)
}

/** Everything that left the account: total paid, shipping, tax and fees. */
export function purchaseGrandTotal(amount: string, shipping: string, tax: string, fees: string): string | null {
  const paid = decimalCents(amount.trim())
  const extras = [shipping, tax, fees].map(optionalCents)
  if (paid === null || extras.some((cents) => cents === null)) return null
  return centsText(extras.reduce<bigint>((sum, cents) => sum + cents!, paid))
}
