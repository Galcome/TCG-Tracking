/**
 * Typed API client.
 *
 * Firebase ID tokens expire hourly. getIdToken() returns the cached token and refreshes it
 * automatically near expiry, so it is called per request rather than held in state.
 *
 * Money arrives and leaves as decimal strings ("150.00"). Nothing here converts it to a
 * number - JavaScript floats cannot hold money exactly, and the server already did the
 * arithmetic. Formatting for display is the only thing the client does with it.
 */

import { config } from './config'
import { auth } from './firebase'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const user = auth.currentUser
  if (!user) {
    throw new ApiError(401, 'Not signed in')
  }

  const token = await user.getIdToken()
  // FormData sets its own Content-Type, including the multipart boundary. Forcing JSON
  // here would produce a body the server cannot parse and an error nobody could read.
  const isUpload = init.body instanceof FormData
  const response = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers: {
      ...(isUpload ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  })

  if (!response.ok) {
    throw new ApiError(response.status, await errorMessage(response))
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json()
    if (typeof body.detail === 'string') return body.detail
    // FastAPI validation errors arrive as a list of {loc, msg}.
    if (Array.isArray(body.detail)) {
      return body.detail
        .map((item: { msg?: string }) => item.msg)
        .filter(Boolean)
        .join(', ')
    }
  } catch {
    // Fall through to the status text.
  }
  return response.statusText || 'Request failed'
}

export interface Taxonomy {
  id: string
  name: string
  slug: string
  is_system: boolean
  sort_order: number
}

export interface Member {
  id: string
  display_name: string
  role: string
  is_active: boolean
}

/** Where stock sits. Intent, not a place — all three can be the same basement. */
export const BUCKETS = ['inventory', 'store', 'vault'] as const
export type Bucket = (typeof BUCKETS)[number]

export const BUCKET_LABELS: Record<Bucket, string> = {
  inventory: 'Inventory',
  store: 'Store',
  vault: 'Vault',
}

/** All money fields are decimal strings. `null` means genuinely unknown. */
export interface ProductStats {
  quantity_purchased: number
  quantity_sold: number
  quantity_adjusted: number
  quantity_on_hand: number
  total_invested: string
  remaining_cost: string
  cost_of_sales: string
  cost_written_off: string
  gross_revenue: string
  net_proceeds: string
  realized_profit: string
  average_unit_cost: string | null
  roi: number | null
  sale_count: number
  sales_missing_cost: number
  /** Sums to quantity_on_hand — a move takes from one bucket and gives to another. */
  by_bucket: Record<Bucket, number>
}

export interface Transaction {
  kind: 'purchase' | 'sale' | 'adjustment' | 'move'
  id: string
  occurred_on: string | null
  quantity: number
  /** Where the row acted. A move also carries from_bucket; nothing else does. */
  bucket: Bucket | null
  from_bucket: Bucket | null
  /** For a purchase this is the landed total — display it, but never PATCH it back. */
  amount: string | null
  /** Purchases only: the editable components behind `amount`. */
  base_amount: string | null
  shipping: string | null
  tax: string | null
  fees: string | null
  /** Sales only: the deductions behind `amount`, which is gross. */
  platform_fees: string | null
  payment_fees: string | null
  shipping_paid: string | null
  cost: string | null
  profit: string | null
  has_unknown_cost: boolean
  member_id: string | null
  label: string | null
  notes: string | null
  status: string
}

export interface Product {
  id: string
  /** The set record behind `set_name`. */
  set_id?: string | null
  /** Japanese cases hold 20 boxes where English hold 6, so this drives the suggestion. */
  language?: string | null
  name: string
  game: Taxonomy
  product_type: Taxonomy
  set_name: string | null
  collector_number: string | null
  storage_location: string | null
  notes: string | null
  is_archived: boolean
  created_at: string
  stats: ProductStats
}

export interface ProductDetail extends Product {
  history: Transaction[]
}

export interface ProductPage {
  items: Product[]
  total: number
  limit: number
  offset: number
  /** Units per bucket across the whole match, before the bucket filter narrows it. */
  bucket_totals: Record<Bucket, number>
}

