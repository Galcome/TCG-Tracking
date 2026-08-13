import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api, BUCKET_LABELS, BUCKETS, type Transaction } from '../api'
import {
  AddPurchaseDialog,
  AdjustStockDialog,
  EditItemDialog,
  EditTransactionDialog,
  MoveStockDialog,
  RecordSaleDialog,
  VoidDialog,
} from '../components/forms'
import { CrackCaseDialog, VoidTransformationDialog } from '../components/crack-forms'
import {
  ArrowLeft,
  ArrowLeftRight,
  Minus,
  Package,
  Pencil,
  Plus,
  Receipt,
} from 'lucide-react'

import {
  Button,
  Card,
  Empty,
  FifoNote,
  GameDot,
  RowAction,
  Skeleton,
  Stat,
  StatSkeleton,
} from '../components/ui'
import { humanise, money, percent, shortDate, signedMoney, toneFor } from '../format'

type Dialog = 'purchase' | 'sale' | 'adjust' | 'edit' | 'move' | 'crack' | null

/**
 * What this came out of, and what it became.
 *
 * Shown on both sides of every transformation because the chain is the point: a graded hit
 * is only interesting when you can see it came out of a box that came out of the Fabled
 * case. One row is where that chain gets walked.
 */
function Lineage({
  productId,
  onUndo,
}: {
  productId: string
  onUndo: (id: string) => void
}) {
  const found = useQuery({
    queryKey: ['transformations', productId],
    queryFn: () => api.transformations({ product_id: productId }),
  })

  const rows = found.data ?? []
  if (rows.length === 0) return null

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-(--color-muted)">
        Opened
      </h2>
      <Card className="p-0">
        <ul className="divide-y divide-(--color-edge)">
          {rows.map((row) => (
            <li
              key={row.id}
              className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm ${
                row.status === 'voided' ? 'text-(--color-muted) line-through' : ''
              }`}
            >
              <span className="min-w-0">
                {row.source_quantity}&times; {row.source_product_name}
                <span className="mx-2 text-(--color-faint)">&rarr;</span>
                {row.outputs
                  .map(
                    (output) =>
                      `${output.quantity} ${output.product_name} (${BUCKET_LABELS[output.bucket]})`,
                  )
                  .join(', ')}
                {row.status === 'voided' && <span className="ml-2 text-xs">(undone)</span>}
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-(--color-faint)">
                  {money(row.source_cost, 'cost unknown')}
                  {row.inherited_purchase_date &&
                    ` · dated ${shortDate(row.inherited_purchase_date)}`}
                </span>
                {row.status !== 'voided' && (
                  <RowAction onClick={() => onUndo(row.id)}>Undo</RowAction>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  )
}

export function ProductDetail() {
  const { productId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [dialog, setDialog] = useState<Dialog>(null)
  const [voiding, setVoiding] = useState<Transaction | null>(null)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [undoing, setUndoing] = useState<string | null>(null)

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
          All stock
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
            <Button type="button" onClick={() => setDialog('move')} variant="ghost">
              <ArrowLeftRight size={15} />
              Move
            </Button>
            <Button type="button" onClick={() => setDialog('crack')} variant="ghost">
              <Package size={15} />
              Crack open
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
          hint={
            BUCKETS.filter((bucket) => stats.by_bucket[bucket] !== 0)
              .map((bucket) => `${stats.by_bucket[bucket]} ${BUCKET_LABELS[bucket].toLowerCase()}`)
              .join(' · ') || `${stats.quantity_purchased} bought · ${stats.quantity_sold} sold`
          }
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
                    onClick={() =>
                      row.status !== 'voided' && row.kind !== 'move' && setEditing(row)
                    }
                    className={
                      row.status === 'voided'
                        ? 'text-(--color-muted) line-through'
                        : row.kind === 'move'
                          ? 'transition-colors hover:bg-(--color-raised)'
                          : 'cursor-pointer transition-colors hover:bg-(--color-raised)'
                    }
                  >
                    <td className="whitespace-nowrap px-4 py-3">{shortDate(row.occurred_on)}</td>
                    <td className="px-4 py-3">
                      {humanise(row.kind)}
                      {/* Quantity reads 0 in its own column on purpose, so the count has
                          to live here or the row never says how much moved. */}
                      {row.kind === 'move' && row.from_bucket && row.bucket ? (
                        <span className="ml-2 text-xs text-(--color-muted)">
                          {row.label} · {BUCKET_LABELS[row.from_bucket]} →{' '}
                          {BUCKET_LABELS[row.bucket]}
                        </span>
                      ) : (
                        row.label && (
                          <span className="ml-2 text-xs text-(--color-muted)">
                            {humanise(row.label)}
                          </span>
                        )
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
                    <td
                      className="whitespace-nowrap px-4 py-3 text-right"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {row.status !== 'voided' && (
                        <span className="flex justify-end gap-2">
                          {/* A move has nothing to edit: it records where stock went, and
                              the correction for a wrong one is to void it. */}
                          {row.kind !== 'move' && (
                          <button
                            type="button"
                            onClick={() => setEditing(row)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-(--color-edge) px-2.5 py-1.5 text-xs text-(--color-text) transition-colors hover:border-(--color-accent) hover:bg-(--color-accent)/10 hover:text-(--color-accent)"
                          >
                            <Pencil size={13} />
                            Edit
                          </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setVoiding(row)}
                            className="rounded-md border border-(--color-edge) px-2.5 py-1.5 text-xs text-(--color-muted) transition-colors hover:border-(--color-loss)/50 hover:text-(--color-loss)"
                          >
                            Void
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </section>

      <Lineage productId={item.id} onUndo={setUndoing} />

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
      {dialog === 'edit' && <EditItemDialog productId={item.id} onClose={() => setDialog(null)} />}
      {dialog === 'move' && <MoveStockDialog product={item} onClose={() => setDialog(null)} />}
      {dialog === 'crack' && <CrackCaseDialog product={item} onClose={() => setDialog(null)} />}
      {undoing && <VoidTransformationDialog id={undoing} onClose={() => setUndoing(null)} />}
      {voiding && (
        <VoidDialog kind={voiding.kind} id={voiding.id} onClose={() => setVoiding(null)} />
      )}
      {editing && (
        <EditTransactionDialog transaction={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}
