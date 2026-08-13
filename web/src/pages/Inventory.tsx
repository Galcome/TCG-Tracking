import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { api, BUCKET_LABELS, BUCKETS, type Bucket, type Product } from '../api'
import {
  ArrowLeftRight,
  PackageOpen,
  PackageSearch,
  Pencil,
  Plus,
  Receipt,
} from 'lucide-react'

import { PageHeader, type PageActions } from '../components/AppShell'
import { EditItemDialog, MoveStockDialog } from '../components/forms'
import {
  Card,
  Empty,
  FIELD_CLASS,
  FifoNote,
  GameDot,
  RowAction,
  RowLink,
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

/**
 * Why the list came up empty, which is not always "you own nothing".
 *
 * The stock filter defaults to In stock, so a store that has sold everything used to be
 * told it had no products at all - while the Sales ledger listed what it had sold.
 */
function emptyMessage(search: string, stock: string, bucket: string): string {
  if (search) {
    return `Nothing matches “${search}”. Search is forgiving about spelling, so it is probably not here yet.`
  }
  // Bucket first: an empty Store means nothing has been moved there, which is a different
  // thing from owning nothing, and telling someone to add their first product when they
  // have forty boxes one tab away is how a filter gets read as a bug.
  if (bucket === 'store') return 'Nothing in the Store. Move stock here when it goes up for sale.'
  if (bucket === 'vault') return 'Nothing in the Vault. Move stock here when you are holding it long term.'
  if (bucket === 'inventory') return 'Nothing left in Inventory — it has all been moved to the Store or the Vault.'
  if (stock === 'in') return 'Nothing in stock right now. Sold-out items are still under Sold out.'
  if (stock === 'out') return 'Nothing is sold out — everything you have bought is still on the shelf.'
  return 'No products yet. Add your first one and record what you paid for it.'
}

/** What each place means, said once on the page rather than assumed. */
const BUCKET_BLURB: Record<string, string> = {
  '': 'Everything you own, wherever it sits.',
  inventory: 'Bought and held. Not yet lined up to sell.',
  store: 'Moved here to sell.',
  vault: 'Held on purpose, long term.',
}

/**
 * Where a product's stock actually sits. Always shown when there is any.
 *
 * An earlier version stayed silent unless stock was split across buckets, on the grounds
 * that "3 inventory" under a total of 3 was noise. That was wrong: it meant moving
 * everything from Inventory to Store changed nothing on screen, so a move that worked
 * perfectly looked like it had failed.
 */
function BucketSplit({ by }: { by: Record<Bucket, number> }) {
  const held = BUCKETS.filter((bucket) => by[bucket] !== 0)
  if (held.length === 0) return null

  return (
    <span className="mt-0.5 block whitespace-nowrap text-[0.6875rem] font-normal text-(--color-faint)">
      {held.map((bucket) => `${by[bucket]} ${BUCKET_LABELS[bucket].toLowerCase()}`).join(' · ')}
    </span>
  )
}

/**
 * How many units this row contributes to the place being looked at.
 *
 * Standing in the Store and reading "4" for a product with 3 boxes there and 1 still in
 * Inventory is the filter contradicting itself. The count leads with the bucket in view;
 * BucketSplit underneath still says where the rest of them are.
 */
function countFor(by: Record<Bucket, number>, total: number, bucket: string): number {
  return bucket ? by[bucket as Bucket] : total
}

/** The three places, as places. A dropdown buried among filters is not a place. */
function BucketTabs({
  value,
  onChange,
  totals,
}: {
  value: string
  onChange: (bucket: string) => void
  totals: Record<Bucket, number> | undefined
}) {
  const everywhere = BUCKETS.reduce((sum, bucket) => sum + (totals?.[bucket] ?? 0), 0)

  return (
    <div className="flex flex-wrap gap-1 rounded-full border border-(--color-edge) bg-(--color-surface)/70 p-[3px]">
      {[{ key: '', label: 'All stock', count: everywhere }].concat(
        BUCKETS.map((bucket) => ({
          key: bucket,
          label: BUCKET_LABELS[bucket],
          count: totals?.[bucket] ?? 0,
        })),
      ).map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={`rounded-full px-3.5 py-1.5 text-[0.8125rem] transition-colors ${
            value === tab.key
              ? 'bg-(--color-accent) font-medium text-(--color-ink)'
              : 'text-(--color-muted) hover:text-(--color-text)'
          }`}
        >
          {tab.label}
          <span className="ml-1.5 tabular-nums opacity-70">{tab.count}</span>
        </button>
      ))}
    </div>
  )
}