export interface Dashboard {
  realized_profit: string
  roi: number | null
  inventory_at_cost: string
  total_invested: string
  purchases_in_period: string
  cost_of_sales: string
  cost_written_off: string
  total_sales: string
  average_sale: string | null
  units_in_stock: number
  sale_count: number
  sales_missing_cost: number
  undated_sales: number
  products_with_negative_stock: number
  /**
   * Lifetime cash. These three ignore the period, because `total_invested` is already
   * all-time — pairing it with a period-scoped sales figure would subtract everything ever
   * spent from one month's takings. Negative `cash_balance` means the money is on the
   * shelf, not that it was lost.
   */
  net_proceeds: string
  fees_paid: string
  /** The part of `net_proceeds` that arrived as store credit rather than money. */
  store_credit: string
  cash_received: string
  cash_balance: string
}

export interface UnitsByAge {
  d0_30: number
  d31_90: number
  d91_180: number
  d180_plus: number
}

export interface GroupRow {
  key: string
  label: string
  realized_profit: string
  cost_of_sales: string
  revenue: string
  inventory_at_cost: string
  roi: number | null
  units_in_stock: number
  sale_count: number
  sales_missing_cost: number
  units_sold: number
  units_purchased: number
  avg_days_held: number | null
  sell_through: number | null
  profit_per_day: string | null
  units_by_age: UnitsByAge
}

export type GroupBy = 'game' | 'product' | 'product-type' | 'marketplace' | 'seller'

/** One purchase lot with units still on the shelf. `days_held` null means no known date. */
export interface AgingLot {
  purchase_id: string
  product_id: string
  product_name: string
  game_slug: string
  units: number
  cost: string
  purchase_date: string | null
  days_held: number | null
}

export interface ProductSummary {
  id: string
  name: string
  game: Taxonomy
  product_type: Taxonomy
}

/** A sale in the cross-product ledger. Money is a decimal string; null means unknown. */
export interface SaleRow {
  id: string
  product_id: string
  product: ProductSummary
  quantity: number
  amount: string
  platform_fees: string
  payment_fees: string
  shipping_paid: string
  net_proceeds: string
  cost_basis: string | null
  realized_profit: string | null
  has_unknown_cost: boolean
  days_held_weighted: number | null
  sale_date: string | null
  sold_by_member_id: string | null
  marketplace: string | null
  notes: string | null
  status: string
}

/**
 * A ledger sale seen as a history row, so the Sales list and the Dashboard can open the
 * same editor the product page uses instead of each growing their own.
 *
 * Quantity flips negative: a history row describes stock movement, and the editor turns it
 * back into a positive count.
 */
export function saleAsTransaction(sale: SaleRow): Transaction {
  return {
    kind: 'sale',
    id: sale.id,
    occurred_on: sale.sale_date,
    quantity: -sale.quantity,
    bucket: null,
    from_bucket: null,
    amount: sale.amount,
    base_amount: null,
    shipping: null,
    tax: null,
    fees: null,
    platform_fees: sale.platform_fees,
    payment_fees: sale.payment_fees,
    shipping_paid: sale.shipping_paid,
    cost: sale.cost_basis,
    profit: sale.realized_profit,
    has_unknown_cost: sale.has_unknown_cost,
    member_id: sale.sold_by_member_id,
    label: sale.marketplace,
    notes: sale.notes,
    status: sale.status,
  }
}

export interface SalePage {
  items: SaleRow[]
  total: number
  limit: number
  offset: number
}

/** What a sale would do, computed server-side so the client never does money maths. */
export interface SalePreview {
  quantity: number
  gross: string
  fees: string
  net_proceeds: string
  cost_basis: string | null
  realized_profit: string | null
  roi: number | null
  has_unknown_cost: boolean
  quantity_available: number
  quantity_remaining: number
  remaining_cost: string
  exceeds_stock: boolean
}

