/**
 * The data-entry forms.
 *
 * Each keeps the routine path short - quantity, amount, date - with everything else behind
 * Advanced, because the brief targets ~15 seconds for a purchase and ~10 for a sale.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import {
  ADJUSTMENT_REASONS,
  MARKETPLACES,
  api,
  type Product,
  type Transaction,
} from '../api'
import { humanise, money, percent, signedMoney, todayIso, toneFor } from '../format'
import { Advanced, Dialog, Field, FIELD_CLASS, GameDot, gameColour } from './ui'

function useLedgerMutation<T>(run: (input: T) => Promise<unknown>, onDone: () => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      // Every ledger write changes stock, cost basis and the dashboard, so refresh all of it.
      await queryClient.invalidateQueries()
      onDone()
    },
  })
}

const MONEY_INPUT = {
  type: 'text' as const,
  inputMode: 'decimal' as const,
  placeholder: '0.00',
  // Digits and at most two decimals. The server re-validates; this only stops typos early.
  pattern: '^\\d+(\\.\\d{1,2})?$',
}

export function AddProductDialog({ onClose }: { onClose: () => void }) {
  const games = useQuery({ queryKey: ['games'], queryFn: api.games })
  const types = useQuery({ queryKey: ['productTypes'], queryFn: api.productTypes })

  const [name, setName] = useState('')
  const [pickedGame, setGame] = useState('')
  const [pickedType, setType] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [amount, setAmount] = useState('')
  const [purchaseDate, setDate] = useState(todayIso())
  const [shipping, setShipping] = useState('')
  const [tax, setTax] = useState('')
  const [fees, setFees] = useState('')
  const [setLabel, setSetLabel] = useState('')
  const [storage, setStorage] = useState('')
  const [source, setSource] = useState('')

  const gameId = pickedGame || games.data?.[0]?.id || ''
  const typeId = pickedType || types.data?.[0]?.id || ''

  const create = useLedgerMutation(api.createProduct, onClose)

  function submit(event: FormEvent) {
    event.preventDefault()
    create.mutate({
      name: name.trim(),
      game_id: gameId,
      product_type_id: typeId,
      set_name: setLabel.trim() || null,
      storage_location: storage.trim() || null,
      initial_purchase: {
        quantity: Number(quantity),
        amount,
        shipping: shipping || undefined,
        tax: tax || undefined,
        fees: fees || undefined,
        purchase_date: purchaseDate,
        source: source.trim() || null,
      },
    })
  }

  return (
    <Dialog
      title="Add product"
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Save"
      busy={create.isPending}
      error={create.error ? (create.error as Error).message : null}
    >
      <Field label="Name">
        <input
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Vivid Voltage Booster Box"
          className={FIELD_CLASS}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Game">
          <select value={gameId} onChange={(e) => setGame(e.target.value)} className={FIELD_CLASS}>
            {games.data?.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Product type">
          <select value={typeId} onChange={(e) => setType(e.target.value)} className={FIELD_CLASS}>
            {types.data?.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Quantity">
          <input
            required
            type="number"
            min={1}
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
        <Field label="Total paid" hint="For all units together">
          <input
            required
            {...MONEY_INPUT}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
      </div>

      <Field label="Purchase date">
        <input
          required
          type="date"
          value={purchaseDate}
          onChange={(e) => setDate(e.target.value)}
          className={FIELD_CLASS}
        />
      </Field>

      <Advanced>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Shipping">
            <input
              {...MONEY_INPUT}
              value={shipping}
              onChange={(e) => setShipping(e.target.value)}
              className={FIELD_CLASS}
            />
          </Field>
          <Field label="Tax">
            <input
              {...MONEY_INPUT}
              value={tax}
              onChange={(e) => setTax(e.target.value)}
              className={FIELD_CLASS}
            />
          </Field>
          <Field label="Fees">
            <input
              {...MONEY_INPUT}
              value={fees}
              onChange={(e) => setFees(e.target.value)}
              className={FIELD_CLASS}
            />
          </Field>
        </div>
        <Field label="Set">
          <input
            value={setLabel}
            onChange={(e) => setSetLabel(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
        <Field label="Storage location">
          <input
            value={storage}
            onChange={(e) => setStorage(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
        <Field label="Bought from">
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
      </Advanced>
    </Dialog>
  )
}

export function AddPurchaseDialog({
  product,
  onClose,
}: {
  product: Product
  onClose: () => void
}) {
  const [quantity, setQuantity] = useState('1')
  const [amount, setAmount] = useState('')
  const [purchaseDate, setDate] = useState(todayIso())
  const [shipping, setShipping] = useState('')
  const [source, setSource] = useState('')

  const create = useLedgerMutation(api.createPurchase, onClose)

  return (
    <Dialog
      title={`Add purchase — ${product.name}`}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault()
        create.mutate({
          product_id: product.id,
          quantity: Number(quantity),
          amount,
          shipping: shipping || undefined,
          purchase_date: purchaseDate,
          source: source.trim() || null,
        })
      }}
      submitLabel="Save"
      busy={create.isPending}
      error={create.error ? (create.error as Error).message : null}
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Quantity">
          <input
            required
            autoFocus
            type="number"
            min={1}
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
        <Field label="Total paid">
          <input
            required
            {...MONEY_INPUT}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
      </div>
      <Field label="Date">
        <input
          required
          type="date"
          value={purchaseDate}
          onChange={(e) => setDate(e.target.value)}
          className={FIELD_CLASS}
        />
      </Field>
      <Advanced>
        <Field label="Shipping">
          <input
            {...MONEY_INPUT}
            value={shipping}
            onChange={(e) => setShipping(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
        <Field label="Bought from">
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
      </Advanced>
    </Dialog>
  )
}
export function RecordSaleDialog({
  product,
  onClose,
}: {
  /** Omitted when opened from a page header - the dialog then asks which product. */
  product?: Product
  onClose: () => void
}) {
  const members = useQuery({ queryKey: ['members'], queryFn: api.members })
  const [picked, setPicked] = useState<Product | undefined>(product)

  const [quantity, setQuantity] = useState('1')
  const [amount, setAmount] = useState('')
  const [saleDate, setDate] = useState(todayIso())
  const [soldBy, setSoldBy] = useState('')
  const [marketplace, setMarketplace] = useState('')
  const [platformFees, setPlatformFees] = useState('')
  const [paymentFees, setPaymentFees] = useState('')
  const [shippingPaid, setShippingPaid] = useState('')
  const [notes, setNotes] = useState('')
  const [allowOversell, setAllowOversell] = useState(false)

  const create = useLedgerMutation(api.createSale, onClose)

  // Computed by the server running the real FIFO engine. Doing it here would mean
  // re-implementing the engine in TypeScript and doing money arithmetic in floats, both
  // of which this project deliberately avoids.
  const preview = useQuery({
    queryKey: [
      'salePreview',
      picked?.id,
      quantity,
      amount,
      platformFees,
      paymentFees,
      shippingPaid,
      saleDate,
    ],
    enabled: Boolean(picked) && Number(quantity) > 0,
    queryFn: () =>
      api.previewSale({
        product_id: picked!.id,
        quantity: Number(quantity),
        amount: amount || '0',
        platform_fees: platformFees || '0',
        payment_fees: paymentFees || '0',
        shipping_paid: shippingPaid || '0',
        sale_date: saleDate,
      }),
  })

  function chooseMarketplace(name: string, feePercent: number) {
    setMarketplace(name)
    // Suggest the channel's usual cut so the common case needs no arithmetic. It stays
    // editable, because a promo or a store-credit deal changes it.
    if (amount && feePercent > 0) {
      setPlatformFees(((Number(amount) * feePercent) / 100).toFixed(2))
    }
  }

  if (!picked) {
    return <ProductPickerDialog onClose={onClose} onPick={setPicked} />
  }

  const math = preview.data

  return (
    <Dialog
      title="Record sale"
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault()
        create.mutate({
          product_id: picked.id,
          quantity: Number(quantity),
          amount,
          platform_fees: platformFees || undefined,
          payment_fees: paymentFees || undefined,
          shipping_paid: shippingPaid || undefined,
          sale_date: saleDate,
          sold_by_member_id: soldBy || null,
          marketplace: marketplace || null,
          notes: notes.trim() || null,
          allow_oversell: allowOversell,
        })
      }}
      submitLabel="Record sale"
      busy={create.isPending}
      error={create.error ? (create.error as Error).message : null}
    >
      <div className="flex items-center gap-3 rounded-lg border border-(--color-edge) bg-(--color-ink)/50 p-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-9 shrink-0 items-center justify-center rounded-md"
          style={{ background: `${gameColour(picked.game.slug)}22` }}
        >
          <GameDot slug={picked.game.slug} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{picked.name}</p>
          <p className="text-xs text-(--color-faint)">
            {picked.game.name} · {picked.product_type.name} · {picked.stats.quantity_on_hand} in
            stock · {money(picked.stats.average_unit_cost, '—')} avg cost
          </p>
        </div>
        {!product && (
          <button
            type="button"
            onClick={() => setPicked(undefined)}
            className="shrink-0 text-xs text-(--color-accent)"
          >
            Change
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Quantity">
          <input
            required
            autoFocus
            type="number"
            min={1}
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
        <Field label="Total received">
          <input
            required
            {...MONEY_INPUT}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
      </div>

      <div>
        <span className="text-sm font-medium text-(--color-muted)">Sold on</span>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {MARKETPLACES.map((option) => (
            <button
              key={option.name}
              type="button"
              onClick={() => chooseMarketplace(option.name, option.feePercent)}
              className={`rounded-full border px-3 py-1.5 text-[0.8125rem] transition-colors ${
                marketplace === option.name
                  ? 'border-transparent font-medium text-(--color-ink)'
                  : 'border-(--color-edge) text-(--color-muted) hover:text-(--color-text)'
              }`}
              style={marketplace === option.name ? { backgroundColor: option.colour } : undefined}
            >
              {option.name}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Sold by">
          <select value={soldBy} onChange={(e) => setSoldBy(e.target.value)} className={FIELD_CLASS}>
            <option value="">Me</option>
            {members.data?.map((member) => (
              <option key={member.id} value={member.id}>
                {member.display_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date">
          <input
            required
            type="date"
            value={saleDate}
            onChange={(e) => setDate(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
      </div>

      <Field label="Platform fees" hint="Suggested from the channel; edit if it differed">
        <input
          {...MONEY_INPUT}
          value={platformFees}
          onChange={(e) => setPlatformFees(e.target.value)}
          className={FIELD_CLASS}
        />
      </Field>

      {math && (
        <div className="space-y-2 rounded-lg border border-(--color-edge) bg-(--color-ink)/50 p-3.5 text-sm">
          <MathRow label="Gross" value={money(math.gross)} />
          <MathRow
            label="Fees"
            value={Number(math.fees) > 0 ? money((-Number(math.fees)).toFixed(2)) : money('0')}
            tone={Number(math.fees) > 0 ? 'text-(--color-loss)' : ''}
          />
          <MathRow
            label="Cost basis (FIFO)"
            value={math.has_unknown_cost ? 'Unknown' : money(math.cost_basis)}
            tone={math.has_unknown_cost ? 'text-(--color-warn)' : ''}
          />
          <div className="border-t border-(--color-edge) pt-2">
            <MathRow
              label="Realized profit"
              value={math.has_unknown_cost ? 'Unknown' : signedMoney(math.realized_profit)}
              tone={math.has_unknown_cost ? 'text-(--color-warn)' : toneFor(math.realized_profit)}
              strong
            />
            {math.roi !== null && (
              <MathRow label="ROI" value={percent(math.roi)} tone={toneFor(math.roi)} />
            )}
          </div>
          <p className="pt-1 text-xs text-(--color-faint)">
            Leaves {math.quantity_remaining} unit{math.quantity_remaining === 1 ? '' : 's'} on hand
            · {money(math.remaining_cost)} inventory at cost
          </p>
        </div>
      )}

      {math?.exceeds_stock && (
        <label className="flex items-start gap-2 rounded-lg border border-(--color-warn)/40 bg-(--color-warn)/10 p-3 text-sm">
          <input
            type="checkbox"
            checked={allowOversell}
            onChange={(e) => setAllowOversell(e.target.checked)}
            className="mt-1"
          />
          <span>
            This sells {math.quantity - math.quantity_available} more than recorded. Book it anyway
            — those units will have no known cost, so this sale keeps a profit of Unknown until the
            purchase is entered.
          </span>
        </label>
      )}

      <Advanced>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Payment fees">
            <input
              {...MONEY_INPUT}
              value={paymentFees}
              onChange={(e) => setPaymentFees(e.target.value)}
              className={FIELD_CLASS}
            />
          </Field>
          <Field label="Shipping paid">
            <input
              {...MONEY_INPUT}
              value={shippingPaid}
              onChange={(e) => setShippingPaid(e.target.value)}
              className={FIELD_CLASS}
            />
          </Field>
        </div>
        <Field label="Notes">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={FIELD_CLASS} />
        </Field>
      </Advanced>
    </Dialog>
  )
}

function MathRow({
  label,
  value,
  tone = '',
  strong = false,
}: {
  label: string
  value: string
  tone?: string
  strong?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={strong ? 'font-medium' : 'text-(--color-muted)'}>{label}</span>
      <span
        className={`tabular-nums ${strong ? 'font-display text-base font-semibold' : ''} ${tone}`}
      >
        {value}
      </span>
    </div>
  )
}

/** Asked first when the dialog is opened without a product already in hand. */
function ProductPickerDialog({
  onClose,
  onPick,
}: {
  onClose: () => void
  onPick: (product: Product) => void
}) {
  const [search, setSearch] = useState('')
  const products = useQuery({
    queryKey: ['products', 'picker', search],
    queryFn: () => api.products({ q: search || undefined, stock: 'in' }),
  })

  return (
    <Dialog
      title="Record sale"
      onClose={onClose}
      onSubmit={(event) => event.preventDefault()}
      submitLabel="Pick a product"
      busy
    >
      <Field label="Which product?">
        <input
          autoFocus
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products in stock…"
          className={FIELD_CLASS}
        />
      </Field>

      <ul className="max-h-72 space-y-1.5 overflow-y-auto">
        {products.data?.items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onPick(item)}
              className="flex w-full items-center gap-3 rounded-lg border border-(--color-edge) p-2.5 text-left transition-colors hover:border-(--color-edge-strong) hover:bg-(--color-raised)"
            >
              <span
                aria-hidden="true"
                className="flex h-10 w-8 shrink-0 items-center justify-center rounded-md"
                style={{ background: `${gameColour(item.game.slug)}22` }}
              >
                <GameDot slug={item.game.slug} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{item.name}</span>
                <span className="block text-xs text-(--color-faint)">
                  {item.game.name} · {item.product_type.name}
                </span>
              </span>
              <span className="shrink-0 text-right text-xs">
                <span className="block tabular-nums">{item.stats.quantity_on_hand} in stock</span>
                <span className="block tabular-nums text-(--color-faint)">
                  {money(item.stats.average_unit_cost, '—')}
                </span>
              </span>
            </button>
          </li>
        ))}
        {products.data?.items.length === 0 && (
          <li className="py-6 text-center text-sm text-(--color-muted)">
            Nothing in stock matches that.
          </li>
        )}
      </ul>
    </Dialog>
  )
}

export function AdjustStockDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const [delta, setDelta] = useState('-1')
  const [reason, setReason] = useState('damaged')
  const [cost, setCost] = useState('')
  const [notes, setNotes] = useState('')

  const create = useLedgerMutation(api.createAdjustment, onClose)
  const adding = Number(delta) > 0

  return (
    <Dialog
      title={`Adjust stock — ${product.name}`}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault()
        create.mutate({
          product_id: product.id,
          quantity_delta: Number(delta),
          reason,
          cost: adding && cost ? cost : null,
          adjustment_date: todayIso(),
          notes: notes.trim() || null,
        })
      }}
      submitLabel="Save"
      busy={create.isPending}
      error={create.error ? (create.error as Error).message : null}
    >
      <p className="text-sm text-(--color-muted)">
        {product.stats.quantity_on_hand} in stock. Use a negative number to remove.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Change">
          <input
            required
            autoFocus
            type="number"
            inputMode="numeric"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
        <Field label="Reason">
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={FIELD_CLASS}
          >
            {ADJUSTMENT_REASONS.map((option) => (
              <option key={option} value={option}>
                {humanise(option)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {adding && (
        <Field label="Cost of these units" hint="Leave blank if unknown — never guess">
          <input
            {...MONEY_INPUT}
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
      )}

      <Field label="Notes">
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className={FIELD_CLASS} />
      </Field>
    </Dialog>
  )
}

export function EditProductDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const games = useQuery({ queryKey: ['games'], queryFn: api.games })
  const types = useQuery({ queryKey: ['productTypes'], queryFn: api.productTypes })

  const [name, setName] = useState(product.name)
  const [gameId, setGame] = useState(product.game.id)
  const [typeId, setType] = useState(product.product_type.id)
  const [setName_, setSetName] = useState(product.set_name ?? '')
  const [storage, setStorage] = useState(product.storage_location ?? '')

  const update = useLedgerMutation(
    (changes: Parameters<typeof api.updateProduct>[1]) => api.updateProduct(product.id, changes),
    onClose,
  )

  return (
    <Dialog
      title="Edit product"
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault()
        update.mutate({
          name: name.trim(),
          game_id: gameId,
          product_type_id: typeId,
          set_name: setName_.trim() || null,
          storage_location: storage.trim() || null,
        })
      }}
      submitLabel="Save changes"
      busy={update.isPending}
      error={update.error ? (update.error as Error).message : null}
    >
      <Field label="Name">
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={FIELD_CLASS}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Game">
          <select value={gameId} onChange={(e) => setGame(e.target.value)} className={FIELD_CLASS}>
            {games.data?.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Product type">
          <select value={typeId} onChange={(e) => setType(e.target.value)} className={FIELD_CLASS}>
            {types.data?.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Set">
        <input
          value={setName_}
          onChange={(e) => setSetName(e.target.value)}
          className={FIELD_CLASS}
        />
      </Field>
      <Field label="Storage location">
        <input
          value={storage}
          onChange={(e) => setStorage(e.target.value)}
          className={FIELD_CLASS}
        />
      </Field>
    </Dialog>
  )
}

export function VoidDialog({
  kind,
  id,
  onClose,
}: {
  kind: 'purchase' | 'sale' | 'adjustment'
  id: string
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const run = useLedgerMutation(
    (value: string) => api.voidTransaction(kind, id, value),
    onClose,
  )

  return (
    <Dialog
      title={`Void ${kind}`}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault()
        run.mutate(reason.trim())
      }}
      submitLabel="Void it"
      busy={run.isPending}
      error={run.error ? (run.error as Error).message : null}
    >
      <p className="text-sm text-(--color-muted)">
        The transaction stays in the history, marked voided, and stock and profit are
        recalculated without it. Other figures may change as a result.
      </p>
      <Field label="Reason">
        <input
          required
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Entered twice"
          className={FIELD_CLASS}
        />
      </Field>
    </Dialog>
  )
}

/**
 * Correcting a transaction after the fact.
 *
 * One dialog for all three kinds rather than three near-identical ones: they differ only
 * in their middle block, and share the date, notes, audit reason and the warning.
 *
 * Only fields the user actually touches are sent, so an untouched field is never
 * overwritten and the audit diff stays honest about what changed.
 */
export function EditTransactionDialog({
  transaction,
  onClose,
}: {
  transaction: Transaction
  onClose: () => void
}) {
  const members = useQuery({ queryKey: ['members'], queryFn: api.members })

  // History shows movement, so a sale of 3 arrives as -3 while an adjustment of -1 is
  // genuinely -1. Purchases and sales edit as a positive count; an adjustment keeps its
  // sign, or saving an untouched write-off would flip it into added stock.
  const [quantity, setQuantity] = useState(
    String(transaction.kind === 'adjustment' ? transaction.quantity : Math.abs(transaction.quantity)),
  )
  const [amount, setAmount] = useState(transaction.amount ?? '')
  const [occurredOn, setOccurredOn] = useState(transaction.occurred_on ?? todayIso())
  const [label, setLabel] = useState(transaction.label ?? '')
  const [member, setMember] = useState(transaction.member_id ?? '')
  const [notes, setNotes] = useState(transaction.notes ?? '')
  const [auditReason, setAuditReason] = useState('')

  const update = useLedgerMutation((changes: Record<string, unknown>) => {
    if (transaction.kind === 'purchase') return api.updatePurchase(transaction.id, changes)
    if (transaction.kind === 'sale') return api.updateSale(transaction.id, changes)
    return api.updateAdjustment(transaction.id, changes)
  }, onClose)

  function submit(event: FormEvent) {
    event.preventDefault()
    const changes: Record<string, unknown> = {}

    if (transaction.kind === 'adjustment') {
      // The sign lives in the field for an adjustment - the user types -2, not 2.
      if (Number(quantity) !== transaction.quantity) changes.quantity_delta = Number(quantity)
      if (label !== (transaction.label ?? '')) changes.reason = label
      if (occurredOn !== transaction.occurred_on) changes.adjustment_date = occurredOn
      if (member !== (transaction.member_id ?? '')) changes.member_id = member || null
      if (auditReason.trim()) changes.audit_reason = auditReason.trim()
    } else {
      if (Number(quantity) !== Math.abs(transaction.quantity)) changes.quantity = Number(quantity)
      if (amount !== (transaction.amount ?? '')) changes.amount = amount
      if (occurredOn !== transaction.occurred_on) {
        changes[transaction.kind === 'purchase' ? 'purchase_date' : 'sale_date'] = occurredOn
      }
      if (label !== (transaction.label ?? '')) {
        changes[transaction.kind === 'purchase' ? 'source' : 'marketplace'] = label || null
      }
      if (member !== (transaction.member_id ?? '')) {
        changes[
          transaction.kind === 'purchase' ? 'purchased_by_member_id' : 'sold_by_member_id'
        ] = member || null
      }
      if (auditReason.trim()) changes.reason = auditReason.trim()
    }

    if (notes !== (transaction.notes ?? '')) changes.notes = notes.trim() || null

    update.mutate(changes)
  }

  const isAdjustment = transaction.kind === 'adjustment'

  return (
    <Dialog
      title={`Edit ${transaction.kind}`}
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Save changes"
      busy={update.isPending}
      error={update.error ? (update.error as Error).message : null}
    >
      <p className="rounded-lg border border-(--color-warn)/40 bg-(--color-warn)/10 p-3 text-sm text-(--color-warn)">
        Editing re-runs FIFO for this product. Profit on sales that already looked settled
        can move as a result — that is correct, and the change is recorded in the audit
        trail.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <Field
          label={isAdjustment ? 'Change' : 'Quantity'}
          hint={isAdjustment ? 'Negative removes stock' : undefined}
        >
          <input
            required
            type="number"
            min={isAdjustment ? undefined : 1}
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>

        {isAdjustment ? (
          <Field label="Reason">
            <select
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className={FIELD_CLASS}
            >
              {ADJUSTMENT_REASONS.map((option) => (
                <option key={option} value={option}>
                  {humanise(option)}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label={transaction.kind === 'purchase' ? 'Total paid' : 'Total received'}>
            <input
              required
              {...MONEY_INPUT}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={FIELD_CLASS}
            />
          </Field>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Date">
          <input
            required
            type="date"
            value={occurredOn}
            onChange={(e) => setOccurredOn(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
        <Field label={transaction.kind === 'sale' ? 'Sold by' : 'Member'}>
          <select
            value={member}
            onChange={(e) => setMember(e.target.value)}
            className={FIELD_CLASS}
          >
            <option value="">Unassigned</option>
            {members.data?.map((option) => (
              <option key={option.id} value={option.id}>
                {option.display_name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {!isAdjustment && (
        <Field label={transaction.kind === 'purchase' ? 'Bought from' : 'Sold on'}>
          <input value={label} onChange={(e) => setLabel(e.target.value)} className={FIELD_CLASS} />
        </Field>
      )}

      <Field label="Notes">
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className={FIELD_CLASS} />
      </Field>

      <Field label="Why the change?" hint="Optional, stored on the audit entry">
        <input
          value={auditReason}
          onChange={(e) => setAuditReason(e.target.value)}
          placeholder="Receipt said 500, not 300"
          className={FIELD_CLASS}
        />
      </Field>
    </Dialog>
  )
}
