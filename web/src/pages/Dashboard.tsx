import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { api, type Attention, type Period } from '../api'
import { Card, Empty, FifoNote, Stat } from '../components/ui'
import { money, moneyCompact, percent, signedMoney, toneFor } from '../format'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'ytd', label: 'This year' },
  { value: 'mtd', label: 'This month' },
  { value: '30d', label: 'Last 30 days' },
]

export function Dashboard() {
  const [period, setPeriod] = useState<Period>('all')

  const dashboard = useQuery({
    queryKey: ['dashboard', period],
    queryFn: () => api.dashboard(period),
  })
  const byGame = useQuery({ queryKey: ['byGame', period], queryFn: () => api.byGame(period) })
  const attention = useQuery({ queryKey: ['attention'], queryFn: api.attention })
  const recent = useQuery({
    queryKey: ['products', 'recent'],
    queryFn: () => api.products({}),
  })

  const data = dashboard.data

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold lg:text-2xl">Dashboard</h1>
        <div className="flex flex-wrap gap-2">
          {PERIODS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setPeriod(option.value)}
              className={`rounded-full border px-3 py-1.5 text-sm ${
                period === option.value
                  ? 'border-(--color-accent) bg-(--color-accent) text-(--color-ink)'
                  : 'border-(--color-edge) text-(--color-muted)'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {dashboard.isError && (
        <p className="text-sm text-red-400">{(dashboard.error as Error).message}</p>
      )}

      {data && (
        <>
          {/* Profit and ROI get the visual weight, per the brief. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <div className="col-span-2 lg:col-span-2">
              <Stat
                label="Realized profit"
                value={signedMoney(data.realized_profit)}
                tone={toneFor(data.realized_profit)}
                emphasis
                hint={
                  data.sales_missing_cost
                    ? `${data.sales_missing_cost} of ${data.sale_count} sales excluded — cost unknown`
                    : undefined
                }
              />
            </div>
            <div className="col-span-2 lg:col-span-2">
              <Stat
                label="ROI"
                value={percent(data.roi)}
                tone={toneFor(data.roi)}
                emphasis
                hint={`On ${money(data.cost_of_sales)} of stock sold`}
              />
            </div>
            <div className="col-span-2 lg:col-span-2">
              <Stat
                label="Inventory at cost"
                value={moneyCompact(data.inventory_at_cost)}
                emphasis
                hint={`${data.units_in_stock} units on hand`}
              />
            </div>

            <Stat label="Total invested" value={moneyCompact(data.total_invested)} />
            <Stat label="Total sales" value={moneyCompact(data.total_sales)} />
            <Stat label="Units in stock" value={String(data.units_in_stock)} />
            <Stat label="Sales" value={String(data.sale_count)} />
            <Stat label="Average sale" value={moneyCompact(data.average_sale, '—')} />
            <Stat
              label="Written off"
              value={moneyCompact(data.cost_written_off)}
              hint="Not counted as a trading loss"
            />
          </div>

          <FifoNote />
        </>
      )}

      {attention.data && <AttentionPanel attention={attention.data} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-(--color-muted)">
            Profit by game
          </h2>
          <Card className="p-0">
            {byGame.data?.length ? (
              <ul className="divide-y divide-(--color-edge)">
                {byGame.data.map((row) => (
                  <li key={row.key} className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm">{row.label}</span>
                    <span className={`text-sm tabular-nums ${toneFor(row.realized_profit)}`}>
                      {signedMoney(row.realized_profit)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Nothing sold yet.</Empty>
            )}
          </Card>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-(--color-muted)">
            Inventory
          </h2>
          <Card className="p-0">
            {recent.data?.items.length ? (
              <ul className="divide-y divide-(--color-edge)">
                {recent.data.items.slice(0, 6).map((product) => (
                  <li key={product.id}>
                    <Link
                      to={`/products/${product.id}`}
                      className="flex items-center justify-between px-4 py-3"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">{product.name}</span>
                      <span className="ml-3 shrink-0 text-sm tabular-nums text-(--color-muted)">
                        {product.stats.quantity_on_hand} · {money(product.stats.remaining_cost)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>
                No products yet. Add one from{' '}
                <Link to="/inventory" className="text-(--color-accent)">
                  Inventory
                </Link>
                .
              </Empty>
            )}
          </Card>
        </section>
      </div>

      {data && data.undated_sales > 0 && (
        <p className="text-xs text-(--color-muted)">
          {data.undated_sales} sale{data.undated_sales === 1 ? '' : 's'} without a date are
          excluded from period figures.
        </p>
      )}
    </div>
  )
}

function AttentionPanel({ attention }: { attention: Attention }) {
  const items: string[] = []
  if (attention.sales_missing_cost)
    items.push(`${attention.sales_missing_cost} sales are missing purchase costs`)
  if (attention.products_with_negative_stock)
    items.push(`${attention.products_with_negative_stock} products have negative inventory`)
  if (attention.undated_sales) items.push(`${attention.undated_sales} sales have no date`)
  if (attention.products_out_of_stock)
    items.push(`${attention.products_out_of_stock} products are sold out`)

  if (!items.length) return null

  return (
    <Card className="border-amber-500/40">
      <h2 className="text-sm font-semibold">Needs attention</h2>
      <ul className="mt-2 space-y-1 text-sm text-(--color-muted)">
        {items.map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
      {attention.negative_stock_products.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {attention.negative_stock_products.map((product) => (
            <li key={product.id}>
              <Link to={`/products/${product.id}`} className="text-(--color-accent)">
                {product.name}
              </Link>{' '}
              <span className="text-(--color-loss) tabular-nums">{product.quantity}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
