/**
 * Typed API client.
 *
 * Firebase ID tokens expire hourly. getIdToken() returns the cached token and
 * refreshes it automatically when it is close to expiry, so it is called per
 * request rather than held in state.
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
      return body.detail.map((item: { msg?: string }) => item.msg).filter(Boolean).join(', ')
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
}

export interface ProductPage {
  items: Product[]
  total: number
  limit: number
  offset: number
}

export interface NewProduct {
  name: string
  game_id: string
  product_type_id: string
  set_name?: string
  storage_location?: string
  notes?: string
}

export const api = {
  me: () => request<Member>('/api/v1/members/me'),
  games: () => request<Taxonomy[]>('/api/v1/games'),
  productTypes: () => request<Taxonomy[]>('/api/v1/product-types'),
  products: (params: { q?: string; game?: string; product_type?: string }) => {
    const query = new URLSearchParams()
    if (params.q) query.set('q', params.q)
    if (params.game) query.set('game', params.game)
    if (params.product_type) query.set('product_type', params.product_type)
    const suffix = query.toString() ? `?${query}` : ''
    return request<ProductPage>(`/api/v1/products${suffix}`)
  },
  createProduct: (product: NewProduct) =>
    request<Product>('/api/v1/products', {
      method: 'POST',
      body: JSON.stringify(product),
    }),
}
