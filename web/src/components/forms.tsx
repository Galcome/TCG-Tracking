/**
 * The data-entry forms.
 *
 * Each keeps the routine path short - quantity, amount, date - with everything else behind
 * Advanced, because the brief targets ~15 seconds for a purchase and ~10 for a sale.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'

import {
  ADJUSTMENT_REASONS,
  BUCKET_LABELS,
  BUCKETS,
  LANGUAGES,
  MARKETPLACES,
  api,
  type Account,
  type Bucket,
  type Product,
  type ProductDetail,
  type Transaction,
} from '../api'
import { humanise, money, percent, signedMoney, todayIso, toneFor } from '../format'
import { namedByItsSet, suggestedProductName } from '../product-types'
import { Advanced, Chip, Dialog, Field, FIELD_CLASS, GameDot, gameColour } from './ui'

export function useLedgerMutation<T>(run: (input: T) => Promise<unknown>, onDone: () => void) {
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

export /** Debounce so typing a set name does not fire a request per keystroke. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

export const MONEY_INPUT = {
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
  const [nameTouched, setNameTouched] = useState(false)
  const [pickedGame, setGame] = useState('')
  const [pickedType, setType] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [amount, setAmount] = useState('')
  const [purchaseDate, setDate] = useState(todayIso())
  const [shipping, setShipping] = useState('')
  const [tax, setTax] = useState('')
  const [fees, setFees] = useState('')
  const [setLabel, setSetLabel] = useState('')
  const [collectorNumber, setCollectorNumber] = useState('')
  const [variant, setVariant] = useState('')
  const [language, setLanguage] = useState<string>('English')
  const [storage, setStorage] = useState('')
  const [source, setSource] = useState('')
  const [bucket, setBucket] = useState<Bucket>('inventory')
  const [paidFrom, setPaidFrom] = useState('')

  const { accounts, mine } = useMyAccount()
  // Defaults to whoever is entering it, because that is who usually paid. One tap moves
  // it to the joint account or to another partner, and it stays editable afterwards.
  const fundedBy = paidFrom || mine?.id || ''

  const gameId = pickedGame || games.data?.[0]?.id || ''
  const typeId = pickedType || types.data?.[0]?.id || ''

  // The name writes itself from the set and the type, because for sealed product that is
  // literally what it is called - the old placeholder was "Vivid Voltage Booster Box",
  // which is exactly this, typed out by hand every time.
  //
  // `nameTouched` is the whole safety of it: the moment somebody types in the field, the
  // app stops writing to it for good. Without that, correcting a name and then fixing a
  // typo in the set would silently throw the correction away - a worse bug than the one
  // being fixed, because it destroys work the person watched themselves do.
  const chosenType = types.data?.find((option) => option.id === typeId)
  const derivedName = suggestedProductName(setLabel, chosenType)
  const effectiveName = nameTouched ? name : derivedName

  // A card is named after the card, and only the person holding it knows that. Nothing is
  // derived, so the empty field is the one worth landing in.
  const nameIsTheirs = !namedByItsSet(chosenType?.slug)

  const create = useLedgerMutation(api.createProduct, onClose)

  function submit(event: FormEvent) {
    event.preventDefault()
    create.mutate({
      name: effectiveName.trim(),
      game_id: gameId,
      product_type_id: typeId,
      set_name: setLabel.trim() || null,
      collector_number: collectorNumber.trim() || null,
      variant: variant.trim() || null,
      language,
      storage_location: storage.trim() || null,
      initial_purchase: {
        quantity: Number(quantity),
        amount,
        shipping: shipping || undefined,
        tax: tax || undefined,
        fees: fees || undefined,
        purchase_date: purchaseDate,
        source: source.trim() || null,
        bucket,
        funding: fundedBy ? [{ account_id: fundedBy }] : undefined,
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
      {/* What it is, before what it is called. The name is built from these two and the
          set, so asking for it first meant asking for the one thing the app could have
          written itself - and asking for it before it knew enough to help. */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Game">
          <select
            aria-label="Game"
            value={gameId}
            onChange={(e) => setGame(e.target.value)}
            className={FIELD_CLASS}
          >
            {games.data?.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Product type">
          <select
            aria-label="Product type"
            value={typeId}
            onChange={(e) => setType(e.target.value)}
            className={FIELD_CLASS}
          >
            {types.data?.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* English unless somebody says otherwise, which is nearly everything the group
          buys. It earns its place by changing the opening suggestions substantially: a
          Japanese case holds 20 boxes against six, and a Japanese box 30 packs against 36.
          Until this existed the tables' Japanese rows could never fire, so a Japanese case
          quietly suggested six. */}
      <Field label="Language" hint="Changes the case and box sizes suggested when you open it.">
        <select
          aria-label="Language"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className={FIELD_CLASS}
        >
          {LANGUAGES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </Field>

      <SetField
        gameSlug={games.data?.find((option) => option.id === gameId)?.slug}
        value={setLabel}
        onChange={setSetLabel}
        autoFocus={!nameIsTheirs}
      />

      <Field
        label="Name"
        hint={
          !nameTouched && derivedName
            ? 'Built from the set and type. Change it if it should read differently.'
            : undefined
        }
      >
        <input
          required
          autoFocus={nameIsTheirs}
          value={effectiveName}
          onChange={(e) => {
            setNameTouched(true)
            setName(e.target.value)
          }}
          placeholder={nameIsTheirs ? 'Mickey Mouse — Iconic foil' : 'Pick a set above'}
          className={FIELD_CLASS}
        />
      </Field>

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

      <BucketField
        label="Goes to"
        value={bucket}
        onChange={setBucket}
        hint="A case bought to sell never has to pass through Inventory first."
      />

      <AccountField
        label="Paid from"
        value={fundedBy}
        onChange={setPaidFrom}
        accounts={accounts}
        hint="Paying out of your own pocket means the group owes you for it."
      />

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
        <Field label="Storage location">
          <input
            value={storage}
            onChange={(e) => setStorage(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Collector number">
            <input
              value={collectorNumber}
              onChange={(e) => setCollectorNumber(e.target.value)}
              placeholder="123/204"
              className={FIELD_CLASS}
            />
          </Field>
          <Field label="Variant">
            <input
              value={variant}
              onChange={(e) => setVariant(e.target.value)}
              placeholder="Holo, alternate art…"
              className={FIELD_CLASS}
            />
          </Field>
        </div>
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
  const [bucket, setBucket] = useState<Bucket>('inventory')
  const [paidFrom, setPaidFrom] = useState('')

  const { accounts, mine } = useMyAccount()
  const fundedBy = paidFrom || mine?.id || ''

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
          bucket,
          funding: fundedBy ? [{ account_id: fundedBy }] : undefined,
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
      <BucketField label="Goes to" value={bucket} onChange={setBucket} />
      <AccountField
        label="Paid from"
        value={fundedBy}
        onChange={setPaidFrom}
        accounts={accounts}
        hint="Paying out of your own pocket means the group owes you for it."
      />
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
  const [feesTouched, setFeesTouched] = useState(false)
  const [feePercent, setFeePercent] = useState(0)
  const [paymentFees, setPaymentFees] = useState('')
  const [shippingPaid, setShippingPaid] = useState('')
  const [notes, setNotes] = useState('')
  const [bucket, setBucket] = useState<Bucket | null>(null)
  const [paidInto, setPaidInto] = useState('')
  const [creditStore, setCreditStore] = useState<string | null>(null)
  const [allowOversell, setAllowOversell] = useState(false)

  const { accounts, mine } = useMyAccount()
  // The payout lands in the seller's own account, so that is where the money goes unless
  // somebody says otherwise. Moving it to the joint account is a later, deliberate act.
  const proceedsTo = paidInto || mine?.id || ''

  const create = useLedgerMutation(api.createSale, onClose)

  // Suggest the channel's usual cut so the common case needs no arithmetic. It stays
  // editable, because a promo or a store-credit deal changes it.
  //
  // The cut is *remembered* rather than applied once. It used to fire only when a channel
  // chip was tapped, so entering 500, tapping TCGplayer and then correcting the total to
  // 800 left the fee sitting at 51.25 — while the summary recomputed gross, cost basis,
  // profit and ROI around it and presented all of it with complete confidence.
  //
  // Same rule as the product name: the suggestion keeps up until the person takes over,
  // and then it never fights them again.
  const suggestedFees =
    feePercent > 0 && amount ? ((Number(amount) * feePercent) / 100).toFixed(2) : ''
  const effectiveFees = feesTouched ? platformFees : suggestedFees || platformFees

  function rememberChannelCut(_name: string, percent: number) {
    setFeePercent(percent)
  }

  // Computed by the server running the real FIFO engine. Doing it here would mean
  // re-implementing the engine in TypeScript and doing money arithmetic in floats, both
  // of which this project deliberately avoids.
  const preview = useQuery({
    queryKey: [
      'salePreview',
      picked?.id,
      quantity,
      amount,
      effectiveFees,
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
        platform_fees: effectiveFees || '0',
        payment_fees: paymentFees || '0',
        shipping_paid: shippingPaid || '0',
        sale_date: saleDate,
      }),
  })

  if (!picked) {
    return <ProductPickerDialog onClose={onClose} onPick={setPicked} />
  }

  const math = preview.data
  // Defaults to wherever the stock actually is. Booking a Store sale against Inventory
  // drove that bucket negative while the Store stayed full - and nothing looked wrong,
  // because the total was still right.
  const soldFrom = bucket ?? fullestBucket(picked.stats.by_bucket)
  const availableHere = picked.stats.by_bucket[soldFrom] ?? 0

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
          platform_fees: effectiveFees || undefined,
          payment_fees: paymentFees || undefined,
          shipping_paid: shippingPaid || undefined,
          sale_date: saleDate,
          sold_by_member_id: soldBy || null,
          marketplace: marketplace || null,
          bucket: soldFrom,
          // Exactly one destination. A shop name creates that shop's credit pot; anything
          // else is an account that already exists.
          proceeds:
            creditStore !== null
              ? [{ store: creditStore }]
              : proceedsTo
                ? [{ account_id: proceedsTo }]
                : [],
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

      <BucketField
        label="Sold from"
        value={soldFrom}
        onChange={setBucket}
        counts={picked.stats.by_bucket}
        hint={
          Number(quantity) > availableHere
            ? `${BUCKET_LABELS[soldFrom]} only holds ${availableHere}. Selling more will take it negative.`
            : undefined
        }
      />

      <MarketplaceField
        value={marketplace}
        onChange={setMarketplace}
        onPickKnown={rememberChannelCut}
      />

      <ProceedsField
        accounts={accounts}
        accountId={creditStore === null ? proceedsTo : ''}
        store={creditStore}
        onPickAccount={(id) => {
          setCreditStore(null)
          setPaidInto(id)
        }}
        onPickStore={(name) => {
          setCreditStore(name)
          // The shop is the channel too: selling for credit means selling *to* that shop,
          // so the name is typed once. Anything already chosen wins.
          if (name && !marketplace) setMarketplace(name)
        }}
      />

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

      {/* The hint names the rate rather than just claiming a suggestion, so the number
          carries its own provenance. Joseph, looking at a confident $51.25: "What is this
          assumed price?" — that he had to ask was the finding. */}
      <Field
        label="Platform fees"
        hint={
          feePercent > 0 && !feesTouched
            ? `${marketplace} usually takes ${feePercent}% all in, commission and processing. Check it against your payout.`
            : 'What the channel kept. Check it against what actually landed.'
        }
      >
        <input
          {...MONEY_INPUT}
          value={effectiveFees}
          onChange={(e) => {
            setFeesTouched(true)
            setPlatformFees(e.target.value)
          }}
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
          {/* The channel suggestions above are all-in, so this stays zero for them.
              It exists for a channel with no suggestion, or a processor billed separately. */}
          <Field label="Payment fees" hint="Leave at zero when the channel fee above is all-in.">
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

/**
 * Where a sale happened.
 *
 * The six known channels are chips because they carry a usual fee cut worth suggesting; a
 * plain dropdown would lose that. **Other** covers everything else - the store sells at
 * local shops and shows, and until now a sale could only be recorded against one of the
 * six, so "TCG store" was unenterable.
 *
 * `onPickKnown` is deliberately optional. Recording a sale should suggest the channel's
 * usual fee; editing one should not, because overwriting fees that were actually charged
 * is how a corrected sale ends up wrong in a different way.
 */
function MarketplaceField({
  value,
  onChange,
  onPickKnown,
}: {
  value: string
  onChange: (name: string) => void
  onPickKnown?: (name: string, feePercent: number) => void
}) {
  const isKnown = (name: string) => MARKETPLACES.some((option) => option.name === name)
  // An existing custom channel opens in the free-text state, so editing one is possible.
  const [custom, setCustom] = useState(value !== '' && !isKnown(value))

  return (
    <div>
      <span className="text-sm font-medium text-(--color-muted)">Sold on</span>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {MARKETPLACES.map((option) => (
          <button
            key={option.name}
            type="button"
            onClick={() => {
              setCustom(false)
              onChange(option.name)
              onPickKnown?.(option.name, option.feePercent)
            }}
            className={`rounded-full border px-3 py-1.5 text-[0.8125rem] transition-colors ${
              !custom && value === option.name
                ? 'border-transparent font-medium text-(--color-ink)'
                : 'border-(--color-edge) text-(--color-muted) hover:text-(--color-text)'
            }`}
            style={
              !custom && value === option.name ? { backgroundColor: option.colour } : undefined
            }
          >
            {option.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setCustom(true)
            // Keep an existing custom value; clear a known one so the box starts empty.
            if (isKnown(value)) onChange('')
          }}
          className={`rounded-full border px-3 py-1.5 text-[0.8125rem] transition-colors ${
            custom
              ? 'border-(--color-accent) bg-(--color-accent)/12 font-medium text-(--color-accent)'
              : 'border-(--color-edge) text-(--color-muted) hover:text-(--color-text)'
          }`}
        >
          Other
        </button>
      </div>

      {custom && (
        <input
          autoFocus
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Card shop, show, trade…"
          maxLength={120}
          className={FIELD_CLASS}
        />
      )}
    </div>
  )
}

/**
 * Which of the three places stock is going to, or coming from.
 *
 * Chips rather than a dropdown: there are exactly three, they are the vocabulary of the
 * whole app, and a select hides two of them behind a tap.
 */
function BucketField({
  label,
  value,
  onChange,
  counts,
  hint,
}: {
  label: string
  value: Bucket
  onChange: (bucket: Bucket) => void
  /** Stock held per bucket, when the choice is about where something already is. */
  counts?: Record<Bucket, number>
  hint?: string
}) {
  return (
    <div>
      <span className="text-sm font-medium text-(--color-muted)">{label}</span>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {BUCKETS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={`rounded-full border px-3 py-1.5 text-[0.8125rem] transition-colors ${
              value === option
                ? 'border-(--color-accent) bg-(--color-accent)/12 font-medium text-(--color-accent)'
                : 'border-(--color-edge) text-(--color-muted) hover:text-(--color-text)'
            }`}
          >
            {BUCKET_LABELS[option]}
            {counts ? ` (${counts[option] ?? 0})` : ''}
          </button>
        ))}
      </div>
      {hint && <span className="mt-1 block text-xs text-(--color-faint)">{hint}</span>}
    </div>
  )
}

/**
 * Which pot the money came out of, or went into.
 *
 * Chips for the same reason buckets get chips: there are four or five accounts and they
 * are the vocabulary of the money side. Nothing here is required - both places that use
 * it arrive with the right answer already selected, so the fast path is to ignore it.
 */
function AccountField({
  label,
  value,
  onChange,
  accounts,
  hint,
}: {
  label: string
  value: string
  onChange: (accountId: string) => void
  accounts: Account[]
  hint?: string
}) {
  // Store credit with nothing left in it cannot pay for anything, so it is not offered.
  const spendable = accounts.filter(
    (account) => account.kind !== 'store_credit' || Number(account.balance) !== 0,
  )

  return (
    <div>
      <span className="text-sm font-medium text-(--color-muted)">{label}</span>
      {/* Bounded for the same reason the sale form's destinations are: a group that has
          dealt with a dozen shops keeps every one of them one tap away, and the fields
          below stay on screen. */}
      <div className="mt-1.5 flex max-h-[7.5rem] flex-wrap gap-2 overflow-y-auto">
        {spendable.map((account) => (
          <button
            key={account.id}
            type="button"
            onClick={() => onChange(account.id)}
            className={`rounded-full border px-3 py-1.5 text-[0.8125rem] transition-colors ${
              value === account.id
                ? 'border-(--color-accent) bg-(--color-accent)/12 font-medium text-(--color-accent)'
                : 'border-(--color-edge) text-(--color-muted) hover:text-(--color-text)'
            }`}
          >
            {account.name}
          </button>
        ))}
      </div>
      {hint && <span className="mt-1 block text-xs text-(--color-faint)">{hint}</span>}
    </div>
  )
}

/** The account belonging to the signed-in member, which is the default on both forms. */
function useMyAccount(): { accounts: Account[]; mine: Account | undefined } {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me })
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.accounts })
  const items = accounts.data?.items ?? []
  return { accounts: items, mine: items.find((account) => account.member_id === me.data?.id) }
}


