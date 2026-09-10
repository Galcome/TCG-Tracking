import { BUCKETS, type Bucket, type ProductDetail } from './api'
import { isIsoDate } from './product-drafts'
import { canCrack } from './product-types'

export interface CrackSplit {
  inventory: string
  store: string
  vault: string
}

export interface CrackDraft {
  sourceProductId: string
  sourceQuantity: string
  childrenPerSource: string
  fromBucket: Bucket | ''
  childProductId: string
  childName: string
  childTypeId: string
  gameId: string
  language: string
  split: CrackSplit
  occurredOn: string
}

export interface CrackValidation {
  sourceQuantity?: string
  childrenPerSource?: string
  fromBucket?: string
  childProductId?: string
  childName?: string
  childTypeId?: string
  gameId?: string
  language?: string
  split?: string
  occurredOn?: string
  [field: string]: string | undefined
}

export interface CrackOutput {
  product_id: string
  quantity: number
  bucket: Bucket
}

export interface CrackPayload {
  product_id: string
  quantity: number
  from_bucket: Bucket
  outputs: CrackOutput[]
  occurred_on: string
}

export const EMPTY_CRACK_SPLIT: CrackSplit = {
  inventory: '',
  store: '',
  vault: '',
}

function parseInteger(value: string, positive = false): number | null {
  const rendered = value.trim()
  if (!/^\d+$/.test(rendered)) return null
  const parsed = Number(rendered)
  if (!Number.isSafeInteger(parsed) || (positive && parsed < 1)) return null
  return parsed
}

export function crackInteger(value: string, positive = false): number | null {
  return parseInteger(value, positive)
}

export function crackTotal(sourceQuantity: string, childrenPerSource: string): number | null {
  const source = parseInteger(sourceQuantity, true)
  const children = parseInteger(childrenPerSource, true)
  if (source === null || children === null) return null
  const total = BigInt(source) * BigInt(children)
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null
}

export function crackWords(productTypeSlug: string | undefined): {
  source: string
  sources: string
  child: string
  children: string
} | null {
  if (productTypeSlug === 'sealed-case') return { source: 'case', sources: 'cases', child: 'box', children: 'boxes' }
  if (productTypeSlug === 'booster-box') return { source: 'box', sources: 'boxes', child: 'pack', children: 'packs' }
  if (canCrack(productTypeSlug)) return { source: 'container', sources: 'containers', child: 'item', children: 'items' }
  return null
}

export function crackSplitTotal(split: CrackSplit): number | null {
  let total = 0
  for (const bucket of BUCKETS) {
    const value = parseInteger(split[bucket])
    if (split[bucket].trim() !== '' && value === null) return null
    if (value !== null) {
      total += value
      if (!Number.isSafeInteger(total)) return null
    }
  }
  return total
}

export function crackOutputs(
  draft: Pick<CrackDraft, 'sourceQuantity' | 'childrenPerSource' | 'fromBucket' | 'split'>,
  childProductId: string,
): { total: number; allocated: number; outputs: CrackOutput[]; untouched: boolean } | null {
  const total = crackTotal(draft.sourceQuantity, draft.childrenPerSource)
  const allocated = crackSplitTotal(draft.split)
  if (total === null || allocated === null || !draft.fromBucket || !childProductId) return null
  const untouched = allocated === 0
  const outputs = untouched
    ? [{ product_id: childProductId, quantity: total, bucket: draft.fromBucket }]
    : BUCKETS.filter((bucket) => parseInteger(draft.split[bucket]) !== null && parseInteger(draft.split[bucket])! > 0)
      .map((bucket) => ({ product_id: childProductId, quantity: parseInteger(draft.split[bucket])!, bucket }))
  return { total, allocated, outputs, untouched }
}

export function validateCrackDraft(
  draft: Partial<CrackDraft>,
  product?: Pick<ProductDetail, 'id' | 'stats'>,
): CrackValidation {
  const errors: CrackValidation = {}
  const total = crackTotal(draft.sourceQuantity ?? '', draft.childrenPerSource ?? '')
  if (parseInteger(draft.sourceQuantity ?? '', true) === null) errors.sourceQuantity = 'Enter a whole number greater than zero.'
  if (parseInteger(draft.childrenPerSource ?? '', true) === null) errors.childrenPerSource = 'Enter a whole number greater than zero.'
  if (!draft.fromBucket) errors.fromBucket = 'Choose where the source stock is held.'
  if (!draft.sourceProductId) errors.sourceProductId = 'Choose a source product.'
  if (product && draft.childProductId === product.id) errors.childProductId = 'The source cannot also be the child product.'
  if (!draft.childProductId) {
    if (!draft.childName?.trim()) errors.childName = 'Give the new child product a name.'
    if (!draft.childTypeId) errors.childTypeId = 'Choose the child product type.'
    if (!draft.gameId) errors.gameId = 'Choose the child product game.'
    if (!draft.language?.trim()) errors.language = 'Choose or enter the child language.'
  }
  const allocated = crackSplitTotal(draft.split ?? EMPTY_CRACK_SPLIT)
  if (allocated === null) errors.split = 'Use whole numbers of zero or more for each bucket.'
  else if (total !== null && allocated !== 0 && allocated !== total) errors.split = `The split adds up to ${allocated}, but ${total} children come out.`
  if (draft.fromBucket && product && parseInteger(draft.sourceQuantity ?? '', true) !== null) {
    const available = product.stats.by_bucket[draft.fromBucket] ?? 0
    const quantity = parseInteger(draft.sourceQuantity ?? '', true)!
    if (quantity > available) errors.sourceQuantity = `${draft.fromBucket} only holds ${available}.`
  }
  if (!draft.occurredOn || !isIsoDate(draft.occurredOn)) errors.occurredOn = 'Enter a date in YYYY-MM-DD format.'
  return errors
}

export function buildCrackPayload(draft: CrackDraft, childProductId: string, product?: Pick<ProductDetail, 'id' | 'stats'>): CrackPayload | null {
  const candidate = { ...draft, childProductId }
  if (Object.keys(validateCrackDraft(candidate, product)).length > 0) return null
  const result = crackOutputs(draft, childProductId)
  if (!result || (!result.untouched && result.allocated !== result.total)) return null
  return {
    product_id: draft.sourceProductId,
    quantity: parseInteger(draft.sourceQuantity, true)!,
    from_bucket: draft.fromBucket as Bucket,
    outputs: result.outputs,
    occurred_on: draft.occurredOn,
  }
}
