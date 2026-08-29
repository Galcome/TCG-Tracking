import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import {
  api,
  BUCKET_LABELS,
  BUCKETS,
  type CatalogMapping,
  type CatalogMappingDraft,
  type GradingSubmission,
  type Product,
  type Transaction,
} from '../api'
import {
  AddPurchaseDialog,
  AdjustStockDialog,
  EditItemDialog,
  EditTransactionDialog,
  MoveStockDialog,
  RecordSaleDialog,
  VoidDialog,
} from '../components/forms'
import { canCrack, canRip } from '../product-types'
import { CrackCaseDialog, VoidTransformationDialog } from '../components/crack-forms'
import { RipDialog } from '../components/rip-forms'
import { LineageReport } from '../components/rollups'
import {
  ReturnFromGradingDialog,
  SendToGradingDialog,
} from '../components/grading-forms'
import {
  ArrowLeft,
  ArrowLeftRight,
  Minus,
  Package,
  Pencil,
  Scissors,
  Stamp,
  Plus,
  Receipt,
} from 'lucide-react'

import {
  Button,
  Card,
  Empty,
  Field,
  FIELD_CLASS,
  FifoNote,
  GameDot,
  RowAction,
  Skeleton,
  Stat,
  StatSkeleton,
} from '../components/ui'
import { humanise, money, percent, shortDate, signedMoney, toneFor } from '../format'

type Dialog =
  | 'purchase'
  | 'sale'
  | 'adjust'
  | 'edit'
  | 'move'
  | 'crack'
  | 'rip'
  | 'grade'
  | null

const FREE_MARKET_PRICING_TYPES = new Set(['single', 'raw-single', 'booster-box', 'sealed-case'])

const EMPTY_MAPPING: CatalogMappingDraft = {
  external_product_id: '',
  external_group_id: '',
  external_category_id: '',
  subtype_name: 'Normal',
}

function canUseFreeMarketPricing(product: Product): boolean {
  if (!FREE_MARKET_PRICING_TYPES.has(product.product_type.slug)) return false
  return !product.grading_company && !product.grade && !product.cert_number
}

function mappingDraft(mapping: CatalogMapping | null): CatalogMappingDraft {
  if (!mapping) return EMPTY_MAPPING
  return {
    external_product_id: mapping.external_product_id,
    external_group_id: mapping.external_group_id ?? '',
    external_category_id: mapping.external_category_id ?? '',
    subtype_name: mapping.subtype_name,
  }
}