/**
 * Where a sale's money went: an account, or a shop that paid in credit.
 *
 * Store credit is real value received - it counts toward realized profit - and it is not
 * money, so it can never be added into a cash figure. Making it a destination alongside
 * the cash accounts is what keeps that distinction in one place: pick the shop and the
 * whole system knows this sale produced no cash.
 *
 * Shops behave like marketplaces: free text, with everywhere already used offered as a
 * chip. No managed list, and nobody blocked at 11pm because a shop is missing.
 */
function ProceedsField({
  accounts,
  accountId,
  store,
  onPickAccount,
  onPickStore,
}: {
  accounts: Account[]
  accountId: string
  /** null when the money went to an account rather than a shop. */
  store: string | null
  onPickAccount: (accountId: string) => void
  onPickStore: (store: string) => void
}) {
  // Held rather than derived from whether the typed name matches a shop. Derived, the
  // input vanished mid-word the moment you finished typing the name of a shop that
  // already existed - which is exactly when you were most sure you were doing it right.
  const [typing, setTyping] = useState(false)

  const pots = accounts.filter((account) => account.kind !== 'store_credit')
  // Shops with credit left, biggest first. A shop that has been spent out is not a
  // destination worth a tap, and it is still reachable by typing its name - which is how
  // it got here in the first place.
  const shops = accounts
    .filter((account) => account.kind === 'store_credit' && Number(account.balance) !== 0)
    .sort((a, b) => Number(b.balance) - Number(a.balance))

  return (
    <div>
      <span className="text-sm font-medium text-(--color-muted)">Money went to</span>
      {/* Scrolls rather than caps. A group that has dealt with fifteen shops still has
          every one of them one tap away, and the fields below stay on screen either way -
          hiding destinations would mean retyping a name the app already knows. */}
      <div className="mt-1.5 flex max-h-[7.5rem] flex-wrap gap-2 overflow-y-auto">
        {pots.map((account) => (
          <Chip
            key={account.id}
            active={store === null && accountId === account.id}
            onClick={() => {
              setTyping(false)
              onPickAccount(account.id)
            }}
          >
            {account.name}
          </Chip>
        ))}
        {shops.map((shop) => (
          <Chip
            key={shop.id}
            active={!typing && store === shop.name}
            onClick={() => {
              setTyping(false)
              onPickStore(shop.name)
            }}
          >
            {shop.name}
          </Chip>
        ))}
        <Chip
          active={typing}
          onClick={() => {
            setTyping(true)
            onPickStore('')
          }}
        >
          Store credit…
        </Chip>
      </div>

      {typing && (
        <input
          autoFocus
          value={store ?? ''}
          onChange={(e) => onPickStore(e.target.value)}
          placeholder="Which shop?"
          className={`${FIELD_CLASS} mt-2`}
        />
      )}

      <span className="mt-1 block text-xs text-(--color-faint)">
        {store !== null
          ? 'Credit counts as profit and never as cash. It is spendable only at that shop.'
          : 'Holding it yourself lowers what the group owes you. Move it later if you want.'}
      </span>
    </div>
  )
}