export function Inventory({ onRecordSale, onAddProduct }: PageActions) {
  const [editing, setEditing] = useState<string | null>(null)
  const [moving, setMoving] = useState<Product | null>(null)
  const [search, setSearch] = useState('')
  const [game, setGame] = useState('')
  const [stock, setStock] = useState('in')
  const debouncedSearch = useDebounced(search, 250)

  // The bucket lives in the URL, not in component state, so the sidebar can link straight
  // to a place, Back works, and a link to the Vault is shareable. It also means the nav
  // and the tab strip read the same value and cannot disagree about where you are.
  const [params, setParams] = useSearchParams()
  const requested = params.get('bucket') ?? ''
  // A hand-edited ?bucket=basement would 422 the API. Fall back to showing everything
  // rather than turning a bad link into an error screen.
  const bucket = (BUCKETS as readonly string[]).includes(requested) ? requested : ''

  const setBucket = (next: string) => {
    const updated = new URLSearchParams(params)
    if (next) updated.set('bucket', next)
    else updated.delete('bucket')
    setParams(updated)
  }

  const title = bucket ? BUCKET_LABELS[bucket as Bucket] : 'All stock'

  const games = useQuery({ queryKey: ['games'], queryFn: api.games })
  const products = useQuery({
    queryKey: ['products', debouncedSearch, game, bucket, stock],
    queryFn: () =>
      api.products({
        q: debouncedSearch || undefined,
        game: game || undefined,
        bucket: bucket || undefined,
        stock: stock || undefined,
      }),
  })

  const items = products.data?.items ?? []

  return (
    <div className="space-y-5">
      <PageHeader title={title} onRecordSale={onRecordSale} onAddProduct={onAddProduct} />

      <div className="space-y-2">
        <BucketTabs value={bucket} onChange={setBucket} totals={products.data?.bucket_totals} />
        <p className="text-xs text-(--color-faint)">{BUCKET_BLURB[bucket]}</p>
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
            {emptyMessage(debouncedSearch, stock, bucket)}
            {/* Always offered, whichever way the list came up empty. Telling someone to
                add their first product and giving them nothing to press is how this
                screen used to end - and on a phone there was no other route at all. */}
            <button
              type="button"
              onClick={onAddProduct}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-(--color-edge-strong) px-3.5 py-2 text-sm font-medium text-(--color-text) transition-colors hover:border-(--color-accent) hover:text-(--color-accent)"
            >
              <Plus size={15} strokeWidth={2.5} />
              Add product
            </button>
          </Empty>
        </Card>
      )}

      {items.length > 0 && (
        <>
          {/* The table needs ~1060px of columns. Below `xl` the content area is narrower
              than that even with the sidebar, so the row actions ended up off the right
              edge behind a horizontal scrollbar - invisible in exactly the way Joseph
              complained about. Cards take over there instead, where every action is on
              screen. */}
          <Card className="hidden overflow-x-auto p-0 xl:block">
            <table className="w-full text-sm">
              <thead className="border-b border-(--color-edge) text-left text-xs uppercase tracking-wide text-(--color-muted)">
                <tr>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Game</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right font-medium">
                    {bucket ? `In ${title}` : 'In stock'}
                  </th>
                  {/* First column to go when width runs out: it is derived, and the
                      product page shows it in full. */}
                  <th className="hidden px-4 py-3 text-right font-medium 2xl:table-cell">
                    Unit cost
                  </th>
                  <th className="px-4 py-3 text-right font-medium">Inventory value</th>
                  <th className="px-4 py-3 text-right font-medium">Realized profit</th>
                  <th className="py-3 pl-2 pr-4" />
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
                      {/* The name is the way in. Everything a product can *do* - crack a
                          case, rip a box, send it for grading - lives on its own page, and
                          for a while the only route there was a button labelled "History",
                          which nobody hunting for "open this box" would ever click. */}
                      <Link
                        to={`/products/${product.id}`}
                        onClick={(event) => event.stopPropagation()}
                        className="font-medium text-(--color-text) underline-offset-4 hover:text-(--color-accent) hover:underline"
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
                      {countFor(product.stats.by_bucket, product.stats.quantity_on_hand, bucket)}
                      <BucketSplit by={product.stats.by_bucket} />
                    </td>
                    <td className="hidden px-4 py-3 text-right tabular-nums text-(--color-muted) 2xl:table-cell">
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
                      className="whitespace-nowrap py-3 pl-2 pr-4 text-right"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <span className="flex justify-end gap-2">
                        <RowAction onClick={() => onRecordSale(product)}>
                          <Receipt size={13} />
                          Sell
                        </RowAction>
                        <RowAction onClick={() => setMoving(product)}>
                          <ArrowLeftRight size={13} />
                          Move
                        </RowAction>
                        <RowAction onClick={() => setEditing(product.id)}>
                          <Pencil size={13} />
                          Edit
                        </RowAction>
                        <RowLink to={`/products/${product.id}`}>
                          <PackageOpen size={13} />
                          Open
                        </RowLink>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Phones and narrow desktops: cards, two abreast once there is room. */}
          <ul className="grid gap-2 sm:grid-cols-2 xl:hidden">
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
                        {countFor(product.stats.by_bucket, product.stats.quantity_on_hand, bucket)}{' '}
                        {bucket ? `in ${title.toLowerCase()}` : 'in stock'}
                      </p>
                      <BucketSplit by={product.stats.by_bucket} />
                      <p className="text-xs tabular-nums text-(--color-muted)">
                        {money(product.stats.remaining_cost)}
                      </p>
                    </div>
                  </button>
                  <div className="mt-3 flex gap-2 border-t border-(--color-edge) pt-3">
                    <RowAction onClick={() => onRecordSale(product)}>
                      <Receipt size={13} />
                      Sell
                    </RowAction>
                    <RowAction onClick={() => setMoving(product)}>
                      <ArrowLeftRight size={13} />
                      Move
                    </RowAction>
                    <RowAction onClick={() => setEditing(product.id)}>
                      <Pencil size={13} />
                      Edit
                    </RowAction>
                    <RowLink to={`/products/${product.id}`}>
                      <PackageOpen size={13} />
                      Open
                    </RowLink>
                  </div>
                </Card>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <FifoNote />
            {products.data && (
              <p className="text-xs text-(--color-muted)">
                Open a product to crack, rip or grade it · {items.length} shown
              </p>
            )}
          </div>
        </>
      )}

      {editing && <EditItemDialog productId={editing} onClose={() => setEditing(null)} />}
      {moving && <MoveStockDialog product={moving} onClose={() => setMoving(null)} />}
    </div>
  )
}
