import type { CardLookup, PricedListing, ProductCandidate, ReadCard } from './api'
import { decimalCents } from './money-drafts'

/**
 * One card found during a scan session. The camera names it, the catalog prices it, and
 * the person can change either before anything is written.
 */
export interface ScanItem {
  key: string
  name: string
  /** As read off the card, until the catalog names the set it resolved to. */
  setName: string
  collectorNumber: string
  variant: string
  language: string
  quantity: number
  /** CAD per copy, as a decimal string. Empty when there is no price yet. */
  price: string
  /** What the owner actually paid per copy. Never populated from a market quote. */
  paidEach: string
  status: 'pricing' | 'priced' | 'unpriced'
  message: string | null
  /** Every card must be explicitly reviewed before it can be saved. */
  reviewed: boolean
  candidates: PricedListing[]
  catalogSetName: string | null
  /** The catalog listing the price came from, so an added product can be mapped to it. */
  listing: { productId: number; groupId: number; categoryId: number; subtype: string } | null
}

export type ScanAction =
  | { type: 'seen'; cards: ReadCard[] }
  | { type: 'priced'; key: string; lookup: CardLookup }
  | { type: 'failed'; key: string; message: string }
  | { type: 'quantity'; key: string; delta: number }
  | { type: 'price'; key: string; price: string }
  | { type: 'paid'; key: string; paidEach: string }
  | { type: 'identity'; key: string; field: 'name' | 'setName' | 'collectorNumber' | 'variant' | 'language'; value: string }
  | { type: 'listing'; key: string; index: number }
  | { type: 'reviewed'; key: string }
  | { type: 'remove'; key: string }
  | { type: 'clear' }

function normal(value: string | null | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase().replace(/\s+/g, ' ')
}

/** "057/191" and "57/191" are the same card; the printed total is not part of the identity. */
function cardNumber(value: string | null | undefined): string {
  const [number] = normal(value).split('/')
  return number.replace(/^0+(?=\d)/, '')
}

/**
 * The same card is in frame for several seconds, so a session identifies it by name, set and
 * number. A second copy is a tap on +, never a second read of the same card.
 */
export function scanKey(card: Pick<ReadCard, 'name' | 'set_name' | 'collector_number'>): string {
  return [normal(card.name), normal(card.set_name), cardNumber(card.collector_number)].join('|')
}

/** The cards in this read that the session has not already got, each once. */
export function newCards(items: readonly ScanItem[], cards: readonly ReadCard[]): ReadCard[] {
  const known = new Set(items.map((item) => item.key))
  const fresh: ReadCard[] = []
  for (const card of cards) {
    const key = scanKey(card)
    if (!card.name.trim() || known.has(key)) continue
    known.add(key)
    fresh.push(card)
  }
  return fresh
}

function priced(item: ScanItem, lookup: CardLookup): ScanItem {
  const chosen = lookup.suggested_index === null ? undefined : lookup.candidates[lookup.suggested_index]
  if (!chosen) {
    return {
      ...item,
      status: 'unpriced',
      candidates: lookup.candidates,
      catalogSetName: lookup.set_name,
      message: lookup.message ?? (lookup.candidates.length
        ? 'Several listings fit. Choose the right one.'
        : 'No catalog listing found. Enter the price.'),
    }
  }
  return {
    ...item,
    setName: lookup.set_name ?? item.setName,
    collectorNumber: item.collectorNumber || chosen.listing.number || '',
    variant: chosen.subtype,
    // A price the person already typed wins over one that arrived after it.
    price: item.price || chosen.market || '',
    status: chosen.market ? 'priced' : 'unpriced',
    candidates: lookup.candidates,
    catalogSetName: lookup.set_name,
    message: chosen.market ? null : (lookup.message ?? 'The catalog has no price for this printing.'),
    listing: {
      productId: chosen.listing.product_id,
      groupId: chosen.listing.group_id,
      categoryId: chosen.listing.category_id,
      subtype: chosen.subtype,
    },
  }
}