/**
 * Which set this belongs to, typed or tapped.
 *
 * Free text plus a suggestion list is how "Fable", "Fabled" and "Lorcana Fable" become
 * three sets that split every rollup between them, so this asks "did you mean Fabled?"
 * before the duplicate exists. It asks - it never corrects, and it never blocks: somebody
 * entering stock at 11pm must not be stopped because a set is missing.
 *
 * Suggestions are what the group has actually bought, most recent first, with the seeded
 * release calendar filling in behind. The calendar is the bonus, not the source of truth:
 * unmaintained it goes stale, and a stale calendar confidently naming the wrong latest set
 * is worse than no calendar at all.
 */
function SetField({
  gameSlug,
  value,
  onChange,
  autoFocus,
}: {
  /** Sets belong to a game, so suggestions are scoped to it. */
  gameSlug: string | undefined
  value: string
  onChange: (name: string) => void
  /** Where a person starts, now that game and type both open on a sensible default. */
  autoFocus?: boolean
}) {
  const typed = useDebouncedValue(value, 250)

  const found = useQuery({
    queryKey: ['sets', gameSlug, typed],
    enabled: Boolean(gameSlug),
    queryFn: () => api.sets({ game: gameSlug!, q: typed || undefined }),
  })

  const suggestions = found.data?.items ?? []
  const didYouMean = found.data?.did_you_mean ?? null

  return (
    <Field label="Set">
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Start typing, or pick one below"
        className={FIELD_CLASS}
      />

      {didYouMean && (
        <button
          type="button"
          onClick={() => onChange(didYouMean)}
          className="mt-1.5 text-xs text-(--color-accent) hover:underline"
        >
          Did you mean {didYouMean}?
        </button>
      )}

      {suggestions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {suggestions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.name)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                value.trim().toLowerCase() === option.name.toLowerCase()
                  ? 'border-(--color-accent) bg-(--color-accent)/12 text-(--color-accent)'
                  : 'border-(--color-edge) text-(--color-muted) hover:text-(--color-text)'
              }`}
            >
              {option.name}
              {/* Nothing bought from it yet, so it is the calendar talking rather than
                  the group's own history. Worth saying which. */}
              {option.uses === 0 && <span className="ml-1 opacity-60">new</span>}
            </button>
          ))}
        </div>
      )}
    </Field>
  )
}

/** The bucket holding the most stock - the one a sale most likely came out of. */
function fullestBucket(counts: Record<Bucket, number>): Bucket {
  return BUCKETS.reduce((best, option) => (counts[option] > counts[best] ? option : best), BUCKETS[0])
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
  const [bucket, setBucket] = useState<Bucket>(fullestBucket(product.stats.by_bucket))

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
          bucket,
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

      <BucketField
        label={adding ? 'Counted into' : 'Taken from'}
        value={bucket}
        onChange={setBucket}
        counts={product.stats.by_bucket}
      />

      <Field label="Notes">
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className={FIELD_CLASS} />
      </Field>
    </Dialog>
  )
}

/**
 * Everything about one item, in one place.
 *
 * What the item *is* and what was paid for it are one thought to the person holding the
 * box, even though they are two tables here. Splitting them across two screens meant
 * "Edit" led to another Edit, and the cost - the number the whole product exists to
 * track - was not on either.
 *
 * Fees and shipping stay on the full transaction editor: they are rare, and folding them
 * into one "paid" box would lose which was which.
 */
export function EditItemDialog({
  productId,
  onClose,
}: {
  productId: string
  onClose: () => void
}) {
  const item = useQuery({ queryKey: ['product', productId], queryFn: () => api.product(productId) })

  if (!item.data) {
    return (
      <Dialog
        title="Edit item"
        onClose={onClose}
        onSubmit={(event) => event.preventDefault()}
        submitLabel="Save changes"
        busy
        error={item.error ? (item.error as Error).message : null}
      >
        <p className="text-sm text-(--color-muted)">Loading…</p>
      </Dialog>
    )
  }

  return <EditItemForm item={item.data} onClose={onClose} />
}

/** Split out so the fields can be initialised from loaded data instead of guarded state. */
function EditItemForm({ item, onClose }: { item: ProductDetail; onClose: () => void }) {
  const games = useQuery({ queryKey: ['games'], queryFn: api.games })
  const types = useQuery({ queryKey: ['productTypes'], queryFn: api.productTypes })

  const [name, setName] = useState(item.name)
  const [gameId, setGame] = useState(item.game.id)
  const [typeId, setType] = useState(item.product_type.id)
  const [setLabel, setSetLabel] = useState(item.set_name ?? '')
  const [collectorNumber, setCollectorNumber] = useState(item.collector_number ?? '')
  const [variant, setVariant] = useState(item.variant ?? '')
  // Editable here as well, so a product added before the field existed can be corrected
  // rather than deleted and re-entered.
  const [language, setLanguage] = useState(item.language ?? 'English')
  const [storage, setStorage] = useState(item.storage_location ?? '')

  const purchases = item.history.filter(
    (row) => row.kind === 'purchase' && row.status !== 'voided',
  )
  const [rows, setRows] = useState(() =>
    Object.fromEntries(
      purchases.map((row) => [
        row.id,
        // base_amount, never `amount` - the latter already includes shipping and tax.
        { quantity: String(row.quantity), amount: row.base_amount ?? '', date: row.occurred_on ?? '' },
      ]),
    ),
  )

  function edit(id: string, field: 'quantity' | 'amount' | 'date', value: string) {
    setRows((current) => ({ ...current, [id]: { ...current[id], [field]: value } }))
  }

  const save = useLedgerMutation<void>(async () => {
    const productChanges: Parameters<typeof api.updateProduct>[1] = {}
    if (name.trim() !== item.name) productChanges.name = name.trim()
    if (gameId !== item.game.id) productChanges.game_id = gameId
    if (typeId !== item.product_type.id) productChanges.product_type_id = typeId
    if (setLabel.trim() !== (item.set_name ?? '')) productChanges.set_name = setLabel.trim() || null
    if (collectorNumber.trim() !== (item.collector_number ?? '')) {
      productChanges.collector_number = collectorNumber.trim() || null
    }
    if (variant.trim() !== (item.variant ?? '')) productChanges.variant = variant.trim() || null
    if (language !== (item.language ?? 'English')) productChanges.language = language
    if (storage.trim() !== (item.storage_location ?? '')) {
      productChanges.storage_location = storage.trim() || null
    }
    if (Object.keys(productChanges).length > 0) {
      await api.updateProduct(item.id, productChanges)
    }

    // One at a time: each edit re-runs FIFO for the product, and concurrent recomputes
    // would race over the same lot allocations.
    for (const purchase of purchases) {
      const row = rows[purchase.id]
      const changes: Record<string, unknown> = {}
      if (Number(row.quantity) !== purchase.quantity) changes.quantity = Number(row.quantity)
      if (row.amount !== (purchase.base_amount ?? '')) changes.amount = row.amount
      if (row.date !== (purchase.occurred_on ?? '')) changes.purchase_date = row.date
      if (Object.keys(changes).length > 0) {
        await api.updatePurchase(purchase.id, changes)
      }
    }
  }, onClose)

  return (
    <Dialog
      title="Edit item"
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
      submitLabel="Save changes"
      busy={save.isPending}
      error={save.error ? (save.error as Error).message : null}
    >
      <Field label="Name">
        <input
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={FIELD_CLASS}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Game">
          <select
            aria-label="Game"
            value={gameId}
            onChange={(e) => setGame(e.target.value)}
            className={FIELD_CLASS}
          >
            {games.data?.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Product type">
          <select
            aria-label="Product type"
            value={typeId}
            onChange={(e) => setType(e.target.value)}
            className={FIELD_CLASS}
          >
            {types.data?.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div>
        <p className="text-sm font-medium text-(--color-muted)">What you paid</p>
        {purchases.length === 0 ? (
          <p className="mt-1.5 text-sm text-(--color-faint)">
            No purchase recorded, so this item has no cost. Add one from the item page.
          </p>
        ) : (
          <div className="mt-2 space-y-3">
            {purchases.map((purchase) => {
              const extras =
                Number(purchase.shipping ?? 0) + Number(purchase.tax ?? 0) + Number(purchase.fees ?? 0)
              return (
                <div
                  key={purchase.id}
                  className="rounded-lg border border-(--color-edge) bg-(--color-ink)/40 p-3"
                >
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Qty">
                      <input
                        required
                        type="number"
                        min={1}
                        inputMode="numeric"
                        value={rows[purchase.id].quantity}
                        onChange={(e) => edit(purchase.id, 'quantity', e.target.value)}
                        className={FIELD_CLASS}
                      />
                    </Field>
                    <Field label="Total paid">
                      <input
                        required
                        {...MONEY_INPUT}
                        value={rows[purchase.id].amount}
                        onChange={(e) => edit(purchase.id, 'amount', e.target.value)}
                        className={FIELD_CLASS}
                      />
                    </Field>
                    <Field label="Date">
                      <input
                        required
                        type="date"
                        value={rows[purchase.id].date}
                        onChange={(e) => edit(purchase.id, 'date', e.target.value)}
                        className={FIELD_CLASS}
                      />
                    </Field>
                  </div>
                  {extras > 0 && (
                    <p className="mt-2 text-xs text-(--color-faint)">
                      Plus {money(extras.toFixed(2))} shipping, tax and fees —{' '}
                      {money(purchase.amount)} landed. Edit those on the item page.
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {purchases.length > 0 && (
        <p className="text-xs text-(--color-faint)">
          Changing a cost re-runs FIFO, so profit on sales that already looked settled can
          move. That is correct, and it is recorded in the audit trail.
        </p>
      )}

      <Advanced>
        <SetField
          gameSlug={games.data?.find((option) => option.id === gameId)?.slug}
          value={setLabel}
          onChange={setSetLabel}
        />
        <Field label="Language" hint="Drives the sizes suggested when this is opened.">
          <select
            aria-label="Language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className={FIELD_CLASS}
          >
            {LANGUAGES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Collector number">
            <input
              value={collectorNumber}
              onChange={(e) => setCollectorNumber(e.target.value)}
              placeholder="123/204"
              className={FIELD_CLASS}
            />
          </Field>
          <Field label="Variant">
            <input
              value={variant}
              onChange={(e) => setVariant(e.target.value)}
              placeholder="Holo, alternate art…"
              className={FIELD_CLASS}
            />
          </Field>
        </div>
        <Field label="Storage location">
          <input
            value={storage}
            onChange={(e) => setStorage(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
      </Advanced>
    </Dialog>
  )
}

export function VoidDialog({
  kind,
  id,
  onClose,
}: {
  kind: Transaction['kind']
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
  // A purchase's `amount` is the landed total; editing that back as `amount` would add
  // shipping and tax on top a second time. Purchases edit their own components.
  const isPurchase = transaction.kind === 'purchase'
  const [amount, setAmount] = useState(
    (isPurchase ? transaction.base_amount : transaction.amount) ?? '',
  )
  const [shipping, setShipping] = useState(transaction.shipping ?? '')
  const [tax, setTax] = useState(transaction.tax ?? '')
  const [fees, setFees] = useState(transaction.fees ?? '')
  const [platformFees, setPlatformFees] = useState(transaction.platform_fees ?? '')
  const [paymentFees, setPaymentFees] = useState(transaction.payment_fees ?? '')
  const [shippingPaid, setShippingPaid] = useState(transaction.shipping_paid ?? '')
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
      if (amount !== ((isPurchase ? transaction.base_amount : transaction.amount) ?? '')) {
        changes.amount = amount
      }
      if (isPurchase) {
        if (shipping !== (transaction.shipping ?? '')) changes.shipping = shipping
        if (tax !== (transaction.tax ?? '')) changes.tax = tax
        if (fees !== (transaction.fees ?? '')) changes.fees = fees
      } else {
        if (platformFees !== (transaction.platform_fees ?? '')) {
          changes.platform_fees = platformFees
        }
        if (paymentFees !== (transaction.payment_fees ?? '')) changes.payment_fees = paymentFees
        if (shippingPaid !== (transaction.shipping_paid ?? '')) {
          changes.shipping_paid = shippingPaid
        }
      }
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
          <Field
            label={isPurchase ? 'Total paid' : 'Total received'}
            hint={isPurchase ? 'Before shipping, tax and fees' : undefined}
          >
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

      {isPurchase && (
        <Field label="Bought from">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={160}
            className={FIELD_CLASS}
          />
        </Field>
      )}

      {/* No fee suggestion here: this sale's fees were already charged, and recalculating
          them from a rate would overwrite what actually happened. */}
      {transaction.kind === 'sale' && <MarketplaceField value={label} onChange={setLabel} />}

      {!isAdjustment && (
        <Advanced>
          <div className="grid grid-cols-3 gap-3">
            {isPurchase ? (
              <>
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
              </>
            ) : (
              <>
                <Field label="Platform fees">
                  <input
                    {...MONEY_INPUT}
                    value={platformFees}
                    onChange={(e) => setPlatformFees(e.target.value)}
                    className={FIELD_CLASS}
                  />
                </Field>
                {/* The channel suggestions above are all-in, so this stays zero for them.
              It exists for a channel with no suggestion, or a processor billed separately. */}
          <Field label="Payment fees" hint="Leave at zero when the channel fee above is all-in.">
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
              </>
            )}
          </div>
        </Advanced>
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

/**
 * Shifting stock between buckets.
 *
 * Deliberately says nothing about money: a move changes where stock sits, never how much
 * there is or what it cost. The server refuses a move a bucket cannot cover, so the error
 * surfaces here rather than the form guessing.
 */
export function MoveStockDialog({
  product,
  onClose,
}: {
  product: Product
  onClose: () => void
}) {
  const held = product.stats.by_bucket
  const firstStocked = BUCKETS.find((option) => held[option] > 0) ?? 'inventory'

  const [from, setFrom] = useState<Bucket>(firstStocked)
  const [to, setTo] = useState<Bucket>(BUCKETS.find((option) => option !== firstStocked)!)
  const [quantity, setQuantity] = useState('1')
  const [movedOn, setMovedOn] = useState(todayIso())
  const [notes, setNotes] = useState('')

  const move = useLedgerMutation(api.createMove, onClose)
  const available = held[from] ?? 0

  return (
    <Dialog
      title={`Move stock — ${product.name}`}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault()
        move.mutate({
          product_id: product.id,
          quantity: Number(quantity),
          from_bucket: from,
          to_bucket: to,
          moved_on: movedOn,
          notes: notes.trim() || null,
        })
      }}
      submitLabel="Move"
      busy={move.isPending}
      error={move.error ? (move.error as Error).message : null}
    >
      <p className="text-sm text-(--color-muted)">
        Where something sits, not what it cost. Moving never changes your stock level or
        cost basis.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <Field label="From" hint={`${available} here`}>
          {/* Nesting a select inside its label makes the option text part of the accessible
              name - a screen reader announces "FromInventory (2)Store (0)". An explicit
              aria-label overrides that. */}
          <select
            aria-label="Move from"
            value={from}
            onChange={(e) => {
              const next = e.target.value as Bucket
              setFrom(next)
              // Never leave the two equal; the server rejects it and so does the form.
              if (next === to) setTo(BUCKETS.find((option) => option !== next)!)
            }}
            className={FIELD_CLASS}
          >
            {BUCKETS.map((option) => (
              <option key={option} value={option}>
                {BUCKET_LABELS[option]} ({held[option] ?? 0})
              </option>
            ))}
          </select>
        </Field>
        <Field label="To">
          <select
            aria-label="Move to"
            value={to}
            onChange={(e) => setTo(e.target.value as Bucket)}
            className={FIELD_CLASS}
          >
            {BUCKETS.filter((option) => option !== from).map((option) => (
              <option key={option} value={option}>
                {BUCKET_LABELS[option]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="How many">
          <input
            required
            autoFocus
            type="number"
            min={1}
            max={available || undefined}
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
        <Field label="Date" hint="When it actually moved">
          <input
            required
            type="date"
            value={movedOn}
            onChange={(e) => setMovedOn(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
      </div>

      <Field label="Notes">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Long term play"
          className={FIELD_CLASS}
        />
      </Field>
    </Dialog>
  )
}
