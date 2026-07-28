import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, type GroupRow, type Period } from '../api'
import { Card, Empty, FifoNote } from '../components/ui'
import { money, percent, signedMoney, toneFor } from '../format'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'ytd', label: 'This year' },
  { value: 'mtd', label: 'This month' },
  { value: '30d', label: 'Last 30 days' },
]

export function Reports() {
  const [period, setPeriod] = useState<Period>('all')

  const byGame = useQuery({ queryKey: ['byGame', period], queryFn: () => api.byGame(period) })
  const bySeller = useQuery({
    queryKey: ['bySeller', period],
    queryFn: () => api.bySeller(period),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold lg:text-2xl">Reports</h1>
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

      <GroupTable
        title="By game"
        rows={byGame.data ?? []}
        firstColumn="Game"
        showInventory
        empty="Nothing sold or in stock yet."
      />

      <GroupTable
        title="By seller"
        rows={bySeller.data ?? []}
        firstColumn="Member"
        empty="No sales recorded yet."
        note="Performance only. All inventory belongs to the store, not to the person who sold it."
      />

      <FifoNote />
    </div>
  )
}

function GroupTable({
  title,
  rows,
  firstColumn,
  showInventory = false,
  empty,
  note,
}: {
  title: string
  rows: GroupRow[]
  firstColumn: string
  showInventory?: boolean
  empty: string
  note?: string
}) {
  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-(--color-muted)">
        {title}
      </h2>
      {note && <p className="mb-3 text-xs text-(--color-muted)">{note}</p>}

      <Card className="overflow-x-auto p-0">
        {rows.length === 0 ? (
          <Empty>{empty}</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-(--color-edge) text-left text-xs uppercase tracking-wide text-(--color-muted)">
              <tr>
                <th className="px-4 py-3 font-medium">{firstColumn}</th>
                <th className="px-4 py-3 text-right font-medium">Profit</th>
                <th className="px-4 py-3 text-right font-medium">ROI</th>
                <th className="px-4 py-3 text-right font-medium">Revenue</th>
                <th className="px-4 py-3 text-right font-medium">Sales</th>
                {showInventory && (
                  <th className="px-4 py-3 text-right font-medium">Inventory at cost</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-(--color-edge)">
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className="px-4 py-3">
                    {row.label}
                    {row.sales_missing_cost > 0 && (
                      <span className="ml-2 text-xs text-(--color-muted)">
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
                  <td className="px-4 py-3 text-right tabular-nums">{row.sale_count}</td>
                  {showInventory && (
                    <td className="px-4 py-3 text-right tabular-nums">
                      {money(row.inventory_at_cost)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </section>
  )
}