/**
 * The channels worth a one-tap chip, each with the cut it usually takes.
 *
 * There is no "Other" entry: the picker offers free text, and a sale filed under a literal
 * "Other" is a sale whose channel nobody can report on later. Anything not here is typed
 * in by name.
 *
 * ---
 *
 * **These rates are unverified, and they run low.** They were picked during the build and
 * checked against nothing. They are headline *commission* and omit payment processing —
 * TCGplayer takes roughly another 2.5% + $0.30, Whatnot roughly 2.9% + $0.30 — so the
 * suggestion understates the deduction, which overstates realized profit on every sale in
 * the same direction. An error that never averages out.
 *
 * They are a rule of thumb the person is expected to correct, and the field says so.
 *
 * **Awaiting Joseph's real figures**, taken from what the group actually gets deducted
 * including their seller tiers. When those land, replace these and record where each came
 * from and when it was checked — so the next person reads provenance instead of inventing
 * their own guess. Do not "improve" them with more research in the meantime: a
 * better-researched guess is still a guess.
 */
export const MARKETPLACES = [
  { name: 'eBay', feePercent: 13.25, colour: '#4cc4ff' },
  { name: 'TCGplayer', feePercent: 10.25, colour: '#a55eea' },
  { name: 'Whatnot', feePercent: 8, colour: '#ffb454' },
  { name: 'Facebook', feePercent: 5, colour: '#3ddc97' },
  { name: 'In person', feePercent: 0, colour: '#ffcb05' },
] as const

/** Only the two states where a displayed number is untrustworthy. Empty means sound. */
export interface Attention {
  sales_missing_cost: number
  products_with_negative_stock: number
  negative_stock_products: { id: string; name: string; quantity: number }[]
}

/**
 * A set worth offering for one game.
 *
 * `released_on` null means somebody typed it. A date means it came from the seeded
 * calendar, which is why a set can appear on its release day with nobody doing anything.
 */
export interface CardSet {
  id: string
  game_id: string
  name: string
  released_on: string | null
  uses: number
}

export interface SetSuggestions {
  items: CardSet[]
  /** The set this was probably meant to be. A question, never a correction. */
  did_you_mean: string | null
}

/**
 * How many boxes are in a sealed case.
 *
 * A suggestion, always shown and always editable - never silently applied. Size varies by
 * *language* and by product line, not by game alone: a Japanese Pokémon case is 20 boxes
 * against six for English, and One Piece Premium Booster cases are quoted at both 10 and
 * 12. A table keyed on the game would be wrong the first time somebody buys Japanese.
 *
 * Yu-Gi-Oh is deliberately absent: it was not confirmed, and a wrong default that nobody
 * checks is worse than no default at all.
 */
export const CASE_SIZES: { game: string; japanese?: boolean; boxes: number }[] = [
  { game: 'pokemon', boxes: 6 },
  { game: 'pokemon', japanese: true, boxes: 20 },
  { game: 'lorcana', boxes: 4 },
  { game: 'magic-the-gathering', boxes: 6 },
  { game: 'one-piece', boxes: 6 },
  { game: 'one-piece', japanese: true, boxes: 12 },
]

/** The suggested case size, or undefined when nobody has confirmed one. */
export function caseSize(gameSlug: string, language?: string | null): number | undefined {
  const japanese = (language ?? '').trim().toLowerCase().startsWith('jap')
  return CASE_SIZES.find((row) => row.game === gameSlug && Boolean(row.japanese) === japanese)
    ?.boxes
}

/**
 * How many packs are in a sealed booster box.
 *
 * A different question from the one above, and it needs its own table: a case holds *six*
 * Pokémon boxes, a box holds *thirty-six* packs. Offering 6 for a box - which is what
 * happened when one dialog served both jobs - suggests a number six times too small on a
 * screen whose whole purpose is splitting cost accurately.
 *
 * Same rules as case size: language matters, and anything unconfirmed is simply absent
 * rather than guessed.
 */
/**
 * The two languages the size tables distinguish.
 *
 * English is the default because it is nearly everything the group buys. Japanese exists
 * because it changes both suggestions substantially - 20 boxes a case against six, 30
 * packs a box against 36 - and getting that wrong on a case is a five-figure-quantity
 * error in the split.
 *
 * Deliberately not a full language list: nothing else changes a number, and a longer
 * dropdown is friction on the screen that has to stay fastest.
 */
export const LANGUAGES = ['English', 'Japanese'] as const

