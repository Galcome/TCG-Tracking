import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  api,
  type AgingLot,
  type GroupBy,
  type GroupRow,
  type Period,
  type Product,
  type ReportFilters,
} from '../api'
import { downloadCsv, percentCell, UNKNOWN } from '../csv'
import { PageHeader, type PageActions } from '../components/AppShell'
import { SetReport, TierReport } from '../components/rollups'
import { VaultReport } from '../components/vault-report'
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
  { value: 'set-performance', label: 'Set', noun: 'set' },
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
  const [filters, setFilters] = useState<ReportFilters>({})

  const rows = useQuery({
    queryKey: ['group', groupBy, period, filters],
    queryFn: () => api.group(groupBy, period, filters),
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

  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  /**
   * Whatever is on screen, as a file.
   *
   * Exports the *filtered* rows deliberately. An export that ignores the controls above it
   * is a different dataset wearing the same name, and nobody would notice until they built
   * a decision on it.
   */
  function exportGroups() {
    downloadCsv(
      `tcg-by-${groupBy}`,
      [
        noun, 'units_purchased', 'units_sold', 'units_in_stock',
        'revenue', 'cost_of_sales', 'realized_profit', 'roi_percent',
        'inventory_at_cost', 'avg_days_held', 'sell_through_percent', 'profit_per_day',
        'sales_missing_cost',
      ],
      sorted.map((row) => [
        row.label,
        row.units_purchased,
        row.units_sold,
        row.units_in_stock,
        row.revenue,
        row.cost_of_sales,
        row.realized_profit,
        percentCell(row.roi),
        row.inventory_at_cost,
        row.avg_days_held ?? UNKNOWN,
        percentCell(row.sell_through),
        row.profit_per_day ?? UNKNOWN,
        row.sales_missing_cost,
      ]),
    )
  }

  /**
   * Every product with stock, paged.
   *
   * Paged rather than asked for in one go: the endpoint caps a page at 200, and a request
   * for more is rejected outright - which produced a file containing nothing but a header
   * and no hint that anything had gone wrong. A silently truncated export is the same
   * class of error as a silently truncated total.
   */
  async function exportInventory() {
    setExporting(true)
    setExportError(null)
    try {
      const items: Product[] = []
      const size = 200
      for (let offset = 0; ; offset += size) {
        const page = await api.products({ stock: 'in', limit: size, offset })
        items.push(...page.items)
        if (page.items.length < size || items.length >= page.total) break
      }

      downloadCsv(
        'tcg-inventory',
        [
          'product', 'set', 'game', 'type', 'language',
          'units', 'inventory', 'store', 'vault',
          'unit_cost', 'inventory_at_cost', 'realized_profit_to_date',
        ],
        items.map((item) => [
          item.name,
          item.set_name ?? UNKNOWN,
          item.game.name,
          item.product_type.name,
          item.language ?? UNKNOWN,
          item.stats.quantity_on_hand,
          item.stats.by_bucket.inventory,
          item.stats.by_bucket.store,
          item.stats.by_bucket.vault,
          item.stats.average_unit_cost ?? UNKNOWN,
          item.stats.remaining_cost,
          item.stats.realized_profit,
        ]),
      )
    } catch (error) {
      // Said out loud. A failed export that hands over an empty file is worse than one
      // that refuses, because the file looks like an answer.
      setExportError((error as Error).message)
    } finally {
      setExporting(false)
    }
  }

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

      {exportError && (
        <p className="rounded-lg border border-(--color-loss)/40 bg-(--color-loss)/10 px-3 py-2 text-sm text-(--color-loss)">
          {exportError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ReportFilterBar value={filters} onChange={setFilters} />
        <div className="flex gap-2">
          <ExportButton onClick={exportGroups} disabled={sorted.length === 0}>
            This view
          </ExportButton>
          <ExportButton onClick={exportInventory} disabled={exporting}>
            {exporting ? 'Collecting…' : 'Inventory'}
          </ExportButton>
        </div>
      </div>

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

      <CapitalAndConcentration rows={sorted} />

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
          The Vault
        </h2>
        <p className="mb-3 text-xs text-(--color-faint)">
          Held on purpose, measured on what it has gained rather than how fast it moves.
        </p>
        <VaultReport />
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
 * What the money is doing, and how much of it is riding on one bet.
 *
 * The reports answered "what did we make?" well and never answered the two questions a
 * person putting money in actually asks: how much is committed, and how exposed are we.
 *
 * Everything here is already computed - `total_invested`, `net_proceeds`,
 * `inventory_at_cost` and `cost_written_off` all come off the dashboard aggregate, and the
 * concentration is the grouped rows the page already has. No new query.
 *
 * Deliberately **not** here: IRR, XIRR, or anything annualised. Those look authoritative
 * and mean nothing across a few months and a few dozen trades - the same class of error as
 * quoting a fee rate nobody checked.
 */
function CapitalAndConcentration({ rows }: { rows: GroupRow[] }) {
  const dashboard = useQuery({
    queryKey: ['dashboard', 'all'],
    queryFn: () => api.dashboard('all'),
  })

  if (!dashboard.data) return <Skeleton className="h-40 w-full" />

  const committed = Number(dashboard.data.total_invested)
  const returned = Number(dashboard.data.net_proceeds)
  const atRisk = Number(dashboard.data.inventory_at_cost)
  const writtenOff = Number(dashboard.data.cost_written_off)

  // Of what has been committed, how much has come back. The honest headline for a pooled
  // fund: not profit, which says nothing about how much had to be tied up to get it.
  const recovered = committed > 0 ? returned / committed : null

  // Concentration, largest first. Share of what is *still at risk*, because capital
  // already returned is not exposed to anything.
  const exposure = rows
    .map((row) => ({ label: row.label, cost: Number(row.inventory_at_cost) }))
    .filter((row) => row.cost > 0)
    .sort((a, b) => b.cost - a.cost)
  const exposed = exposure.reduce((sum, row) => sum + row.cost, 0)
  const top = exposure[0]

  return (
    <section>
      <div className="mb-2.5">
        <h2 className="font-display text-sm font-semibold">Where the capital is</h2>
        <p className="text-xs text-(--color-faint)">
          What the group has committed, what has come back, and what is still on the shelf.
        </p>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Figure label="Committed" value={money(committed.toFixed(2))} />
          <Figure
            label="Returned"
            value={money(returned.toFixed(2))}
            note={recovered === null ? undefined : `${percent(recovered)} of committed`}
            tone="text-(--color-gain)"
          />
          <Figure label="Still at risk" value={money(atRisk.toFixed(2))} />
          <Figure
            label="Written off"
            value={money(writtenOff.toFixed(2))}
            tone={writtenOff > 0 ? 'text-(--color-loss)' : undefined}
          />
        </div>

        {exposure.length > 0 && (
          <div className="mt-5 border-t border-(--color-edge) pt-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs uppercase tracking-wide text-(--color-faint)">
                Concentration
              </span>
              {top && (
                <span className="text-xs text-(--color-muted)">
                  {percent(top.cost / exposed)} in {top.label}
                </span>
              )}
            </div>

            <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-(--color-ink)/60">
              {exposure.slice(0, 6).map((row, index) => (
                <span
                  key={row.label}
                  title={`${row.label}: ${money(row.cost.toFixed(2))}`}
                  style={{
                    width: `${(row.cost / exposed) * 100}%`,
                    backgroundColor: gameColour(slugOf(row.label)),
                    opacity: 1 - index * 0.13,
                  }}
                />
              ))}
            </div>

            <p className="mt-2 text-xs text-(--color-faint)">
              Share of what is still at risk. Money already returned is not exposed to
              anything, so it is left out of this bar deliberately.
            </p>
          </div>
        )}
      </Card>
    </section>
  )
}

/** One figure with its label, and an optional line of context under it. */
function Figure({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: string
  note?: string
  tone?: string
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-(--color-faint)">{label}</p>
      <p className={`mt-1 font-display text-xl tabular-nums ${tone ?? ''}`}>{value}</p>
      {note && <p className="mt-0.5 text-xs text-(--color-muted)">{note}</p>}
    </div>
  )
}

/** A small outline button, so the exports read as tools rather than page actions. */
function ExportButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border border-(--color-edge) px-2.5 py-1.5 text-xs text-(--color-muted) transition-colors hover:border-(--color-edge-strong) hover:text-(--color-text) disabled:opacity-40"
    >
      <Download size={13} />
      {children}
    </button>
  )
}

/**
 * Narrows every section on the page at once.
 *
 * One control rather than one per card, because a page where the table is filtered and the
 * chart beside it is not shows two different datasets under one heading. The filter goes
 * to the server, so the numbers are recomputed rather than hidden - a row filtered out in
 * the browser would still be inside the totals.
 *
 * Bucket is deliberately absent: a bucket belongs to stock rather than to a product, so
 * "filter by Store" could mean stock sitting there now or sales that came out of it, and
 * silently picking one is worse than not offering it.
 */
function ReportFilterBar({
  value,
  onChange,
}: {
  value: ReportFilters
  onChange: (next: ReportFilters) => void
}) {
  const games = useQuery({ queryKey: ['games'], queryFn: api.games })
  const types = useQuery({ queryKey: ['productTypes'], queryFn: api.productTypes })

  // Sets belong to a game, so the set list waits for one. That is not a limitation to
  // work around - a flat list of every set across six games is unusable, and picking the
  // game first is the step that makes the second dropdown short.
  const gameSlug = games.data?.find((option) => option.id === value.game_id)?.slug
  const sets = useQuery({
    queryKey: ['sets', gameSlug],
    enabled: Boolean(gameSlug),
    queryFn: () => api.sets({ game: gameSlug! }),
  })

  const active = Object.values(value).filter(Boolean).length

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-(--color-faint)">Filter</span>

      <select
        aria-label="Filter by game"
        value={value.game_id ?? ''}
        // Clearing the game clears the set too: a set belongs to a game, and leaving a
        // Lorcana set selected under Pokemon would return nothing and look broken.
        onChange={(e) => onChange({ ...value, game_id: e.target.value || undefined, set_id: undefined })}
        className={FILTER_CLASS}
      >
        <option value="">All games</option>
        {games.data?.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by set"
        value={value.set_id ?? ''}
        disabled={!gameSlug}
        onChange={(e) => onChange({ ...value, set_id: e.target.value || undefined })}
        className={`${FILTER_CLASS} disabled:opacity-40`}
      >
        <option value="">{gameSlug ? 'All sets' : 'All sets — pick a game'}</option>
        {(sets.data?.items ?? []).map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by product type"
        value={value.product_type_id ?? ''}
        onChange={(e) => onChange({ ...value, product_type_id: e.target.value || undefined })}
        className={FILTER_CLASS}
      >
        <option value="">All types</option>
        {types.data?.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>

      {active > 0 && (
        <button
          type="button"
          onClick={() => onChange({})}
          className="text-xs text-(--color-accent) hover:underline"
        >
          Clear
        </button>
      )}
    </div>
  )
}

const FILTER_CLASS =
  'rounded-lg border border-(--color-edge) bg-(--color-surface)/70 px-2.5 py-1.5 text-[0.8125rem] text-(--color-text) outline-none transition-colors hover:border-(--color-edge-strong) focus:border-(--color-accent)'

/**
 * Return against time held.
 *
 * **A scatter has to earn its place.** With one or two points its whole language - shape,
 * clustering, outliers - says nothing, and it degrades badly. The first version floored the
 * x-axis at 30 days, so same-day sales crushed into the leftmost 3% of an empty plot, and
 * mapped the best return to `top: 0`, which drew the winning dot half outside the chart.
 * Below `SCATTER_MIN` points this draws a ranked bar instead, which reads at one row and
 * says the same thing.
 *
 * Dot labels are absolutely-positioned HTML over the plot: SVG <text> inside a map does not
 * lay out reliably across browsers, and HTML gives ellipsis truncation for free.
 */
const SCATTER_MIN = 5

/** Keeps the plot clear of its edges, so a dot at an extreme is still drawn whole. */
const INSET = 8

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

  const ranked = [...plotted].sort((a, b) => (b.roi ?? 0) - (a.roi ?? 0))

  return (
    <section>
      <div className="mb-2.5">
        <h2 className="font-display text-sm font-semibold">Return vs. time held</h2>
        <p className="text-xs text-(--color-faint)">
          {plotted.length < SCATTER_MIN
            ? `Return per ${noun}, best first. With a few more it becomes a scatter of return against how long each took to sell.`
            : `Each dot is a ${noun}. Up is more profitable, left is faster to sell. Dot size is units sold.`}
        </p>
      </div>

      {plotted.length < SCATTER_MIN ? (
        <RankedReturn rows={ranked} />
      ) : (
        <ReturnScatter rows={plotted} />
      )}
    </section>
  )
}

/**
 * The small-N view: one labelled row per group, sorted by return.
 *
 * The label gets its own line, which is the entire point - in the scatter it was a 96px
 * truncated box fighting every other label for the same pixels.
 *
 * A negative return runs left from the centre rather than being clamped to nothing: a loss
 * has to look like a loss.
 *
 * Coloured by outcome rather than by game. `gameColour` takes a game slug, and every
 * grouping except Game passes it a product, channel or seller name - which fell through to
 * the grey "other" and said nothing. Green for profit, red for loss, matching the figure
 * printed beside it.
 */
function RankedReturn({ rows }: { rows: GroupRow[] }) {
  const widest = Math.max(...rows.map((row) => Math.abs(row.roi ?? 0)), 0.01)
  const anyLoss = rows.some((row) => (row.roi ?? 0) < 0)

  return (
    <Card className="p-4">
      <ul className="space-y-3.5">
        {rows.map((row) => {
          const roi = row.roi ?? 0
          const share = (Math.abs(roi) / widest) * 100
          return (
            <li key={row.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{row.label}</span>
                <span
                  className={`shrink-0 tabular-nums ${roi < 0 ? 'text-(--color-loss)' : 'text-(--color-gain)'}`}
                >
                  {percent(roi)}
                </span>
              </div>

              <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-(--color-ink)/60">
                {anyLoss && (
                  <span className="flex h-full w-1/2 justify-end">
                    {roi < 0 && (
                      <span
                        className="h-full rounded-l-full bg-(--color-loss)"
                        style={{ width: `${share}%` }}
                      />
                    )}
                  </span>
                )}
                <span className={`flex h-full ${anyLoss ? 'w-1/2' : 'w-full'}`}>
                  {roi >= 0 && (
                    <span
                      className="h-full rounded-r-full bg-(--color-gain)"
                      style={{ width: `${share}%` }}
                    />
                  )}
                </span>
              </div>

              <p className="mt-1 text-[0.6875rem] text-(--color-faint)">
                {row.units_sold} sold · {row.avg_days_held}d to sell ·{' '}
                {money(row.realized_profit)}
              </p>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/** The scatter proper, drawn only once there are enough points to read a shape from. */
function ReturnScatter({ rows }: { rows: GroupRow[] }) {
  const days = rows.map((row) => row.avg_days_held ?? 0)
  const rois = rows.map((row) => row.roi ?? 0)

  // Scaled to the data, never to a hardcoded 30 days. The pad keeps extremes off the edges,
  // and a zero span - every sale on the same day - still yields a usable range rather than
  // dividing by nothing.
  const dayLo = Math.min(...days)
  const dayHi = Math.max(...days)
  const daySpan = dayHi - dayLo || Math.max(dayHi, 1)
  const roiLo = Math.min(...rois, 0)
  const roiHi = Math.max(...rois)
  const roiSpan = roiHi - roiLo || Math.abs(roiHi) || 0.1

  const maxUnits = Math.max(...rows.map((row) => row.units_sold), 1)

  const span = 100 - INSET * 2
  const x = (d: number) => INSET + ((d - dayLo + daySpan * 0.08) / (daySpan * 1.16)) * span
  const y = (r: number) => INSET + ((roiHi - r + roiSpan * 0.08) / (roiSpan * 1.16)) * span
  const radius = (units: number) => 6 + Math.sqrt(units / maxUnits) * 14

  // Label the biggest sellers, dropping any whose box would sit on one already placed. A
  // missing label beats a pile of overlapping ones, and every dot keeps its tooltip.
  const placed: { x: number; y: number }[] = []
  const labelled = [...rows]
    .sort((a, b) => b.units_sold - a.units_sold)
    .filter((row) => {
      const at = { x: x(row.avg_days_held ?? 0), y: y(row.roi ?? 0) }
      if (placed.some((seen) => Math.abs(seen.x - at.x) < 18 && Math.abs(seen.y - at.y) < 12)) {
        return false
      }
      placed.push(at)
      return true
    })
    .slice(0, 8)

  return (
    <Card className="p-4">
      {/* Captions sit in the gutters, outside the plot. Inside, the top-left one was exactly
          where the best performer always lands, so the winner collided with it every time. */}
      <div className="mb-1 pl-12 text-[0.625rem] font-semibold tracking-[0.12em] text-(--color-gain)">
        FAST + HIGH RETURN
      </div>

      <div className="flex gap-2">
        <div className="flex w-10 shrink-0 flex-col justify-between py-1 text-right text-[0.625rem] tabular-nums text-(--color-faint)">
          <span>{percent(roiHi)}</span>
          {roiLo < 0 && <span>0%</span>}
          <span>{percent(roiLo)}</span>
        </div>

        <div className="relative h-72 w-full rounded bg-(--color-ink)/30">
          <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-(--color-edge)" />
          <div className="absolute inset-y-0 left-1/2 border-l border-dashed border-(--color-edge)" />

          {/* Break-even, drawn only when something actually lost money. */}
          {roiLo < 0 && (
            <div
              className="absolute inset-x-0 border-t border-(--color-loss)/40"
              style={{ top: `${y(0)}%` }}
            />
          )}

          {rows.map((row) => {
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

          {labelled.map((row) => (
            <span
              key={`${row.key}-label`}
              className="pointer-events-none absolute max-w-28 -translate-x-1/2 translate-y-3 truncate text-center text-[0.625rem] text-(--color-muted)"
              style={{
                left: `${x(row.avg_days_held ?? 0)}%`,
                top: `${y(row.roi ?? 0)}%`,
              }}
            >
              {row.label}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-2 flex justify-between pl-12 text-[0.625rem] text-(--color-faint)">
        <span>{dayLo}d</span>
        <span>AVERAGE DAYS HELD BEFORE SALE</span>
        <span>{dayHi}d</span>
      </div>
      <p className="mt-1 text-right text-[0.625rem] font-semibold tracking-[0.12em] text-(--color-loss)">
        SLOW + LOW RETURN
      </p>
    </Card>
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
