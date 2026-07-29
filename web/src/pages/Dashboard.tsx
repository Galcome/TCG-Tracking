import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowUpRight } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { api, MARKETPLACES, type Attention, type Period } from '../api'
import { PageHeader } from '../components/AppShell'
import { Card, Empty, Skeleton, gameColour } from '../components/ui'
import { money, moneyCompact, percent, shortDate, signedMoney, toneFor } from '../format'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'ytd', label: 'Year' },
  { value: 'mtd', label: 'Month' },
  { value: '30d', label: '30 days' },
]

/** ROI target the donut fills against. Above it, the ring completes. */
const ROI_TARGET = 0.15

function slugOf(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

function marketplaceColour(name: string): string {
  return MARKETPLACES.find((m) => m.name === name)?.colour ?? 'var(--color-game-other)'
}

export function Dashboard({ onRecordSale, onAddProduct }: { onRecordSale: () => void; onAddProduct: () => void }) {
  const [period, setPeriod] = useState<Period>('all')

  const summary = useQuery({
    queryKey: ['dashboard', period],
    queryFn: () => api.dashboard(period),
  })
  const byGame = useQuery({
    queryKey: ['byGame', period],
    queryFn: () => api.group('game', period),
  })
  const byChannel = useQuery({
    queryKey: ['byMarketplace', period],
    queryFn: () => api.group('marketplace', period),
  })
  const attention = useQuery({ queryKey: ['attention'], queryFn: api.attention })
  const recent = useQuery({
    queryKey: ['sales', 'recent', period],
    queryFn: () => api.sales({ period, limit: 6 }),
  })

  const data = summary.data

  return (
    <div className="space-y-5">
      <PageHeader title="Dashboard" onRecordSale={onRecordSale} onAddProduct={onAddProduct}>
        <div className="flex gap-1 rounded-full border border-(--color-edge) bg-(--color-surface)/70 p-[3px]">
          {PERIODS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setPeriod(option.value)}
              className={`rounded-full px-3.5 py-1.5 text-[0.8125rem] transition-colors ${
                period === option.value
                  ? 'bg-(--color-accent) font-medium text-(--color-ink)'
                  : 'text-(--color-muted) hover:text-(--color-text)'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </PageHeader>

      {summary.isError && (
        <p className="rounded-lg border border-(--color-loss)/40 bg-(--color-loss)/10 px-3 py-2 text-sm text-(--color-loss)">
          {(summary.error as Error).message}
        </p>
      )}

      {summary.isLoading && (
        <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr_1fr]">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      )}

      {data && (
        <>
          {/* Hierarchy: profit dominates, ROI and inventory support it, everything else
              is a strip below. The old flat 9-tile grid gave them all equal weight. */}
          <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr_1fr]">
            <HeroProfit data={data} />
            <RoiDonut roi={data.roi} costOfSales={data.cost_of_sales} revenue={data.total_sales} />
            <InventoryPanel data={data} />
          </div>

          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
            <Metric label="Total invested" value={moneyCompact(data.total_invested)} />
            <Metric label="Total sales" value={moneyCompact(data.total_sales)} />
            <Metric label="Spent this period" value={moneyCompact(data.purchases_in_period)} />
            <Metric label="Sales" value={String(data.sale_count)} />
            <Metric label="Average sale" value={moneyCompact(data.average_sale, '—')} />
            <Metric
              label="Written off"
              value={moneyCompact(data.cost_written_off)}
              hint="Not a trading loss"
            />
          </div>
        </>
      )}

      {attention.data && <AttentionRibbon attention={attention.data} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Where it sold" subtitle="Net proceeds by channel">
          {byChannel.data?.length ? (
            <BarList
              rows={byChannel.data.map((row) => ({
                key: row.key,
                label: row.label,
                value: Number(row.revenue),
                display: money(row.revenue),
                colour: marketplaceColour(row.label),
              }))}
            />
          ) : (
            <Empty>No sales in this period.</Empty>
          )}
        </Panel>

        <Panel title="Profit by game" subtitle="Realized, excluding unknown-cost sales">
          {byGame.data?.filter((row) => row.sale_count).length ? (
            <BarList
              rows={byGame.data
                .filter((row) => row.sale_count)
                .map((row) => ({
                  key: row.key,
                  label: row.label,
                  value: Number(row.realized_profit),
                  display: signedMoney(row.realized_profit),
                  colour: gameColour(slugOf(row.label)),
                }))}
            />
          ) : (
            <Empty>Nothing sold yet.</Empty>
          )}
        </Panel>
      </div>

      <Panel
        title="Recent sales"
        action={
          <Link to="/sales" className="text-xs text-(--color-accent)">
            Full ledger →
          </Link>
        }
      >
        {recent.data?.items.length ? (
          <ul className="divide-y divide-(--color-edge)">
            {recent.data.items.map((sale) => (
              <li key={sale.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-20 shrink-0 text-xs text-(--color-faint)">
                  {shortDate(sale.sale_date)}
                </span>
                <Link
                  to={`/products/${sale.product_id}`}
                  className="min-w-0 flex-1 truncate transition-colors hover:text-(--color-accent)"
                >
                  {sale.product.name}
                </Link>
                <span
                  className="hidden shrink-0 rounded-full px-2 py-0.5 text-xs sm:inline-block"
                  style={{
                    color: marketplaceColour(sale.marketplace ?? ''),
                    backgroundColor: `${marketplaceColour(sale.marketplace ?? '')}1a`,
                  }}
                >
                  {sale.marketplace ?? 'Unspecified'}
                </span>
                <span className="w-10 shrink-0 text-right tabular-nums text-(--color-muted)">
                  {sale.quantity}x
                </span>
                <span className="w-20 shrink-0 text-right tabular-nums">
                  {money(sale.net_proceeds)}
                </span>
                <span
                  className={`w-20 shrink-0 text-right tabular-nums ${toneFor(sale.realized_profit)}`}
                >
                  {sale.has_unknown_cost ? 'Unknown' : signedMoney(sale.realized_profit)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>
            Nothing sold yet.{' '}
            <button type="button" onClick={onRecordSale} className="text-(--color-accent)">
              Record a sale
            </button>
            .
          </Empty>
        )}
      </Panel>

      {data && data.undated_sales > 0 && (
        <p className="text-xs text-(--color-faint)">
          {data.undated_sales} sale{data.undated_sales === 1 ? '' : 's'} without a date are excluded
          from period figures.
        </p>
      )}
    </div>
  )
}

function HeroProfit({ data }: { data: NonNullable<Awaited<ReturnType<typeof api.dashboard>>> }) {
  return (
    <section className="foil relative overflow-hidden rounded-xl border border-(--color-edge) bg-(--color-surface) p-5">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-(--color-faint)">
        Realized profit
      </p>
      <p
        className={`font-display mt-2 text-[2.5rem] font-bold leading-none tabular-nums lg:text-[3rem] ${toneFor(data.realized_profit)}`}
      >
        {signedMoney(data.realized_profit)}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-(--color-faint)">
        {data.roi !== null && (
          <span className={`inline-flex items-center gap-1 ${toneFor(data.roi)}`}>
            <ArrowUpRight size={12} strokeWidth={3} />
            {percent(data.roi)} return
          </span>
        )}
        <span>on {money(data.cost_of_sales)} of stock sold</span>
        <span>
          CAD · {data.sale_count} sale{data.sale_count === 1 ? '' : 's'}
        </span>
      </div>

      {data.sales_missing_cost > 0 && (
        <p className="mt-3 text-xs text-(--color-warn)">
          {data.sales_missing_cost} of {data.sale_count} sales excluded — purchase cost unknown
        </p>
      )}
    </section>
  )
}

function RoiDonut({
  roi,
  costOfSales,
  revenue,
}: {
  roi: number | null
  costOfSales: string
  revenue: string
}) {
  const circumference = 2 * Math.PI * 42
  // Fill relative to twice the target, so hitting target reads as half the ring and
  // there is headroom above it rather than a bar that pins instantly.
  const fraction = roi === null ? 0 : Math.max(0, Math.min(roi / (ROI_TARGET * 2), 1))
  const stroke = roi === null || roi >= 0 ? 'var(--color-gain)' : 'var(--color-loss)'

  return (
    <section className="rounded-xl border border-(--color-edge) bg-(--color-surface) p-5">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-(--color-faint)">
        Return on investment
      </p>
      <div className="mt-3 flex items-center gap-4">
        <svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true">
          <circle cx="52" cy="52" r="42" fill="none" stroke="var(--color-raised)" strokeWidth="11" />
          <circle
            cx="52"
            cy="52"
            r="42"
            fill="none"
            stroke={stroke}
            strokeWidth="11"
            strokeLinecap="round"
            strokeDasharray={`${fraction * circumference} ${circumference}`}
            transform="rotate(-90 52 52)"
          />
        </svg>
        <div>
          <p className={`font-display text-2xl font-bold tabular-nums ${toneFor(roi)}`}>
            {percent(roi)}
          </p>
          <p className="mt-0.5 text-xs text-(--color-faint)">Target {percent(ROI_TARGET, '—')}</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-(--color-faint)">
        Cost of sales {moneyCompact(costOfSales)} · revenue {moneyCompact(revenue)}
      </p>
    </section>
  )
}

function InventoryPanel({
  data,
}: {
  data: NonNullable<Awaited<ReturnType<typeof api.dashboard>>>
}) {
  const types = useQuery({ queryKey: ['byType', 'all'], queryFn: () => api.group('product-type', 'all') })

  // "Sealed" is anything boxed; the rest is singles and slabs. A rough split, but it is
  // the one buyers actually think in.
  const sealedSlugs = ['booster-box', 'sealed-case', 'booster-pack', 'box-set', 'deck']
  const rows = types.data ?? []
  const sealed = rows
    .filter((row) => sealedSlugs.includes(slugOf(row.label)))
    .reduce((sum, row) => sum + Number(row.inventory_at_cost), 0)
  const total = rows.reduce((sum, row) => sum + Number(row.inventory_at_cost), 0)
  const sealedShare = total > 0 ? (sealed / total) * 100 : 0

  return (
    <section className="rounded-xl border border-(--color-edge) bg-(--color-surface) p-5">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-(--color-faint)">
        Inventory at cost
      </p>
      <p className="font-display mt-2 text-[1.75rem] font-bold tabular-nums">
        {moneyCompact(data.inventory_at_cost)}
      </p>
      <p className="mt-0.5 text-xs text-(--color-faint)">{data.units_in_stock} units on hand</p>

      {total > 0 && (
        <div className="mt-4">
          <div className="flex justify-between text-[0.6875rem] text-(--color-faint)">
            <span>Sealed {Math.round(sealedShare)}%</span>
            <span>Singles {Math.round(100 - sealedShare)}%</span>
          </div>
          <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-(--color-raised)">
            <span style={{ width: `${sealedShare}%`, backgroundColor: 'var(--color-accent)' }} />
            <span
              style={{ width: `${100 - sealedShare}%`, backgroundColor: 'var(--color-game-yugioh)' }}
            />
          </div>
        </div>
      )}
    </section>
  )
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-(--color-edge) bg-(--color-surface) px-4 py-3">
      <p className="text-[0.625rem] font-medium uppercase tracking-[0.08em] text-(--color-faint)">
        {label}
      </p>
      <p className="font-display mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-[0.6875rem] text-(--color-faint)">{hint}</p>}
    </div>
  )
}

function AttentionRibbon({ attention }: { attention: Attention }) {
  const items: string[] = []
  if (attention.sales_missing_cost)
    items.push(`${attention.sales_missing_cost} sales missing purchase costs`)
  if (attention.products_with_negative_stock)
    items.push(`${attention.products_with_negative_stock} products with negative inventory`)
  if (attention.undated_sales) items.push(`${attention.undated_sales} sales without a date`)
  if (attention.products_out_of_stock)
    items.push(`${attention.products_out_of_stock} products sold out`)

  if (!items.length) return null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-(--color-warn)/40 bg-(--color-warn)/10 px-4 py-2.5 text-sm text-(--color-warn)">
      <AlertTriangle size={15} className="shrink-0" />
      <span>{items.join(' · ')}</span>
      {attention.negative_stock_products.length > 0 && (
        <span className="flex flex-wrap gap-2">
          {attention.negative_stock_products.slice(0, 3).map((product) => (
            <Link
              key={product.id}
              to={`/products/${product.id}`}
              className="underline underline-offset-2"
            >
              {product.name} ({product.quantity})
            </Link>
          ))}
        </span>
      )}
    </div>
  )
}

function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-2.5 flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-sm font-semibold tracking-[0.02em]">{title}</h2>
          {subtitle && <p className="text-xs text-(--color-faint)">{subtitle}</p>}
        </div>
        {action}
      </div>
      <Card className="p-0">{children}</Card>
    </section>
  )
}

function BarList({
  rows,
}: {
  rows: { key: string; label: string; value: number; display: string; colour: string }[]
}) {
  const peak = Math.max(...rows.map((row) => Math.abs(row.value)), 1)
  return (
    <ul className="space-y-2.5 p-4">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: row.colour }}
              />
              <span className="truncate">{row.label}</span>
            </span>
            <span className="shrink-0 tabular-nums">{row.display}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-(--color-raised)">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${(Math.abs(row.value) / peak) * 100}%`,
                backgroundColor: row.colour,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
