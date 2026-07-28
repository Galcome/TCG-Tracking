import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../api'

/** Debounce so typing does not fire a request per keystroke. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

export function Inventory() {
  const [search, setSearch] = useState('')
  const [game, setGame] = useState('')
  const debouncedSearch = useDebounced(search, 250)

  const games = useQuery({ queryKey: ['games'], queryFn: api.games })
  const products = useQuery({
    queryKey: ['products', debouncedSearch, game],
    queryFn: () => api.products({ q: debouncedSearch, game: game || undefined }),
  })

  return (
    <div className="space-y-4 p-4 pb-28">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search products…"
        className="w-full rounded-lg border border-(--color-edge) bg-(--color-surface) px-3 py-3 text-base outline-none focus:border-(--color-accent)"
      />

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <FilterChip label="All" active={game === ''} onClick={() => setGame('')} />
        {games.data?.map((option) => (
          <FilterChip
            key={option.id}
            label={option.name}
            active={game === option.slug}
            onClick={() => setGame(option.slug)}
          />
        ))}
      </div>

      {products.isLoading && <p className="text-sm text-(--color-muted)">Loading…</p>}
      {products.isError && (
        <p className="text-sm text-red-400">{(products.error as Error).message}</p>
      )}

      {products.data && products.data.items.length === 0 && (
        <p className="py-8 text-center text-sm text-(--color-muted)">
          {debouncedSearch ? 'Nothing matches that search.' : 'No products yet.'}
        </p>
      )}

      <ul className="space-y-2">
        {products.data?.items.map((product) => (
          <li
            key={product.id}
            className="rounded-lg border border-(--color-edge) bg-(--color-surface) p-3"
          >
            <p className="font-medium">{product.name}</p>
            <p className="mt-0.5 text-sm text-(--color-muted)">
              {product.game.name} · {product.product_type.name}
              {product.set_name ? ` · ${product.set_name}` : ''}
            </p>
          </li>
        ))}
      </ul>

      {products.data && products.data.total > products.data.items.length && (
        <p className="text-center text-xs text-(--color-muted)">
          Showing {products.data.items.length} of {products.data.total}
        </p>
      )}

      <Link
        to="/products/new"
        className="fixed inset-x-4 bottom-6 mx-auto block max-w-md rounded-xl bg-(--color-accent) px-4 py-4 text-center font-medium text-(--color-ink) shadow-lg"
      >
        Add product
      </Link>
    </div>
  )
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${
        active
          ? 'border-(--color-accent) bg-(--color-accent) text-(--color-ink)'
          : 'border-(--color-edge) text-(--color-muted)'
      }`}
    >
      {label}
    </button>
  )
}
