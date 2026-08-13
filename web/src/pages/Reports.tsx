import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { api, type AgingLot, type GroupBy, type GroupRow, type Period } from '../api'
import { PageHeader, type PageActions } from '../components/AppShell'
import { SetReport, TierReport } from '../components/rollups'
import { Card, Empty, FifoNote, GameDot, Skeleton, gameColour } from '../components/ui'
import { money, moneyCompact, percent, shortDate, signedMoney, toneFor } from '../format'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'ytd', label: 'Year' },
  { value: 'mtd', label: 'Month' },
  { value: '30d', label: '30 days' },
]

const GROUPS: { value: GroupBy; label: string; noun: string }[] = [
  { value: 'game', label: 'Game', noun: 'game' },
  { value: 'product', label: 'Product', noun: 'product' },
  { value: 'product-type', label: 'Type', noun: 'product type' },
  { value: 'marketplace', label: 'Channel', noun: 'channel' },
  { value: 'seller', label: 'Seller', noun: 'seller' },
]

type SortKey = 'profit' | 'roi' | 'perDay' | 'days'

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'profit', label: 'Profit' },
  { value: 'roi', label: 'ROI' },
  { value: 'perDay', label: '$/day' },
  { value: 'days', label: 'Days held' },
]

function slugOf(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

export function Reports({ onRecordSale, onAddProduct }: PageActions) {
  const [period, setPeriod] = useState<Period>('all')
  const [groupBy, setGroupBy] = useState<GroupBy>('game')
  const [sort, setSort] = useState<SortKey>('profit')

  const rows = useQuery({
    queryKey: ['group', groupBy, period],
    queryFn: () => api.group(groupBy, period),
  })

  const sorted = useMemo(() => {
    const list = [...(rows.data ?? [])]
    const value = (row: GroupRow) =>
      ({
        profit: Number(row.realized_profit),
        roi: row.roi ?? -Infinity,
        perDay: row.profit_per_day === null ? -Infinity : Number(row.profit_per_day),
        days: row.avg_days_held ?? Infinity,
      })[sort]
    // Days held sorts ascending - fastest first is the useful end of that axis.
    list.sort((a, b) => (sort === 'days' ? value(a) - value(b) : value(b) - value(a)))
    return list
  }, [rows.data, sort])

  const noun = GROUPS.find((g) => g.value === groupBy)?.noun ?? 'group'

  return (
    <div className="space-y-5">
      <PageHeader title="Reports" onRecordSale={onRecordSale} onAddProduct={onAddProduct}>
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

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-(--color-faint)">Group by</span>
          <div className="flex flex-wrap gap-1 rounded-lg border border-(--color-edge) bg-(--color-surface)/70 p-[3px]">
            {GROUPS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setGroupBy(option.value)}
                className={`rounded-md px-3 py-1.5 text-[0.8125rem] transition-colors ${
                  groupBy === option.value
                    ? 'bg-(--color-raised) font-medium text-(--color-text)'
                    : 'text-(--color-muted) hover:text-(--color-text)'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-(--color-faint)">Sort</span>
          <div className="flex flex-wrap gap-1 rounded-lg border border-(--color-edge) bg-(--color-surface)/70 p-[3px]">
            {SORTS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setSort(option.value)}
                className={`rounded-md px-3 py-1.5 text-[0.8125rem] transition-colors ${
                  sort === option.value
                    ? 'bg-(--color-raised) font-medium text-(--color-text)'
                    : 'text-(--color-muted) hover:text-(--color-text)'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-(--color-muted)">
          Was the strategy right?
        </h2>
        <p className="mb-3 text-xs text-(--color-faint)">
          What each kind of thing has actually returned, and how widely it varied.
        </p>
        <TierReport />
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-(--color-muted)">
          By set
        </h2>
        <p className="mb-3 text-xs text-(--color-faint)">
          Sold, still trying, and held on purpose &mdash; as three figures, never one.
        </p>
        <SetReport />
      </section>

      {rows.isLoading && <Skeleton className="h-80 w-full" />}
      {rows.isError && (
        <p className="rounded-lg border border-(--color-loss)/40 bg-(--color-loss)/10 px-3 py-2 text-sm text-(--color-loss)">
          {(rows.error as Error).message}
        </p>
      )}

      {rows.data && sorted.length === 0 && (
        <Card>
          {/* Deliberately about this grouping, not the store: Money asleep sits below and
              may well be listing stock, which "nothing in stock" would contradict. */}
          <Empty>No {noun} has anything to report for this period.</Empty>
        </Card>
      )}

      {sorted.length > 0 && (
        <>
          <ReturnVsTime rows={sorted} noun={noun} />
          <VelocityTable
            rows={sorted}
            label={GROUPS.find((g) => g.value === groupBy)!.label}
            href={groupBy === 'product' ? (row) => `/products/${row.key}` : undefined}
          />
        </>
      )}

      {/* Outside the grouping block on purpose: what is sitting on the shelf does not
          change because the table above is grouped by seller. */}
      <MoneyAsleep />

      {sorted.length > 0 && <FifoNote />}
    </div>
  )
}

/**
 * Return against time held.
 *
 * Axis ticks are static SVG text. Dot labels are absolutely-positioned HTML over the
 * plot: SVG <text> inside a map does not lay out reliably across browsers, and HTML
 * gives ellipsis truncation for free.
 */
function ReturnVsTime({ rows, noun }: { rows: GroupRow[]; noun: string }) {
  const plotted = rows.filter((row) => row.avg_days_held !== null && row.roi !== null)
  if (plotted.length === 0) {
    return (
      <Card>
        <Empty>
          No {noun} has both a sale and a known hold time yet — that needs a purchase with a date
          and a sale drawn from it.
        </Empty>
      </Card>
    )
  }

  const maxDays = Math.max(...plotted.map((row) => row.avg_days_held ?? 0), 30)
  const rois = plotted.map((row) => row.roi ?? 0)
  const maxRoi = Math.max(...rois, 0.1)
  const minRoi = Math.min(...rois, 0)
  const maxUnits = Math.max(...plotted.map((row) => row.units_sold), 1)

  const x = (days: number) => (days / maxDays) * 100
  const y = (roi: number) => ((maxRoi - roi) / (maxRoi - minRoi || 1)) * 100
  // Area scales with units, so a dot twice the size means twice the volume, not twice
  // the radius.
  const radius = (units: number) => 6 + Math.sqrt(units / maxUnits) * 16

  return (
    <section>
      <div className="mb-2.5">
        <h2 className="font-display text-sm font-semibold">Return vs. time held</h2>
        <p className="text-xs text-(--color-faint)">
          Each dot is a {noun}. Up is more profitable, left is faster to sell. Dot size is units
          sold.
        </p>
      </div>

      <Card className="p-4">
        <div className="relative h-72 w-full">
          {/* Quadrant tint: fast and high-return is where you want to live. */}
          <div className="absolute left-0 top-0 h-1/2 w-1/2 rounded-tl bg-(--color-gain)/[0.06]" />
          <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-(--color-edge)" />
          <div className="absolute inset-y-0 left-1/2 border-l border-dashed border-(--color-edge)" />

          <span className="absolute left-2 top-2 text-[0.625rem] font-semibold tracking-[0.12em] text-(--color-gain)">
            FAST + HIGH RETURN
          </span>
          <span className="absolute bottom-2 right-2 text-[0.625rem] font-semibold tracking-[0.12em] text-(--color-loss)">
            SLOW + LOW RETURN
          </span>

          {plotted.map((row) => {
            const size = radius(row.units_sold)
            const colour = gameColour(slugOf(row.label))
            return (
              <span
                key={row.key}
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
                title={`${row.label}: ${percent(row.roi)} over ${row.avg_days_held}d, ${row.units_sold} sold`}
                style={{
                  left: `${x(row.avg_days_held ?? 0)}%`,
                  top: `${y(row.roi ?? 0)}%`,
                  height: size,
                  width: size,
                  borderColor: colour,
                  backgroundColor: `${colour}33`,
                }}
              />
            )
          })}

          {plotted.slice(0, 6).map((row) => (
            <span
              key={`${row.key}-label`}
              className="pointer-events-none absolute max-w-24 -translate-x-1/2 translate-y-2 truncate text-center text-[0.625rem] text-(--color-muted)"
              style={{
                left: `${x(row.avg_days_held ?? 0)}%`,
                top: `${y(row.roi ?? 0)}%`,
              }}
            >
              {row.label}
            </span>
          ))}
        </div>

        <div className="mt-2 flex justify-between text-[0.625rem] text-(--color-faint)">
          <span>0 days</span>
          <span>AVERAGE DAYS HELD BEFORE SALE</span>
          <span>{maxDays}d</span>
        </div>
      </Card>
    </section>
  )
}

/**
 * `href` is set only when grouping by product, where `key` is the product id. Every other
 * grouping is an aggregate with nowhere to drill to, so the row stays plain text rather
 * than pretending to be a link.
 */
function VelocityTable({
  rows,
  label,
  href,
}: {
  rows: GroupRow[]
  label: string
  href?: (row: GroupRow) => string
}) {
  const Label = ({ row }: { row: GroupRow }) =>
    href ? (
      <Link to={href(row)} className="truncate transition-colors hover:text-(--color-accent)">
        {row.label}
      </Link>
    ) : (
      <span className="truncate">{row.label}</span>
    )

  return (
    <section>
      <h2 className="font-display mb-2.5 text-sm font-semibold">Performance by {label.toLowerCase()}</h2>

      <Card className="hidden overflow-x-auto p-0 lg:block">
        <table className="w-full text-sm">
          <thead className="border-b border-(--color-edge) text-left text-[0.6875rem] uppercase tracking-wide text-(--color-faint)">
            <tr>
              <th className="px-4 py-3 font-medium">{label}</th>
              <th className="px-4 py-3 text-right font-medium">Profit</th>
              <th className="px-4 py-3 text-right font-medium">ROI</th>
              <th className="px-4 py-3 text-right font-medium">Revenue</th>
              <th className="px-4 py-3 text-right font-medium">Sold</th>
              <th className="px-4 py-3 text-right font-medium">Avg days</th>
              <th className="px-4 py-3 text-right font-medium">Sell-through</th>
              <th className="px-4 py-3 text-right font-medium">$/day</th>
              <th className="px-4 py-3 font-medium">Stock age</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-(--color-edge)">
            {rows.map((row) => (
              <tr key={row.key} className="transition-colors hover:bg-(--color-raised)">
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: gameColour(slugOf(row.label)) }}
                    />
                    <Label row={row} />
                  </span>
                  {row.sales_missing_cost > 0 && (
                    <span className="ml-4 text-xs text-(--color-warn)">
                      {row.sales_missing_cost} excluded
                    </span>
                  )}
                </td>
                <td className={`px-4 py-3 text-right tabular-nums ${toneFor(row.realized_profit)}`}>
                  {signedMoney(row.realized_profit)}
                </td>
                <td className={`px-4 py-3 text-right tabular-nums ${toneFor(row.roi)}`}>
                  {percent(row.roi)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{money(row.revenue)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{row.units_sold}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {row.avg_days_held === null ? '—' : `${row.avg_days_held}d`}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {row.sell_through === null ? '—' : `${Math.round(row.sell_through * 100)}%`}
                </td>
                <td
                  className={`px-4 py-3 text-right tabular-nums ${toneFor(row.profit_per_day)}`}
                >
                  {row.profit_per_day === null ? '—' : money(row.profit_per_day)}
                </td>
                <td className="px-4 py-3">
                  <AgeBar units={row.units_by_age} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <ul className="space-y-2 lg:hidden">
        {rows.map((row) => (
          <li key={row.key}>
            <Card>
              <div className="flex items-start justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: gameColour(slugOf(row.label)) }}
                  />
                  <span className="truncate font-medium">
                    <Label row={row} />
                  </span>
                </span>
                <span className={`shrink-0 tabular-nums ${toneFor(row.realized_profit)}`}>
                  {signedMoney(row.realized_profit)}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-xs text-(--color-faint)">
                <div>
                  <dt>ROI</dt>
                  <dd className={`tabular-nums ${toneFor(row.roi)}`}>{percent(row.roi)}</dd>
                </div>
                <div>
                  <dt>Avg days</dt>
                  <dd className="tabular-nums">
                    {row.avg_days_held === null ? '—' : `${row.avg_days_held}d`}
                  </dd>
                </div>
                <div>
                  <dt>$/day</dt>
                  <dd className="tabular-nums">
                    {row.profit_per_day === null ? '—' : money(row.profit_per_day)}
                  </dd>
                </div>
              </dl>
              <div className="mt-2">
                <AgeBar units={row.units_by_age} />
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** 0-30 / 31-90 / 90+ share of the units on hand. */
function AgeBar({ units }: { units: GroupRow['units_by_age'] }) {
  const fresh = units.d0_30
  const middle = units.d31_90
  const old = units.d91_180 + units.d180_plus
  const total = fresh + middle + old

  if (total === 0) {
    return <span className="text-xs text-(--color-faint)">No stock</span>
  }

  const bands = [
    { value: fresh, colour: 'var(--color-gain)', label: '0-30d' },
    { value: middle, colour: 'var(--color-warn)', label: '31-90d' },
    { value: old, colour: 'var(--color-loss)', label: '90d+' },
  ]

  return (
    <span
      className="flex h-2 w-28 overflow-hidden rounded-full bg-(--color-raised)"
      title={bands.map((band) => `${band.label}: ${band.value}`).join(' · ')}
    >
      {bands.map((band) => (
        <span
          key={band.label}
          style={{ width: `${(band.value / total) * 100}%`, backgroundColor: band.colour }}
        />
      ))}
    </span>
  )
}

/** Cost sitting in stock, by how long it has been sitting there. */
/** Upper bound in days, matching AGE_BUCKETS on the server. `null` is the open end. */
const BANDS: { label: string; upTo: number | null; colour: string }[] = [
  { label: '0-30 days', upTo: 30, colour: 'var(--color-gain)' },
  { label: '31-90 days', upTo: 90, colour: 'var(--color-warn)' },
  { label: '91-180 days', upTo: 180, colour: 'var(--color-game-magic)' },
  { label: '180+ days', upTo: null, colour: 'var(--color-loss)' },
]

function bandFor(days: number): string {
  return (BANDS.find((band) => band.upTo !== null && days <= band.upTo) ?? BANDS[3]).label
}

/** Lots with no purchase date cannot be aged, and are shown as such rather than guessed. */
const UNKNOWN_AGE = 'Unknown age'

/**
 * How long unsold stock has been sitting, and what it is.
 *
 * Fetches its own data rather than reading the grouped rows the rest of the page uses:
 * stock ageing has nothing to do with whether you are grouping by channel or by seller,
 * and reading those rows meant this section silently vanished on the groupings that carry
 * no per-product stock.
 */
function MoneyAsleep() {
  const lots = useQuery({ queryKey: ['aging'], queryFn: api.aging })
  const [open, setOpen] = useState<string | null>(null)

  const groups = useMemo(() => {
    const byBand = new Map<string, AgingLot[]>()
    for (const lot of lots.data ?? []) {
      const key = lot.days_held === null ? UNKNOWN_AGE : bandFor(lot.days_held)
      byBand.set(key, [...(byBand.get(key) ?? []), lot])
    }
    const labels = [...BANDS.map((band) => band.label), UNKNOWN_AGE]
    return labels
      .map((label) => {
        const rows = byBand.get(label) ?? []
        return {
          label,
          rows,
          colour: BANDS.find((band) => band.label === label)?.colour ?? 'var(--color-faint)',
          units: rows.reduce((sum, lot) => sum + lot.units, 0),
          cost: rows.reduce((sum, lot) => sum + Number(lot.cost), 0),
        }
      })
      // An empty Unknown age band is the normal case and should not take up a row.
      .filter((band) => band.label !== UNKNOWN_AGE || band.rows.length > 0)
  }, [lots.data])

  if (!lots.data || lots.data.length === 0) return null

  const total = groups.reduce((sum, band) => sum + band.cost, 0)
  const peak = Math.max(...groups.map((band) => band.cost), 1)

  return (
    <section>
      <div className="mb-2.5">
        <h2 className="font-display text-sm font-semibold">Money asleep</h2>
        <p className="text-xs text-(--color-faint)">
          {moneyCompact(total.toFixed(2))} of stock on hand, by how long it has been sitting.
          Open a band to see what is in it. Where a purchase covered several units, its cost
          is split evenly across them.
        </p>
      </div>
      <Card className="p-0">
        <ul className="divide-y divide-(--color-edge)">
          {groups.map((band) => {
            const expanded = open === band.label
            return (
              <li key={band.label}>
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : band.label)}
                  disabled={band.rows.length === 0}
                  className="w-full px-4 py-3 text-left transition-colors hover:bg-(--color-raised) disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
                >
                  <span className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="flex items-center gap-1.5">
                      {band.rows.length > 0 && (
                        <ChevronRight
                          size={14}
                          className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
                        />
                      )}
                      {band.label}
                    </span>
                    <span className="tabular-nums text-(--color-muted)">
                      {band.units} unit{band.units === 1 ? '' : 's'} ·{' '}
                      {moneyCompact(band.cost.toFixed(2))}
                    </span>
                  </span>
                  <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-(--color-raised)">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${(band.cost / peak) * 100}%`,
                        backgroundColor: band.colour,
                      }}
                    />
                  </span>
                </button>

                {expanded && (
                  <ul className="divide-y divide-(--color-edge) border-t border-(--color-edge) bg-(--color-ink)/30">
                    {band.rows.map((lot) => (
                      <li key={lot.purchase_id}>
                        <Link
                          to={`/products/${lot.product_id}`}
                          className="flex items-baseline justify-between gap-3 px-4 py-2.5 pl-9 text-sm transition-colors hover:bg-(--color-raised)"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <GameDot slug={lot.game_slug} />
                            <span className="truncate">{lot.product_name}</span>
                          </span>
                          <span className="shrink-0 text-right text-xs text-(--color-muted)">
                            {/* Not "2 × $900" - that reads as $1,800. The cost is the
                                total for the units left, not a unit price. */}
                            <span className="tabular-nums">
                              {lot.units} unit{lot.units === 1 ? '' : 's'} · {money(lot.cost)}
                            </span>
                            <span className="ml-2 tabular-nums text-(--color-faint)">
                              {lot.days_held === null
                                ? 'no purchase date'
                                : `${lot.days_held}d · bought ${shortDate(lot.purchase_date)}`}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </Card>
    </section>
  )
}
