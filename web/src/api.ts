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
  const response = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
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
}

export interface Transaction {
  kind: 'purchase' | 'sale' | 'adjustment'
  id: string
  occurred_on: string | null
  quantity: number
  amount: string | null
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
}

export interface Attention {
  sales_missing_cost: number
  products_with_negative_stock: number
  undated_sales: number
  products_out_of_stock: number
  negative_stock_products: { id: string; name: string; quantity: number }[]
}

export type Period = 'all' | 'ytd' | 'mtd' | '30d'

export interface NewProduct {
  name: string
  game_id: string
  product_type_id: string
  set_name?: string | null
  storage_location?: string | null
  notes?: string | null
  initial_purchase?: {
    quantity: number
    amount: string
    shipping?: string
    tax?: string
    fees?: string
    purchase_date?: string
    source?: string | null
  }
}

export interface NewPurchase {
  product_id: string
  quantity: number
  amount: string
  shipping?: string
  tax?: string
  fees?: string
  purchase_date?: string
  source?: string | null
  notes?: string | null
}

export interface NewSale {
  product_id: string
  quantity: number
  amount: string
  platform_fees?: string
  payment_fees?: string
  shipping_paid?: string
  sale_date?: string
  sold_by_member_id?: string | null
  marketplace?: string | null
  notes?: string | null
  allow_oversell?: boolean
}

export interface NewAdjustment {
  product_id: string
  quantity_delta: number
  reason: string
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

  createAdjustment: (adjustment: NewAdjustment) =>
    request<unknown>('/api/v1/adjustments', {
      method: 'POST',
      body: JSON.stringify(adjustment),
    }),

  voidTransaction: (kind: Transaction['kind'], id: string, reason: string) => {
    const path = { purchase: 'purchases', sale: 'sales', adjustment: 'adjustments' }[kind]
    return request<unknown>(`/api/v1/${path}/${id}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    })
  },

  dashboard: (period: Period) => request<Dashboard>(`/api/v1/dashboard${query({ period })}`),
  byGame: (period: Period) => request<GroupRow[]>(`/api/v1/reports/by-game${query({ period })}`),
  bySeller: (period: Period) =>
    request<GroupRow[]>(`/api/v1/reports/by-seller${query({ period })}`),
  attention: () => request<Attention>('/api/v1/reports/attention'),
}