export const BOX_SIZES: { game: string; japanese?: boolean; packs: number }[] = [
  { game: 'pokemon', packs: 36 },
  { game: 'pokemon', japanese: true, packs: 30 },
  { game: 'lorcana', packs: 24 },
  { game: 'magic-the-gathering', packs: 36 },
  { game: 'one-piece', packs: 24 },
]

/** The suggested pack count for a box, or undefined when nobody has confirmed one. */
export function boxSize(gameSlug: string, language?: string | null): number | undefined {
  const japanese = (language ?? '').trim().toLowerCase().startsWith('jap')
  return BOX_SIZES.find((row) => row.game === gameSlug && Boolean(row.japanese) === japanese)
    ?.packs
}

export interface TransformationOutput {
  product_id: string
  product_name: string
  quantity: number
  bucket: Bucket
  /** This row's share of what the source cost. null when the source's cost is unknown. */
  cost: string | null
}

export interface RipHit {
  product_id: string
  quantity?: number
  bucket?: Bucket
  /** What it looked worth on the day. An estimate — it shares out the cost and is kept
   *  as a dated snapshot, and it never becomes cost basis or profit. */
  value?: string
  /** Overrides the proportional share. Whatever the hits leave is written off as bulk. */
  cost?: string
}

export interface GradingSubmission {
  id: string
  product_id: string
  product_name: string
  quantity: number
  bucket: Bucket
  grading_company: string | null
  sent_on: string
  fees: string
  status: 'out' | 'returned' | 'voided'
  returned_on: string | null
  grade: string | null
  /** How long it has been away, or how long it took. The number the flag exists for. */
  days_out: number
  notes: string | null
}

export interface Transformation {
  id: string
  kind: 'crack' | 'rip' | 'grade'
  source_product_id: string
  source_product_name: string
  source_quantity: number
  source_bucket: Bucket
  occurred_on: string | null
  /** What the outputs are dated from — the lot the source came out of, not the day it
   *  was opened. This is what stops cracking from resetting the ageing clock. */
  inherited_purchase_date: string | null
  source_cost: string | null
  /** What the hits did not take, written off as bulk where it happened. */
  bulk_cost: string
  outputs: TransformationOutput[]
  notes: string | null
  status: string
}

export interface TierRow {
  key: string
  label: string
  products_traded: number
  units_sold: number
  realized_profit: string
  cost_of_sales: string
  roi: number | null
  /** The average across products, and the spread around it. The spread is the point. */
  average_roi: number | null
  best_roi: number | null
  worst_roi: number | null
  median_roi: number | null
  avg_days_held: number | null
}

export interface SetRollupRow {
  set_id: string
  name: string
  game_slug: string
  units_sold: number
  realized_profit: string
  cost_of_sales: string
  sold_roi: number | null
  units_in_store: number
  store_cost: string
  /** Store only. The Vault is not asleep, it is parked on purpose. */
  oldest_store_days: number | null
  units_in_vault: number
  vault_cost: string
}

export interface LineageNode {
  product_id: string
  product_name: string
  depth: number
  quantity_produced: number
  cost: string | null
  children: LineageNode[]
}

export interface LineageRollup {
  product_id: string
  product_name: string
  /** What the root actually cost. The only money really spent on this chain. */
  cost: string
  realized_profit: string
  remaining_cost: string
  written_off: string
  units_sold: number
  units_remaining: number
  roi: number | null
  tree: LineageNode[]
}

export interface VaultHolding {
  product_id: string
  product_name: string
  units: number
  cost: string
  /** null means never valued, and it stays null — cost is not a substitute for worth. */
  value: string | null
  valued_on: string | null
  days_since_valued: number | null
  appreciation: string | null
  appreciation_pct: number | null
  /** Per year held, and only past a year. */
  annualised: number | null
  days_held: number | null
  /** How long it sat in the Store before being moved here. The loophole guard. */
  days_in_store_first: number | null
}

/** One card a photo turned up. Empty strings mean the model would not say. */
export interface ReadCard {
  name: string
  set_name: string
  variant: string
}

export interface ReadResult {
  /** False when no key is configured — the button is hidden rather than always failing. */
  available: boolean
  cards: ReadCard[]
}

export type Period = 'all' | 'ytd' | 'mtd' | '30d'