function PricingMappingEditor({ productId }: { productId: string }) {
  const queryClient = useQueryClient()
  const mappings = useQuery({
    queryKey: ['pricingMappings', productId],
    queryFn: () => api.pricingMappings(productId),
  })
  const mapping = mappings.data?.[0] ?? null
  const [draftOverride, setDraftOverride] = useState<CatalogMappingDraft | null>(null)
  const [refreshResult, setRefreshResult] = useState<string | null>(null)
  const draft = draftOverride ?? mappingDraft(mapping)

  const invalidatePricing = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pricingMappings', productId] }),
      queryClient.invalidateQueries({ queryKey: ['product', productId] }),
      queryClient.invalidateQueries({ queryKey: ['products'] }),
      queryClient.invalidateQueries({ queryKey: ['vaultHoldings'] }),
    ])
  }

  const save = useMutation({
    mutationFn: () =>
      mapping
        ? api.updatePricingMapping(mapping.id, { ...draft, match_status: 'confirmed' })
        : api.createPricingMapping(draft),
    onSuccess: async () => {
      setDraftOverride(null)
      await invalidatePricing()
    },
  })

  const toggle = useMutation({
    mutationFn: () =>
      api.updatePricingMapping(mapping!.id, {
        match_status: mapping!.match_status === 'disabled' ? 'confirmed' : 'disabled',
      }),
    onSuccess: invalidatePricing,
  })

  const refresh = useMutation({
    mutationFn: api.refreshPricing,
    onSuccess: async (result) => {
      setRefreshResult(
        `Checked ${result.attempted}: ${result.refreshed} refreshed, ${result.skipped} skipped, ` +
          `${result.stale} stale, ${result.unavailable} unavailable.`,
      )
      await invalidatePricing()
    },
  })

  if (mappings.isLoading) {
    return <Skeleton className="h-48 w-full" />
  }

  if (mappings.isError) {
    return (
      <p className="rounded-lg border border-(--color-loss)/40 bg-(--color-loss)/10 px-3 py-2 text-sm text-(--color-loss)">
        {(mappings.error as Error).message}
      </p>
    )
  }

  const updateField = (field: keyof CatalogMappingDraft, value: string) => {
    setDraftOverride((current) => ({ ...(current ?? draft), [field]: value }))
  }
  const mutationError = save.error ?? toggle.error ?? refresh.error

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-(--color-muted)">
          Free-source market estimate
        </h2>
        <span className="text-xs text-(--color-faint)">per unit · display only · CAD</span>
      </div>
      <Card>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            save.mutate()
          }}
        >
          <p className="mb-4 text-sm text-(--color-muted)">
            Confirm the exact TCGCSV printing before refreshing. This estimate never changes cost,
            inventory, Vault value, or profit, and TCGCSV market prices are not condition-specific.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Provider">
              <select value="tcgcsv" disabled className={FIELD_CLASS}>
                <option value="tcgcsv">TCGCSV</option>
              </select>
            </Field>
            <Field label="Subtype / printing" hint="For example Normal or Holofoil.">
              <input
                required
                value={draft.subtype_name}
                onChange={(event) => updateField('subtype_name', event.target.value)}
                className={FIELD_CLASS}
              />
            </Field>
            <Field label="Category ID" hint="TCGCSV numeric category.">
              <input
                required
                inputMode="numeric"
                pattern="[0-9]+"
                value={draft.external_category_id ?? ''}
                onChange={(event) => updateField('external_category_id', event.target.value)}
                className={FIELD_CLASS}
              />
            </Field>
            <Field label="Group ID" hint="TCGCSV numeric group.">
              <input
                required
                inputMode="numeric"
                pattern="[0-9]+"
                value={draft.external_group_id ?? ''}
                onChange={(event) => updateField('external_group_id', event.target.value)}
                className={FIELD_CLASS}
              />
            </Field>
            <Field label="Product ID" hint="TCGCSV numeric product.">
              <input
                required
                inputMode="numeric"
                pattern="[0-9]+"
                value={draft.external_product_id}
                onChange={(event) => updateField('external_product_id', event.target.value)}
                className={FIELD_CLASS}
              />
            </Field>
          </div>

          {mapping && (
            <p className="mt-4 text-xs text-(--color-faint)">
              Mapping is {mapping.match_status}. Saving confirms the identity again.
            </p>
          )}

          {mutationError && (
            <p className="mt-4 rounded-lg border border-(--color-loss)/40 bg-(--color-loss)/10 px-3 py-2 text-sm text-(--color-loss)">
              {(mutationError as Error).message}
            </p>
          )}
          {refreshResult && <p className="mt-4 text-xs text-(--color-muted)">{refreshResult}</p>}

          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : mapping ? 'Save and confirm' : 'Confirm mapping'}
            </Button>
            {mapping && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => toggle.mutate()}
                disabled={toggle.isPending}
              >
                {toggle.isPending
                  ? 'Updating…'
                  : mapping.match_status === 'disabled'
                    ? 'Re-enable mapping'
                    : 'Disable mapping'}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={() => refresh.mutate()}
              disabled={!mapping || mapping.match_status !== 'confirmed' || refresh.isPending}
            >
              {refresh.isPending ? 'Refreshing…' : 'Refresh confirmed estimates'}
            </Button>
          </div>
        </form>
      </Card>
    </section>
  )
}

