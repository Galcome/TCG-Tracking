import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api, type Transaction } from '../api'
import {
  AddPurchaseDialog,
  AdjustStockDialog,
  EditProductDialog,
  RecordSaleDialog,
  VoidDialog,
} from '../components/forms'
import { ArrowLeft, Minus, Pencil, Plus, Receipt } from 'lucide-react'

import {
  Button,
  Card,
  Empty,
  FifoNote,
  GameDot,
  Skeleton,
  Stat,
  StatSkeleton,
} from '../components/ui'
import { humanise, money, percent, shortDate, signedMoney, toneFor } from '../format'

type Dialog = 'purchase' | 'sale' | 'adjust' | 'edit' | null

export function ProductDetail() {
  const { productId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [dialog, setDialog] = useState<Dialog>(null)
  const [voiding, setVoiding] = useState<Transaction | null>(null)

  const product = useQuery({
    queryKey: ['product', productId],
    queryFn: () => api.product(productId),
  })

  const remove = useMutation({
    mutationFn: () => api.deleteProduct(productId),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      navigate('/inventory')
    },
  })

  const archive = useMutation({
    mutationFn: (value: boolean) => api.updateProduct(productId, { is_archived: value }),
    onSuccess: () => queryClient.invalidateQueries(),
  })

  if (product.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-72" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <StatSkeleton key={index} />
          ))}
        </div>
        <Skeleton className="h-56 w-full" />
      </div>
    )
  }
  if (product.isError)
    return (
      <p className="rounded-lg border border-(--color-loss)/40 bg-(--color-loss)/10 px-3 py-2 text-sm text-(--color-loss)">
        {(product.error as Error).message}
      </p>
    )
  if (!product.data) return null

  const item = product.data
  const stats = item.stats

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/inventory"
          className="inline-flex items-center gap-1.5 text-sm text-(--color-muted) transition-colors hover:text-(--color-accent)"
        >
          <ArrowLeft size={15} />
          Inventory
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold lg:text-3xl">{item.name}</h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-(--color-muted)">
              <GameDot slug={item.game.slug} />
              {item.game.name} · {item.product_type.name}
              {item.set_name && ` · ${item.set_name}`}
              {item.storage_location && ` · ${item.storage_location}`}
              {item.is_archived && (
                <span className="rounded-full border border-(--color-edge) px-2 py-0.5 text-xs">
                  Archived
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => setDialog('purchase')}>
              <Plus size={15} strokeWidth={2.5} />
              Add purchase
            </Button>
            <Button type="button" onClick={() => setDialog('sale')} variant="ghost">
              <Receipt size={15} />
              Record sale
            </Button>
            <Button type="button" onClick={() => setDialog('adjust')} variant="ghost">
              <Minus size={15} />
              Adjust stock
            </Button>
            <Button type="button" onClick={() => setDialog('edit')} variant="ghost">
              <Pencil size={15} />
              Edit
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="In stock"
          value={String(stats.quantity_on_hand)}
          tone={stats.quantity_on_hand < 0 ? 'text-(--color-loss)' : ''}
          emphasis
          hint={`${stats.quantity_purchased} bought · ${stats.quantity_sold} sold`}
        />
        <Stat
          label="Realized profit"
          value={signedMoney(stats.realized_profit)}
          tone={toneFor(stats.realized_profit)}
          emphasis
          hint={
            stats.sales_missing_cost
              ? `${stats.sales_missing_cost} sale(s) excluded — cost unknown`
              : undefined
          }
        />
        <Stat label="ROI" value={percent(stats.roi)} tone={toneFor(stats.roi)} />
        <Stat label="Inventory at cost" value={money(stats.remaining_cost)} />

        <Stat label="Total invested" value={money(stats.total_invested)} />
        <Stat label="Revenue" value={money(stats.gross_revenue)} />
        <Stat label="Cost of sales" value={money(stats.cost_of_sales)} />
        <Stat label="Average unit cost" value={money(stats.average_unit_cost, '—')} />
      </div>

      {Number(stats.cost_written_off) > 0 && (
        <p className="text-sm text-(--color-muted)">
          {money(stats.cost_written_off)} written off via adjustments. Not counted as a
          trading loss.
        </p>
      )}

      <FifoNote />

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-(--color-muted)">
          History
        </h2>
        <Card className="overflow-x-auto p-0">
          {item.history.length === 0 ? (
            <Empty>Nothing recorded yet.</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-(--color-edge) text-left text-xs uppercase tracking-wide text-(--color-muted)">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Event</th>
                  <th className="px-4 py-3 text-right font-medium">Qty</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                  <th className="px-4 py-3 text-right font-medium">Cost</th>
                  <th className="px-4 py-3 text-right font-medium">Profit</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-edge)">
                {item.history.map((row) => (
                  <tr
                    key={row.id}
                    className={row.status === 'voided' ? 'text-(--color-muted) line-through' : ''}
                  >
                    <td className="whitespace-nowrap px-4 py-3">{shortDate(row.occurred_on)}</td>
                    <td className="px-4 py-3">
                      {humanise(row.kind)}
                      {row.label && (
                        <span className="ml-2 text-xs text-(--color-muted)">
                          {humanise(row.label)}
                        </span>
                      )}
                      {row.status === 'voided' && (
                        <span className="ml-2 text-xs">(voided)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.quantity > 0 ? `+${row.quantity}` : row.quantity}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(row.amount, '—')}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.kind === 'sale' && row.has_unknown_cost
                        ? 'Unknown'
                        : money(row.cost, '—')}
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums ${toneFor(row.profit)}`}
                    >
                      {row.kind === 'sale' ? signedMoney(row.profit) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.status !== 'voided' && (
                        <button
                          type="button"
                          onClick={() => setVoiding(row)}
                          className="text-xs text-(--color-muted) hover:text-(--color-loss)"
                        >
                          Void
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </section>

      <section className="flex flex-wrap items-center gap-3 border-t border-(--color-edge) pt-5">
        <Button
          type="button"
          variant="ghost"
          onClick={() => archive.mutate(!item.is_archived)}
          disabled={archive.isPending}
        >
          {item.is_archived ? 'Unarchive' : 'Archive'}
        </Button>
        <Button
          type="button"
          variant="danger"
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
        >
          Delete
        </Button>
        {remove.error && (
          <p className="text-sm text-(--color-muted)">{(remove.error as Error).message}</p>
        )}
      </section>

      {dialog === 'purchase' && (
        <AddPurchaseDialog product={item} onClose={() => setDialog(null)} />
      )}
      {dialog === 'sale' && <RecordSaleDialog product={item} onClose={() => setDialog(null)} />}
      {dialog === 'adjust' && (
        <AdjustStockDialog product={item} onClose={() => setDialog(null)} />
      )}
      {dialog === 'edit' && <EditProductDialog product={item} onClose={() => setDialog(null)} />}
      {voiding && (
        <VoidDialog kind={voiding.kind} id={voiding.id} onClose={() => setVoiding(null)} />
      )}
    </div>
  )
}