/**
 * A pot money sits in, or a person money is owed to.
 *
 * `balance_means` is on the wire on purpose: -500 on the joint account is a hole, and
 * -500 on a member account is that person holding the group's money. Reading a bare
 * number without knowing which is how a ledger gets misread.
 */
export interface Account {
  id: string
  kind: 'joint' | 'member' | 'store_credit'
  name: string
  member_id: string | null
  is_active: boolean
  balance: string
  balance_means: 'cash' | 'owed' | 'credit'
}

export interface AccountsPage {
  items: Account[]
  /** Three figures, never summed. Cash you have, money you owe, credit you can only
   *  spend at one shop — a single netted number hides whichever is the problem. */
  joint_balance: string
  total_owed: string
  total_credit: string
  /** Shops with credit left, for "$2,400 across 2 stores". */
  credit_stores: number
}

export type MovementKind = 'funding' | 'proceeds' | 'transfer' | 'adjustment'

export interface MovementLeg {
  account_id: string
  account_name: string
  account_kind: 'joint' | 'member' | 'store_credit'
  /** Signed cash flow through that account. Positive is money arriving. */
  amount: string
}

export interface Movement {
  id: string
  kind: MovementKind
  occurred_on: string | null
  /** Always positive. The legs carry the direction. */
  amount: string
  legs: MovementLeg[]
  purchase_id: string | null
  sale_id: string | null
  product_name: string | null
  notes: string | null
  status: string
}

export interface MovementPage {
  items: Movement[]
  total: number
  limit: number
  offset: number
}

/** Who paid for a purchase. `amount` may be omitted when one account paid all of it. */
export interface FundingLeg {
  account_id: string
  amount?: string
}

/**
 * Where a sale's money went. Either an existing account, or `store` — the name of a shop
 * that paid in credit, whose pot is created the first time it is used.
 */
export interface ProceedsLeg {
  account_id?: string
  store?: string
  amount?: string
}

export const MOVEMENT_LABELS: Record<MovementKind, string> = {
  funding: 'Bought stock',
  proceeds: 'Sold stock',
  transfer: 'Transfer',
  adjustment: 'Adjustment',
}

export interface NewProduct {
  name: string
  game_id: string
  product_type_id: string
  set_name?: string | null
  /** Drives the case and box size suggestions: a Japanese case is 20 boxes, not six. */
  language?: string | null
  storage_location?: string | null
  notes?: string | null
  initial_purchase?: {
    quantity: number
    amount: string
    bucket?: Bucket
    shipping?: string
    tax?: string
    fees?: string
    purchase_date?: string
    source?: string | null
    /** Who paid. Omitted, it goes on whoever bought it. `[]` records no money at all. */
    funding?: FundingLeg[]
  }
}

export interface NewPurchase {
  product_id: string
  quantity: number
  amount: string
  /** Where the stock lands. Omitting it means Inventory. */
  bucket?: Bucket
  shipping?: string
  tax?: string
  fees?: string
  purchase_date?: string
  source?: string | null
  notes?: string | null
  /** Who paid. Omitted, it goes on whoever bought it. `[]` records no money at all. */
  funding?: FundingLeg[]
}

export interface NewSale {
  product_id: string
  quantity: number
  amount: string
  /** Which bucket the stock left. Omitting it books the sale against Inventory. */
  bucket?: Bucket
  platform_fees?: string
  payment_fees?: string
  shipping_paid?: string
  sale_date?: string
  sold_by_member_id?: string | null
  marketplace?: string | null
  notes?: string | null
  /** Where the money landed. Omitted, it follows the seller. `[]` records none. */
  proceeds?: ProceedsLeg[]
  allow_oversell?: boolean
}

export interface NewAdjustment {
  product_id: string
  quantity_delta: number
  reason: string
  bucket?: Bucket
  cost?: string | null
  adjustment_date?: string
  notes?: string | null
}

export const ADJUSTMENT_REASONS = [
  'opening_inventory',
  'correction',
  'damaged',
  'missing',
  'opened',
  'given_away',
  'personal_use',
  'returned',
  'written_off',
  'other',
] as const

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const rendered = search.toString()
  return rendered ? `?${rendered}` : ''
}