export function scanReducer(items: ScanItem[], action: ScanAction): ScanItem[] {
  switch (action.type) {
    case 'seen':
      return [
        ...newCards(items, action.cards).map((card): ScanItem => ({
          key: scanKey(card),
          name: card.name.trim(),
          setName: card.set_name.trim(),
          collectorNumber: card.collector_number.trim(),
          variant: card.variant.trim(),
          language: card.language.trim(),
          quantity: 1,
          price: '',
          paidEach: '',
          status: 'pricing',
          message: null,
          reviewed: false,
          candidates: [],
          catalogSetName: null,
          listing: null,
        })),
        ...items,
      ]
    case 'priced':
      return items.map((item) => item.key === action.key ? priced(item, action.lookup) : item)
    case 'failed':
      return items.map((item) => item.key === action.key
        ? { ...item, status: 'unpriced', message: action.message }
        : item)
    case 'quantity':
      return items.flatMap((item) => {
        if (item.key !== action.key) return [item]
        const quantity = item.quantity + action.delta
        return quantity > 0 ? [{ ...item, quantity }] : []
      })
    case 'price':
      return items.map((item) => item.key === action.key ? { ...item, price: action.price } : item)
    case 'paid':
      return items.map((item) => item.key === action.key ? { ...item, paidEach: action.paidEach } : item)
    case 'identity':
      return items.map((item) => item.key === action.key
        ? {
          ...item,
          [action.field]: action.value,
          price: '',
          status: 'unpriced',
          message: 'Identity changed. Choose a catalog match or enter a market estimate.',
          listing: null,
          reviewed: false,
        }
        : item)
    case 'listing':
      return items.map((item) => {
        if (item.key !== action.key) return item
        const chosen = item.candidates[action.index]
        if (!chosen) return item
        return {
          ...item,
          name: chosen.listing.name,
          setName: item.catalogSetName ?? item.setName,
          collectorNumber: chosen.listing.number ?? item.collectorNumber,
          variant: chosen.subtype,
          price: chosen.market ?? '',
          status: chosen.market ? 'priced' : 'unpriced',
          message: chosen.market ? null : 'The catalog has no price for this printing.',
          listing: {
            productId: chosen.listing.product_id,
            groupId: chosen.listing.group_id,
            categoryId: chosen.listing.category_id,
            subtype: chosen.subtype,
          },
          reviewed: false,
        }
      })
    case 'reviewed':
      return items.map((item) => item.key === action.key ? { ...item, reviewed: true } : item)
    case 'remove':
      return items.filter((item) => item.key !== action.key)
    case 'clear':
      return []
  }
}

function centsText(cents: bigint): string {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
}

/** Market value of the whole session, in exact cents. Unpriced rows count as nothing. */
export function scanTotal(items: readonly ScanItem[]): string {
  let total = 0n
  for (const item of items) {
    const cents = decimalCents(item.price.trim())
    if (cents !== null) total += cents * BigInt(item.quantity)
  }
  return centsText(total)
}

/** Direct inventory adds need an explicit paid cost; a catalog quote is never a purchase cost. */
export function scanReadyError(items: readonly ScanItem[]): string | null {
  const reviewError = scanReviewError(items)
  if (reviewError) return reviewError
  const missing = items.find((item) => decimalCents(item.paidEach.trim()) === null)
  return missing ? `Enter what you paid for ${missing.name}.` : null
}

/** Scanned identity and any suggested catalog printing require a human confirmation. */
export function scanReviewError(items: readonly ScanItem[]): string | null {
  if (!items.length) return 'Scan at least one card.'
  if (items.some((item) => item.status === 'pricing')) return 'Still pricing a card.'
  const ambiguous = items.find((item) => item.candidates.length > 0 && !item.listing)
  if (ambiguous) return `Choose the catalog match for ${ambiguous.name}.`
  const unreviewed = items.find((item) => !item.reviewed)
  return unreviewed ? `Review ${unreviewed.name} before saving.` : null
}

/** What a row costs as one purchase: user-entered paid price times copies, in exact cents. */
export function lineTotal(item: Pick<ScanItem, 'paidEach' | 'quantity'>): string | null {
  const cents = decimalCents(item.paidEach.trim())
  return cents === null ? null : centsText(cents * BigInt(item.quantity))
}

const SINGLE_TYPES = ['raw-single', 'single']

/**
 * The raw single already on file for this card, if exactly one fits. Name, set and number
 * must agree; without a number the variant must too. Graded copies are never reused.
 */
export function matchingProduct(
  candidates: readonly ProductCandidate[],
  item: Pick<ScanItem, 'name' | 'setName' | 'collectorNumber' | 'variant'>,
): ProductCandidate | null {
  const numberedWithoutPrinting = Boolean(cardNumber(item.collectorNumber)) && !normal(item.variant)
  const fits = candidates.filter((candidate) =>
    SINGLE_TYPES.includes(candidate.product_type.slug) &&
    !candidate.grading_company && !candidate.grade && !candidate.cert_number &&
    normal(candidate.name) === normal(item.name) &&
    normal(candidate.set_name) === normal(item.setName) &&
    cardNumber(candidate.collector_number) === cardNumber(item.collectorNumber) &&
    (numberedWithoutPrinting || normal(candidate.variant) === normal(item.variant)))
  return fits.length === 1 ? fits[0] : null
}
