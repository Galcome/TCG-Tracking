import { BUCKETS, type Bucket, type CombineLine, type Product } from './api'

/** One row of the combine form: a product, the bucket it comes out of, and how many. */
export interface CombineDraftLine {
  product_id: string
  name: string
  game_id: string
  bucket: Bucket
  /** Typed text, so a half-edited number never jumps. */
  quantity: string
  /** What each bucket held when the row was added, for the bucket picker. */
  held: Record<Bucket, number>
}

/** "one" takes a single copy of each product; "all" takes every copy, from every bucket. */
export type AddMode = 'one' | 'all'

export const lineKey = (line: { product_id: string; bucket: Bucket }) => line.product_id + ':' + line.bucket

/** The rows a product adds. Nothing on hand adds nothing. */
export function linesFor(product: Product, mode: AddMode): CombineDraftLine[] {
  const held = product.stats.by_bucket
  const buckets = BUCKETS.filter(bucket => (held[bucket] ?? 0) > 0)
  const chosen = mode === 'all' ? buckets : buckets.slice(0, 1)
  return chosen.map(bucket => ({
    product_id: product.id,
    name: product.name,
    game_id: product.game.id,
    bucket,
    quantity: String(mode === 'all' ? held[bucket] : 1),
    held,
  }))
}

/** Adds products to the selection. A product already in it is left exactly as it is. */
export function addProducts(lines: CombineDraftLine[], products: Product[], mode: AddMode): CombineDraftLine[] {
  const chosen = new Set(lines.map(line => line.product_id))
  const added = products.filter(product => !chosen.has(product.id)).flatMap(product => linesFor(product, mode))
  return added.length ? [...lines, ...added] : lines
}

export function combineQuantity(text: string): number | null {
  return /^\d{1,6}$/.test(text.trim()) && Number(text) > 0 ? Number(text) : null
}

/** What goes to the server, or null while any row's quantity is not a whole number. */
export function combineInputs(lines: CombineDraftLine[]): CombineLine[] | null {
  const inputs: CombineLine[] = []
  for (const line of lines) {
    const quantity = combineQuantity(line.quantity)
    if (quantity === null) return null
    inputs.push({ product_id: line.product_id, bucket: line.bucket, quantity })
  }
  return inputs
}

/** The game the bundle defaults to: the one every row shares, else null and the form asks. */
export function sharedGame(lines: CombineDraftLine[]): string | null {
  const games = new Set(lines.map(line => line.game_id))
  return games.size === 1 ? [...games][0] : null
}

/** Moving a row to a bucket another row of the same product already uses would duplicate it. */
export function bucketsFree(lines: CombineDraftLine[], line: CombineDraftLine): Bucket[] {
  const taken = new Set(lines.filter(other => other.product_id === line.product_id && other.bucket !== line.bucket).map(other => other.bucket))
  return BUCKETS.filter(bucket => !taken.has(bucket) && ((line.held[bucket] ?? 0) > 0 || bucket === line.bucket))
}