export const api = {
  me: () => request<Member>('/api/v1/members/me'),
  members: () => request<Member[]>('/api/v1/members'),
  games: () => request<Taxonomy[]>('/api/v1/games'),
  productTypes: () => request<Taxonomy[]>('/api/v1/product-types'),

  products: (params: {
    q?: string
    game?: string
    product_type?: string
    stock?: string
    bucket?: string
    include_archived?: boolean
  }) => request<ProductPage>(`/api/v1/products${query(params)}`),

  product: (id: string) => request<ProductDetail>(`/api/v1/products/${id}`),

  createProduct: (product: NewProduct) =>
    request<ProductDetail>('/api/v1/products', {
      method: 'POST',
      body: JSON.stringify(product),
    }),

  updateProduct: (id: string, changes: Partial<NewProduct> & { is_archived?: boolean }) =>
    request<ProductDetail>(`/api/v1/products/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),

  deleteProduct: (id: string) =>
    request<void>(`/api/v1/products/${id}`, { method: 'DELETE' }),

  createPurchase: (purchase: NewPurchase) =>
    request<unknown>('/api/v1/purchases', { method: 'POST', body: JSON.stringify(purchase) }),

  createSale: (sale: NewSale) =>
    request<unknown>('/api/v1/sales', { method: 'POST', body: JSON.stringify(sale) }),

  /** Editing any transaction re-runs FIFO for that product, so profit on other
   *  sales can move. `reason` is recorded on the audit entry, not on the row. */
  updatePurchase: (id: string, changes: Record<string, unknown>) =>
    request<unknown>(`/api/v1/purchases/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),

  updateSale: (id: string, changes: Record<string, unknown>) =>
    request<unknown>(`/api/v1/sales/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),

  updateAdjustment: (id: string, changes: Record<string, unknown>) =>
    request<unknown>(`/api/v1/adjustments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),

  /** Shifts stock between buckets. Never changes how much there is. */
  createMove: (move: {
    product_id: string
    quantity: number
    from_bucket: Bucket
    to_bucket: Bucket
    moved_on?: string
    notes?: string | null
  }) => request<unknown>('/api/v1/moves', { method: 'POST', body: JSON.stringify(move) }),

  createAdjustment: (adjustment: NewAdjustment) =>
    request<unknown>('/api/v1/adjustments', {
      method: 'POST',
      body: JSON.stringify(adjustment),
    }),

  voidTransaction: (kind: Transaction['kind'], id: string, reason: string) => {
    const path = {
      purchase: 'purchases',
      sale: 'sales',
      adjustment: 'adjustments',
      move: 'moves',
    }[kind]
    return request<unknown>(`/api/v1/${path}/${id}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    })
  },

  sales: (params: {
    q?: string
    marketplace?: string
    sold_by_member_id?: string
    game?: string
    period?: Period
    limit?: number
    offset?: number
  }) => request<SalePage>(`/api/v1/sales${query(params)}`),

  previewSale: (input: {
    product_id: string
    quantity: number
    amount?: string
    platform_fees?: string
    payment_fees?: string
    shipping_paid?: string
    sale_date?: string
  }) =>
    request<SalePreview>('/api/v1/sales/preview', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  dashboard: (period: Period) => request<Dashboard>(`/api/v1/dashboard${query({ period })}`),

  group: (by: GroupBy, period: Period) =>
    request<GroupRow[]>(`/api/v1/reports/by-${by}${query({ period })}`),
  byGame: (period: Period) => request<GroupRow[]>(`/api/v1/reports/by-game${query({ period })}`),
  bySeller: (period: Period) =>
    request<GroupRow[]>(`/api/v1/reports/by-seller${query({ period })}`),
  /** Whether reading photos is switched on at all. */
  visionStatus: () => request<ReadResult>('/api/v1/vision/status'),

  /**
   * What cards are in this photo. Fills in a form; it never writes to the ledger, and it
   * is never asked what anything is worth.
   */
  readCards: async (file: File): Promise<ReadResult> => {
    const body = new FormData()
    body.append('photo', file)
    return request<ReadResult>('/api/v1/vision/cards', { method: 'POST', body })
  },

  /** What is in the Vault, measured on appreciation rather than velocity. */
  vaultHoldings: () => request<VaultHolding[]>('/api/v1/reports/vault'),

  /** Write down what something is worth today. An estimate, and it stays one. */
  recordValuation: (input: {
    product_id: string
    value: string
    captured_on?: string
    notes?: string | null
  }) =>
    request<unknown>('/api/v1/valuations', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** How each tier has performed, with the spread and not just the average. */
  byTier: () => request<TierRow[]>('/api/v1/reports/by-tier'),

  /** One set, as its parts. Deliberately never blended into a single figure. */
  bySet: () => request<SetRollupRow[]>('/api/v1/reports/by-set'),

  /** One product, all-in, across everything it became. Never summed with byTier. */
  lineage: (productId: string) =>
    request<LineageRollup>(`/api/v1/reports/lineage/${productId}`),

  /** Not period-scoped: what is on the shelf today is not a function of a date range. */
  aging: () => request<AgingLot[]>('/api/v1/reports/aging'),
  attention: () => request<Attention>('/api/v1/reports/attention'),

  /** Sets worth offering for one game, best first. Scoped to a game on purpose. */
  sets: (params: { game: string; q?: string; limit?: number }) =>
    request<SetSuggestions>(`/api/v1/sets${query(params)}`),

  /** Send cards to a grader. Nothing moves — the card is flagged where it sits. */
  sendToGrading: (input: {
    product_id: string
    quantity?: number
    bucket?: Bucket
    grading_company?: string | null
    sent_on?: string
    fees?: string
    notes?: string | null
  }) =>
    request<GradingSubmission>('/api/v1/grading', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  gradingSubmissions: (params: { product_id?: string; out_only?: boolean } = {}) =>
    request<GradingSubmission[]>(`/api/v1/grading${query(params)}`),

  /** It came back. The raw card is consumed and the graded one produced. */
  returnFromGrading: (
    id: string,
    input: {
      graded_product_id: string
      grade?: string | null
      returned_on?: string
      extra_fees?: string
      notes?: string | null
    },
  ) =>
    request<GradingSubmission>(`/api/v1/grading/${id}/return`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  voidGradingSubmission: (id: string, reason: string) =>
    request<GradingSubmission>(`/api/v1/grading/${id}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  /** Open sealed cases into what was inside them. */
  crackCase: (input: {
    product_id: string
    quantity: number
    from_bucket?: Bucket
    outputs: { product_id: string; quantity: number; bucket?: Bucket }[]
    occurred_on?: string
    notes?: string | null
  }) =>
    request<Transformation>('/api/v1/transformations/crack', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** Open boxes or packs, recording the hits worth tracking. */
  ripOpen: (input: {
    product_id: string
    quantity?: number
    from_bucket?: Bucket
    hits: RipHit[]
    occurred_on?: string
    notes?: string | null
  }) =>
    request<Transformation>('/api/v1/transformations/rip', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** What a product was opened into, and what it came out of. */
  transformations: (params: { product_id?: string } = {}) =>
    request<Transformation[]>(`/api/v1/transformations${query(params)}`),

  voidTransformation: (id: string, reason: string) =>
    request<Transformation>(`/api/v1/transformations/${id}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  accounts: () => request<AccountsPage>('/api/v1/money/accounts'),

  movements: (params: { account_id?: string; kind?: MovementKind; limit?: number }) =>
    request<MovementPage>(`/api/v1/money/movements${query(params)}`),

  /** Paying a partner back, putting cash in, and settling up are all this one call. */
  createTransfer: (transfer: {
    from_account_id: string
    to_account_id: string
    amount: string
    occurred_on?: string
    notes?: string | null
  }) =>
    request<Movement>('/api/v1/money/transfers', {
      method: 'POST',
      body: JSON.stringify(transfer),
    }),

  /** `amount` is signed, in the account's own terms: +5000 on a member means owed $5,000. */
  createMoneyAdjustment: (adjustment: {
    account_id: string
    amount: number
    occurred_on?: string
    notes?: string | null
  }) =>
    request<Movement>('/api/v1/money/adjustments', {
      method: 'POST',
      body: JSON.stringify(adjustment),
    }),

  voidMovement: (id: string, reason: string) =>
    request<Movement>(`/api/v1/money/movements/${id}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
}
