/**
 * The data-entry forms.
 *
 * Each keeps the routine path short - quantity, amount, date - with everything else behind
 * Advanced, because the brief targets ~15 seconds for a purchase and ~10 for a sale.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { ADJUSTMENT_REASONS, api, type Product } from '../api'
import { humanise, todayIso } from '../format'
import { Advanced, Dialog, Field, FIELD_CLASS } from './ui'

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

export function RecordSaleDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const members = useQuery({ queryKey: ['members'], queryFn: api.members })

  const [quantity, setQuantity] = useState('1')
  const [amount, setAmount] = useState('')
  const [saleDate, setDate] = useState(todayIso())
  const [soldBy, setSoldBy] = useState('')
  const [platformFees, setPlatformFees] = useState('')
  const [paymentFees, setPaymentFees] = useState('')
  const [shippingPaid, setShippingPaid] = useState('')
  const [marketplace, setMarketplace] = useState('')
  const [allowOversell, setAllowOversell] = useState(false)

  const create = useLedgerMutation(api.createSale, onClose)
  const stock = product.stats.quantity_on_hand
  const oversellRefused =
    create.error instanceof Error && create.error.message.includes('in stock')

  return (
    <Dialog
      title={`Record sale — ${product.name}`}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault()
        create.mutate({
          product_id: product.id,
          quantity: Number(quantity),
          amount,
          platform_fees: platformFees || undefined,
          payment_fees: paymentFees || undefined,
          shipping_paid: shippingPaid || undefined,
          sale_date: saleDate,
          sold_by_member_id: soldBy || null,
          marketplace: marketplace.trim() || null,
          allow_oversell: allowOversell,
        })
      }}
      submitLabel="Save"
      busy={create.isPending}
      error={create.error ? (create.error as Error).message : null}
    >
      <p className="text-sm text-(--color-muted)">
        {stock} in stock
        {stock <= 0 && ' — recording a sale will leave stock negative'}
      </p>

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

      {oversellRefused && (
        <label className="flex items-start gap-2 rounded-lg border border-amber-500/40 p-3 text-sm">
          <input
            type="checkbox"
            checked={allowOversell}
            onChange={(e) => setAllowOversell(e.target.checked)}
            className="mt-1"
          />
          <span>
            Record it anyway. The missing units will have no known cost, so this sale's profit
            will show as Unknown until the purchase is entered.
          </span>
        </label>
      )}

      <Advanced>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Platform fees">
            <input
              {...MONEY_INPUT}
              value={platformFees}
              onChange={(e) => setPlatformFees(e.target.value)}
              className={FIELD_CLASS}
            />
          </Field>
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
        <Field label="Sold on">
          <input
            value={marketplace}
            onChange={(e) => setMarketplace(e.target.value)}
            placeholder="eBay, Facebook, in person…"
            className={FIELD_CLASS}
          />
        </Field>
      </Advanced>
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
