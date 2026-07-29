import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../api'
import { History, PackageSearch, Pencil, Receipt } from 'lucide-react'

import { PageHeader, type PageActions } from '../components/AppShell'
import { EditItemDialog } from '../components/forms'
import {
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

/** Small enough to sit in a table row, big enough to see. */
function RowButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-(--color-edge) px-2.5 py-1.5 text-xs text-(--color-text) transition-colors hover:border-(--color-accent) hover:bg-(--color-accent)/10 hover:text-(--color-accent)"
    >
      {children}
    </button>
  )
}

export function Inventory({ onRecordSale, onAddProduct }: PageActions) {
  const [editing, setEditing] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [game, setGame] = useState('')
  const [stock, setStock] = useState('in')
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
      <PageHeader title="Inventory" onRecordSale={onRecordSale} onAddProduct={onAddProduct} />

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
          <option value="in">In stock</option>
          <option value="out">Sold out</option>
          <option value="">All products</option>
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
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-edge)">
                {items.map((product) => (
                  <tr
                    key={product.id}
                    onClick={() => setEditing(product.id)}
                    className="cursor-pointer transition-colors hover:bg-(--color-raised)"
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium text-(--color-text)">{product.name}</span>
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
                    {/* The row itself edits, so these must not also trigger it. */}
                    <td
                      className="whitespace-nowrap px-4 py-3 text-right"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <span className="flex justify-end gap-2">
                        <RowButton onClick={() => onRecordSale(product)}>
                          <Receipt size={13} />
                          Sell
                        </RowButton>
                        <RowButton onClick={() => setEditing(product.id)}>
                          <Pencil size={13} />
                          Edit
                        </RowButton>
                        <Link
                          to={`/products/${product.id}`}
                          className="inline-flex items-center gap-1.5 rounded-md border border-(--color-edge) px-2.5 py-1.5 text-xs text-(--color-muted) transition-colors hover:border-(--color-edge-strong) hover:bg-(--color-raised) hover:text-(--color-text)"
                        >
                          <History size={13} />
                          History
                        </Link>
                      </span>
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
                <Card interactive>
                  <button
                    type="button"
                    onClick={() => setEditing(product.id)}
                    className="flex w-full items-start justify-between gap-3 text-left"
                  >
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
                  </button>
                  <div className="mt-3 flex gap-2 border-t border-(--color-edge) pt-3">
                    <RowButton onClick={() => onRecordSale(product)}>
                      <Receipt size={13} />
                      Sell
                    </RowButton>
                    <RowButton onClick={() => setEditing(product.id)}>
                      <Pencil size={13} />
                      Edit
                    </RowButton>
                    <Link
                      to={`/products/${product.id}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-(--color-edge) px-2.5 py-1.5 text-xs text-(--color-muted) transition-colors hover:border-(--color-edge-strong) hover:text-(--color-text)"
                    >
                      <History size={13} />
                      History
                    </Link>
                  </div>
                </Card>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <FifoNote />
            {products.data && (
              <p className="text-xs text-(--color-muted)">
                Click a row to edit it · {items.length} shown
              </p>
            )}
          </div>
        </>
      )}

      {editing && <EditItemDialog productId={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