/**
 * What this card has away at a grader.
 *
 * The flag Joseph chose instead of an "Out" state, with the day count that was the
 * condition of choosing it - a card quietly sitting at PSA for four months should be
 * visible without anybody going looking. Tapping it is how the return gets recorded.
 */
function AtTheGrader({
  productId,
  onReturn,
}: {
  productId: string
  onReturn: (submission: GradingSubmission) => void
}) {
  const found = useQuery({
    queryKey: ['grading', productId],
    queryFn: () => api.gradingSubmissions({ product_id: productId, out_only: true }),
  })

  const rows = found.data ?? []
  if (rows.length === 0) return null

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-(--color-muted)">
        At the grader
      </h2>
      <Card className="p-0">
        <ul className="divide-y divide-(--color-edge)">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <span>
                {row.quantity}&times; at {row.grading_company ?? 'a grader'}
                <span className="ml-2 text-xs text-(--color-faint)">
                  sent {shortDate(row.sent_on)} &middot; {money(row.fees)} in fees
                </span>
              </span>
              <span className="flex items-center gap-3">
                {/* The number the whole flag exists for. */}
                <span
                  className={`text-xs tabular-nums ${
                    row.days_out > 90 ? 'text-(--color-loss)' : 'text-(--color-faint)'
                  }`}
                >
                  {row.days_out} days out
                </span>
                <RowAction onClick={() => onReturn(row)}>It came back</RowAction>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  )
}

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
                  {Number(row.bulk_cost) > 0 &&
                    ` · ${money(row.bulk_cost)} bulk`}
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
  const [returning, setReturning] = useState<GradingSubmission | null>(null)

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
            {(item.collector_number || item.variant || item.language || item.grading_company) && (
              <p className="mt-1 text-xs text-(--color-faint)">
                {[item.collector_number, item.variant, item.language]
                  .filter(Boolean)
                  .join(' · ')}
                {item.grading_company &&
                  ` · ${item.grading_company}${item.grade ? ` ${item.grade}` : ''}`}
              </p>
            )}
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
            {/* Only what this thing can actually become. A card is not a container, and
                offering to crack one is not a harmless button: it worked, consuming the
                card and producing "boxes" out of it. The API refuses these too — this
                just stops anyone being invited to try. */}
            {canCrack(item.product_type.slug) && (
              <Button type="button" onClick={() => setDialog('crack')} variant="ghost">
                <Package size={15} />
                Crack open
              </Button>
            )}
            {canRip(item.product_type.slug) && (
              <Button type="button" onClick={() => setDialog('rip')} variant="ghost">
                <Scissors size={15} />
                Rip open
              </Button>
            )}
            <Button type="button" onClick={() => setDialog('grade')} variant="ghost">
              <Stamp size={15} />
              Send to grading
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
        <Stat
          label="Market estimate"
          value={money(item.market_estimate?.value, '—')}
          hint={
            item.market_estimate
              ? `${item.market_estimate.provider} · ${item.market_estimate.status}${
                  item.market_estimate.captured_on
                    ? ` · ${shortDate(item.market_estimate.captured_on)}`
                    : ''
                } · per unit, display only`
              : 'No confirmed free-source mapping'
          }
        />
      </div>

      {canUseFreeMarketPricing(item) && <PricingMappingEditor productId={item.id} />}

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

      <LineageReport productId={item.id} />

      <AtTheGrader productId={item.id} onReturn={setReturning} />

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
      {dialog === 'rip' && <RipDialog product={item} onClose={() => setDialog(null)} />}
      {dialog === 'grade' && (
        <SendToGradingDialog product={item} onClose={() => setDialog(null)} />
      )}
      {returning && (
        <ReturnFromGradingDialog
          product={item}
          submissionId={returning.id}
          gradingCompany={returning.grading_company}
          onClose={() => setReturning(null)}
        />
      )}
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
