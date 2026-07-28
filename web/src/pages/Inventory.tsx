import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../api'
import { PackageSearch, Plus } from 'lucide-react'

import { AddProductDialog } from '../components/forms'
import {
  Button,
  Card,
  Empty,
  FIELD_CLASS,
  FifoNote,
  GameDot,
  Skeleton,
} from '../components/ui'
import { money, toneFor } from '../format'

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
  const [stock, setStock] = useState('')
  const [adding, setAdding] = useState(false)
  const debouncedSearch = useDebounced(search, 250)

  const games = useQuery({ queryKey: ['games'], queryFn: api.games })
  const products = useQuery({
    queryKey: ['products', debouncedSearch, game, stock],
    queryFn: () =>
      api.products({
        q: debouncedSearch || undefined,
        game: game || undefined,
        stock: stock || undefined,
      }),
  })

  const items = products.data?.items ?? []

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold lg:text-3xl">Inventory</h1>
        <Button type="button" onClick={() => setAdding(true)} className="hidden lg:inline-flex">
          <Plus size={16} strokeWidth={2.5} />
          Add product
        </Button>
      </div>

      {/* Filters wrap instead of scrolling sideways - the old chip strip grew a
          horizontal scrollbar on desktop. */}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products…"
          className={`${FIELD_CLASS} mt-0`}
        />
        <select
          value={game}
          onChange={(e) => setGame(e.target.value)}
          className={`${FIELD_CLASS} mt-0 sm:w-48`}
        >
          <option value="">All games</option>
          {games.data?.map((option) => (
            <option key={option.id} value={option.slug}>
              {option.name}
            </option>
          ))}
        </select>
        <select
          value={stock}
          onChange={(e) => setStock(e.target.value)}
          className={`${FIELD_CLASS} mt-0 sm:w-40`}
        >
          <option value="">All stock</option>
          <option value="in">In stock</option>
          <option value="out">Sold out</option>
        </select>
      </div>

      {products.isLoading && (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((row) => (
            <Skeleton key={row} className="h-16 w-full" />
          ))}
        </div>
      )}
      {products.isError && (
        <p className="rounded-lg border border-(--color-loss)/40 bg-(--color-loss)/10 px-3 py-2 text-sm text-(--color-loss)">
          {(products.error as Error).message}
        </p>
      )}

      {products.data && items.length === 0 && (
        <Card>
          <Empty icon={<PackageSearch size={30} strokeWidth={1.5} />}>
            {debouncedSearch
              ? `Nothing matches “${debouncedSearch}”. Search is forgiving about spelling, so it is probably not here yet.`
              : 'No products yet. Add your first one and record what you paid for it.'}
          </Empty>
        </Card>
      )}

      {items.length > 0 && (
        <>
          {/* Desktop: a dense table that actually uses the width. */}
          <Card className="hidden overflow-x-auto p-0 lg:block">
            <table className="w-full text-sm">
              <thead className="border-b border-(--color-edge) text-left text-xs uppercase tracking-wide text-(--color-muted)">
                <tr>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Game</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 text-right font-medium">In stock</th>
                  <th className="px-4 py-3 text-right font-medium">Unit cost</th>
                  <th className="px-4 py-3 text-right font-medium">Inventory value</th>
                  <th className="px-4 py-3 text-right font-medium">Realized profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-edge)">
                {items.map((product) => (
                  <tr
                    key={product.id}
                    className="transition-colors hover:bg-(--color-raised)"
                  >
                    <td className="px-4 py-3">
                      <Link
                        to={`/products/${product.id}`}
                        className="font-medium text-(--color-text) transition-colors hover:text-(--color-accent)"
                      >
                        {product.name}
                      </Link>
                      {product.set_name && (
                        <span className="ml-2 text-xs text-(--color-faint)">
                          {product.set_name}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-(--color-muted)">
                      <span className="inline-flex items-center gap-2">
                        <GameDot slug={product.game.slug} />
                        {product.game.name}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-(--color-muted)">
                      {product.product_type.name}
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums ${
                        product.stats.quantity_on_hand < 0 ? 'text-(--color-loss)' : ''
                      }`}
                    >
                      {product.stats.quantity_on_hand}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-(--color-muted)">
                      {money(product.stats.average_unit_cost, '—')}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {money(product.stats.remaining_cost)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums ${toneFor(product.stats.realized_profit)}`}
                    >
                      {money(product.stats.realized_profit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Mobile: stacked cards. */}
          <ul className="space-y-2 lg:hidden">
            {items.map((product) => (
              <li key={product.id}>
                <Link to={`/products/${product.id}`}>
                  <Card interactive>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{product.name}</p>
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-(--color-faint)">
                          <GameDot slug={product.game.slug} />
                          {product.game.name} · {product.product_type.name}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p
                          className={`text-sm tabular-nums ${
                            product.stats.quantity_on_hand < 0 ? 'text-(--color-loss)' : ''
                          }`}
                        >
                          {product.stats.quantity_on_hand} in stock
                        </p>
                        <p className="text-xs tabular-nums text-(--color-muted)">
                          {money(product.stats.remaining_cost)}
                        </p>
                      </div>
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between">
            <FifoNote />
            {products.data && (
              <p className="text-xs text-(--color-muted)">{items.length} shown</p>
            )}
          </div>
        </>
      )}

      {/* Mobile primary action, thumb-reachable above the tab bar. */}
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="fixed inset-x-4 bottom-20 z-10 flex items-center justify-center gap-2 rounded-xl bg-linear-to-b from-(--color-accent) to-(--color-accent-deep) px-4 py-3.5 font-semibold text-(--color-ink) shadow-lg lg:hidden"
      >
        <Plus size={17} strokeWidth={2.5} />
        Add product
      </button>

      {adding && <AddProductDialog onClose={() => setAdding(false)} />}
    </div>
  )
}
