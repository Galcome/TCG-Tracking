import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { api, MARKETPLACES, type Period, type SaleRow } from '../api'
import { PageHeader, initials, type PageActions } from '../components/AppShell'
import { Card, Empty, FIELD_CLASS, GameDot, Skeleton, Stat } from '../components/ui'
import { money, shortDate, signedMoney, toneFor } from '../format'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'ytd', label: 'Year' },
  { value: 'mtd', label: 'Month' },
  { value: '30d', label: '30 days' },
]

function marketplaceColour(name: string | null): string {
  return MARKETPLACES.find((m) => m.name === name)?.colour ?? 'var(--color-game-other)'
}

/** platform + payment fees. Shipping paid is a cost but not a channel fee. */
function channelFees(sale: SaleRow): number {
  return Number(sale.platform_fees) + Number(sale.payment_fees)
}

function saleRoi(sale: SaleRow): number | null {
  if (sale.cost_basis === null || Number(sale.cost_basis) <= 0) return null
  return Number(sale.realized_profit) / Number(sale.cost_basis)
}

export function Sales({ onRecordSale, onAddProduct }: PageActions) {
  const [period, setPeriod] = useState<Period>('all')
  const [search, setSearch] = useState('')
  const [marketplace, setMarketplace] = useState('')
  const [seller, setSeller] = useState('')

  const members = useQuery({ queryKey: ['members'], queryFn: api.members })
  const sales = useQuery({
    queryKey: ['sales', period, search, marketplace, seller],
    queryFn: () =>
      api.sales({
        period,
        q: search || undefined,
        marketplace: marketplace || undefined,
        sold_by_member_id: seller || undefined,
        limit: 200,
      }),
  })

  const rows = useMemo(() => sales.data?.items ?? [], [sales.data])
  const memberName = useMemo(
    () => Object.fromEntries((members.data ?? []).map((m) => [m.id, m.display_name])),
    [members.data],
  )

  // Tiles summarise the rows actually on screen, so they always agree with the table
  // below rather than describing a different query.
  const totals = useMemo(() => {
    const live = rows.filter((row) => row.status !== 'voided')
    const net = live.reduce((sum, row) => sum + Number(row.net_proceeds), 0)
    const fees = live.reduce((sum, row) => sum + channelFees(row), 0)
    const profit = live
      .filter((row) => row.realized_profit !== null)
      .reduce((sum, row) => sum + Number(row.realized_profit), 0)
    const unknown = live.filter((row) => row.has_unknown_cost).length

    const byChannel = new Map<string, number>()
    for (const row of live) {
      const key = row.marketplace ?? 'Unspecified'
      byChannel.set(key, (byChannel.get(key) ?? 0) + Number(row.net_proceeds))
    }
    const best = [...byChannel.entries()].sort((a, b) => b[1] - a[1])[0]

    return { net, fees, profit, unknown, best, count: live.length }
  }, [rows])

  function exportCsv() {
    const header = [
      'date', 'product', 'game', 'marketplace', 'sold_by', 'quantity',
      'gross', 'fees', 'net', 'cost_basis', 'profit', 'status',
    ]
    const body = rows.map((row) => [
      row.sale_date ?? '',
      row.product.name,
      row.product.game.name,
      row.marketplace ?? '',
      row.sold_by_member_id ? (memberName[row.sold_by_member_id] ?? '') : '',
      row.quantity,
      row.amount,
      channelFees(row).toFixed(2),
      row.net_proceeds,
      // Empty, not 0 - an unknown cost must not become a number in a spreadsheet.
      row.cost_basis ?? '',
      row.realized_profit ?? '',
      row.status,
    ])
    const csv = [header, ...body]
      .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `tcg-sales-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Sales" onRecordSale={onRecordSale} onAddProduct={onAddProduct}>
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Net proceeds" value={money(totals.net.toFixed(2))} emphasis />
        <Stat
          label="Realized profit"
          value={signedMoney(totals.profit.toFixed(2))}
          tone={toneFor(totals.profit)}
          emphasis
          hint={totals.unknown ? `${totals.unknown} excluded — cost unknown` : undefined}
        />
        <Stat
          label="Fees paid"
          value={money((-totals.fees).toFixed(2))}
          tone={totals.fees > 0 ? 'text-(--color-loss)' : ''}
        />
        <Stat
          label="Best channel"
          value={totals.best ? totals.best[0] : '—'}
          hint={totals.best ? money(totals.best[1].toFixed(2)) : undefined}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by product…"
          className={`${FIELD_CLASS} mt-0`}
        />
        <select
          value={marketplace}
          onChange={(e) => setMarketplace(e.target.value)}
          className={`${FIELD_CLASS} mt-0 sm:w-44`}
        >
          <option value="">All channels</option>
          {MARKETPLACES.map((option) => (
            <option key={option.name} value={option.name}>
              {option.name}
            </option>
          ))}
          <option value="Unspecified">Unspecified</option>
        </select>
        <select
          value={seller}
          onChange={(e) => setSeller(e.target.value)}
          className={`${FIELD_CLASS} mt-0 sm:w-44`}
        >
          <option value="">All sellers</option>
          {members.data?.map((option) => (
            <option key={option.id} value={option.id}>
              {option.display_name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={exportCsv}
          disabled={rows.length === 0}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-(--color-edge) px-4 py-2.5 text-sm transition-colors hover:border-(--color-edge-strong) hover:bg-(--color-raised) disabled:opacity-40"
        >
          <Download size={15} />
          CSV
        </button>
      </div>

      {sales.isLoading && (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <Skeleton key={row} className="h-14 w-full" />
          ))}
        </div>
      )}

      {sales.isError && (
        <p className="rounded-lg border border-(--color-loss)/40 bg-(--color-loss)/10 px-3 py-2 text-sm text-(--color-loss)">
          {(sales.error as Error).message}
        </p>
      )}

      {sales.data && rows.length === 0 && (
        <Card>
          <Empty>
            {search || marketplace || seller
              ? 'No sales match those filters.'
              : 'Nothing sold yet. Record your first sale and the ledger fills in.'}
          </Empty>
        </Card>
      )}

      {rows.length > 0 && (
        <>
          <Card className="hidden overflow-x-auto p-0 lg:block">
            <table className="w-full text-sm">
              <thead className="border-b border-(--color-edge) text-left text-[0.6875rem] uppercase tracking-wide text-(--color-faint)">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Sold on</th>
                  <th className="px-4 py-3 font-medium">Sold by</th>
                  <th className="px-4 py-3 text-right font-medium">Qty</th>
                  <th className="px-4 py-3 text-right font-medium">Gross</th>
                  <th className="px-4 py-3 text-right font-medium">Fees</th>
                  <th className="px-4 py-3 text-right font-medium">Net</th>
                  <th className="px-4 py-3 text-right font-medium">Profit</th>
                  <th className="px-4 py-3 text-right font-medium">ROI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-edge)">
                {rows.map((row) => {
                  const voided = row.status === 'voided'
                  const roi = saleRoi(row)
                  return (
                    <tr
                      key={row.id}
                      className={`transition-colors hover:bg-(--color-raised) ${
                        voided ? 'text-(--color-faint) line-through' : ''
                      }`}
                    >
                      <td className="whitespace-nowrap px-4 py-3">{shortDate(row.sale_date)}</td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/products/${row.product_id}`}
                          className="font-medium transition-colors hover:text-(--color-accent)"
                        >
                          {row.product.name}
                        </Link>
                        <span className="ml-2 inline-flex items-center gap-1.5 text-xs text-(--color-faint)">
                          <GameDot slug={row.product.game.slug} />
                          {row.product.game.name}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="inline-block rounded-full px-2 py-0.5 text-xs"
                          style={{
                            color: marketplaceColour(row.marketplace),
                            backgroundColor: `${marketplaceColour(row.marketplace)}1a`,
                          }}
                        >
                          {row.marketplace ?? 'Unspecified'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {row.sold_by_member_id && (
                          <span className="inline-flex items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="font-display inline-flex h-6 w-6 items-center justify-center rounded-md text-[0.625rem] font-bold text-(--color-ink)"
                              style={{ background: 'linear-gradient(150deg, #1d7fd4, #a55eea)' }}
                            >
                              {initials(memberName[row.sold_by_member_id] ?? '?')}
                            </span>
                            <span className="text-(--color-muted)">
                              {memberName[row.sold_by_member_id] ?? 'Unknown'}
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.quantity}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(row.amount)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-(--color-loss)">
                        {channelFees(row) > 0 ? money((-channelFees(row)).toFixed(2)) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {money(row.net_proceeds)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums ${toneFor(row.realized_profit)}`}
                      >
                        {row.has_unknown_cost ? 'Unknown' : signedMoney(row.realized_profit)}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${toneFor(roi)}`}>
                        {roi === null ? '—' : `${roi > 0 ? '+' : ''}${(roi * 100).toFixed(1)}%`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>

          <ul className="space-y-2 lg:hidden">
            {rows.map((row) => (
              <li key={row.id}>
                <Card interactive className={row.status === 'voided' ? 'opacity-60' : ''}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link to={`/products/${row.product_id}`} className="block truncate font-medium">
                        {row.product.name}
                      </Link>
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-(--color-faint)">
                        {shortDate(row.sale_date)} · {row.quantity}x
                        <span style={{ color: marketplaceColour(row.marketplace) }}>
                          {row.marketplace ?? 'Unspecified'}
                        </span>
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm tabular-nums">{money(row.net_proceeds)}</p>
                      <p className={`text-xs tabular-nums ${toneFor(row.realized_profit)}`}>
                        {row.has_unknown_cost ? 'Unknown' : signedMoney(row.realized_profit)}
                      </p>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>

          <p className="text-xs text-(--color-faint)">
            {totals.count} sale{totals.count === 1 ? '' : 's'} shown
            {sales.data && sales.data.total > rows.length && ` of ${sales.data.total}`}
          </p>
        </>
      )}
    </div>
  )
}
