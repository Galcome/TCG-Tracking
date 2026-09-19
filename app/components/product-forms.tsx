import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useMemo, useRef, useState } from 'react'

import { useApi } from '../context/AppContext'
import {
  ADJUSTMENT_REASONS,
  BUCKET_LABELS,
  BUCKETS,
  LANGUAGES,
  type Account,
  type Bucket,
  type NewAdjustment,
  type NewProduct,
  type Product,
  type ProductDetail,
  type Transaction,
} from '../lib/api'
import {
  firstValidationError,
  effectiveProductName,
  optionalText,
  parseIntegerQuantity,
  validateDraft,
  type DraftValidation,
  type ProductFormMode,
} from '../lib/product-drafts'
import { todayIso } from '../lib/format'
import { namedByItsSet } from '../lib/product-types'
import { canUseFreeMarketPricing } from '../lib/pricing-drafts'
import { Button, Card, Choice, Copy, ErrorNotice, Field, Row, Sheet } from './ui'
import { SetField } from './set-field'
import { AllocationEditor } from './allocation-editor'
import { allocationError, fundingPayload, type AllocationDraft } from '../lib/allocation-drafts'
import { DateField } from './date-field'

export interface ProductFormsProps {
  /** The product being edited or the product receiving a ledger operation. */
  product?: Product | ProductDetail
  /** A transaction is required for `transaction` and `void` modes. */
  transaction?: Transaction
  mode: ProductFormMode
  /** Prefills the name in `add` mode, e.g. from an empty stock search. */
  initialName?: string
  onClose: () => void
}

type FormChildrenProps = {
  title: string
  onClose: () => void
  onSubmit: () => void
  submitLabel: string
  busy: boolean
  error?: unknown
  validation?: DraftValidation
  children: React.ReactNode
  /** Read-only forms keep the same sheet affordance without exposing a write action. */
  canSubmit?: boolean
}

/** All ledger mutations invalidate the complete query cache after the server commits. */
function useLedgerMutation<T, R = unknown>(run: (input: T) => Promise<R>, onDone: (result: R) => void) {
  const queryClient = useQueryClient()
  const running = useRef(false)
  const mutation = useMutation({
    mutationFn: run,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries()
      onDone(result)
    },
    onSettled: () => { running.current = false },
  })
  return { ...mutation, mutate: (input: T) => {
    if (running.current) return
    running.current = true
    mutation.mutate(input)
  } }
}

function FormSheet({
  title,
  onClose,
  onSubmit,
  submitLabel,
  busy,
  error,
  validation,
  children,
  canSubmit = true,
}: FormChildrenProps) {
  const close = busy ? () => undefined : onClose
  const validationMessage = firstValidationError(validation ?? {})
  const footer = (
    <>
      {validationMessage ? <ErrorNotice error={new Error(validationMessage)} /> : null}
      {error ? <ErrorNotice error={error} /> : null}
      {canSubmit ? (
        <Button
          label={busy ? 'Saving…' : submitLabel}
          disabled={busy}
          onPress={onSubmit}
          variant="primary"
        />
      ) : null}
    </>
  )

  return (
    <Sheet title={title} open onClose={close} dismissDisabled={busy} footer={footer}>
      {children}
    </Sheet>
  )
}

function MissingProduct({ mode, onClose }: { mode: ProductFormMode; onClose: () => void }) {
  return (
    <FormSheet
      title="Product required"
      onClose={onClose}
      onSubmit={() => undefined}
      submitLabel="Save"
      busy={false}
      canSubmit={false}
    >
      <ErrorNotice error={new Error(`A product is required for the ${mode} form.`)} />
    </FormSheet>
  )
}

function MissingTransaction({ mode, onClose }: { mode: ProductFormMode; onClose: () => void }) {
  return (
    <FormSheet
      title="Transaction required"
      onClose={onClose}
      onSubmit={() => undefined}
      submitLabel="Save"
      busy={false}
      canSubmit={false}
    >
      <ErrorNotice error={new Error(`A transaction is required for the ${mode} form.`)} />
    </FormSheet>
  )
}

function useGamesAndTypes() {
  const api = useApi()
  const games = useQuery({ queryKey: ['games'], queryFn: api.games })
  const productTypes = useQuery({ queryKey: ['productTypes'], queryFn: api.productTypes })
  return { games, productTypes }
}

function useAccounts() {
  const api = useApi()
  const member = useQuery({ queryKey: ['me'], queryFn: api.me })
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.accounts })
  const items = useMemo(
    () => (accounts.data?.items ?? []).filter((account) => account.is_active),
    [accounts.data],
  )
  const mine = items.find((account) => account.member_id === member.data?.id)
  return { accounts: items, mine, error: member.error ?? accounts.error }
}

function option(value: string, label: string) {
  return { value, label }
}

function text(value: string | null | undefined): string {
  return value ?? ''
}

function humanise(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function BucketChoice({
  label,
  value,
  onChange,
  counts,
}: {
  label: string
  value: Bucket
  onChange: (value: Bucket) => void
  counts?: Record<Bucket, number>
}) {
  return (
    <Choice
      label={label}
      value={value}
      options={BUCKETS.map((bucket) =>
        option(
          bucket,
          `${BUCKET_LABELS[bucket]}${counts ? ` (${counts[bucket] ?? 0})` : ''}`,
        ),
      )}
      onChange={(next) => onChange(next as Bucket)}
    />
  )
}

function AccountChoice({
  label,
  value,
  accounts,
  onChange,
}: {
  label: string
  value: string
  accounts: Account[]
  onChange: (value: string) => void
}) {
  const accountOptions = [option('', 'No account recorded'), ...accounts.map((account) => option(account.id, account.name))]
  return <Choice label={label} value={value} options={accountOptions} onChange={onChange} />
}

function AddProductForm({ onClose, initialName = '' }: { onClose: () => void; initialName?: string }) {
  const api = useApi()
  const { games, productTypes } = useGamesAndTypes()
  const { accounts, mine, error: accountError } = useAccounts()
  const [name, setName] = useState(initialName)
  const [nameTouched, setNameTouched] = useState(Boolean(initialName))
  const [gameId, setGameId] = useState('')
  const [productTypeId, setProductTypeId] = useState('')
  const [setLabel, setSetLabel] = useState('')
  const [collectorNumber, setCollectorNumber] = useState('')
  const [variant, setVariant] = useState('')
  const [language, setLanguage] = useState('English')
  const [condition, setCondition] = useState('')
  const [gradingCompany, setGradingCompany] = useState('')
  const [grade, setGrade] = useState('')
  const [certNumber, setCertNumber] = useState('')
  const [storageLocation, setStorageLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [amount, setAmount] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(todayIso())
  const [bucket, setBucket] = useState<Bucket>('inventory')
  const [shipping, setShipping] = useState('')
  const [tax, setTax] = useState('')
  const [fees, setFees] = useState('')
  const [source, setSource] = useState('')
  // null means untouched (use the signed-in member's account); an empty string is an
  // explicit choice to record no funding account.
  const [paidFrom, setPaidFrom] = useState<string | null>(null)
  const [fundingSplit, setFundingSplit] = useState<AllocationDraft[] | null>(null)
  const [validation, setValidation] = useState<DraftValidation>({})
  const [showOptional, setShowOptional] = useState(false)
  // A product that can have a market price lands on its page, where the catalog listing
  // is already suggested and one tap away from giving it a value.
  const create = useLedgerMutation(api.createProduct, (created) => {
    onClose()
    if (canUseFreeMarketPricing(created)) router.push(`/products/${created.id}`)
  })

  const effectiveGameId = gameId || games.data?.[0]?.id || ''
  const effectiveProductTypeId = productTypeId || productTypes.data?.[0]?.id || ''
  const fundedBy = paidFrom ?? mine?.id ?? ''
  const chosenType = productTypes.data?.find((type) => type.id === effectiveProductTypeId)
  // Once a person edits the name, it belongs to them forever. Set/type changes may update
  // the suggestion before that point, but can never overwrite a correction they typed.
  const effectiveName = effectiveProductName(name, nameTouched, setLabel, chosenType)
  const nameIsTheirs = !namedByItsSet(chosenType?.slug)
  const showSlabFields = chosenType?.slug === 'graded-card'

  function submit() {
    const errors = validateDraft('add', {
      name: effectiveName,
      gameId: effectiveGameId,
      productTypeId: effectiveProductTypeId,
      quantity,
      amount,
      date: purchaseDate,
    })
    if (fundingSplit) errors.funding = allocationError(fundingSplit, [amount, shipping, tax, fees], true) ?? undefined
    setValidation(errors)
    if (firstValidationError(errors)) return

    const parsedQuantity = parseIntegerQuantity(quantity, { positive: true })
    if (parsedQuantity === null) return

    create.mutate({
      name: effectiveName.trim(),
      game_id: effectiveGameId,
      product_type_id: effectiveProductTypeId,
      set_name: optionalText(setLabel),
      collector_number: optionalText(collectorNumber),
      variant: optionalText(variant),
      language: language || null,
      condition: optionalText(condition),
      grading_company: showSlabFields ? optionalText(gradingCompany) : null,
      grade: showSlabFields ? optionalText(grade) : null,
      cert_number: showSlabFields ? optionalText(certNumber) : null,
      storage_location: optionalText(storageLocation),
      notes: optionalText(notes),
      initial_purchase: {
        quantity: parsedQuantity,
        amount,
        bucket,
        purchase_date: purchaseDate,
        shipping: shipping || undefined,
        tax: tax || undefined,
        fees: fees || undefined,
        source: optionalText(source),
        funding: fundingSplit ? fundingPayload(fundingSplit) : fundedBy ? [{ account_id: fundedBy }] : [],
      },
    })
  }

  return (
    <FormSheet
      title="Add product"
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Save product"
      busy={create.isPending}
      error={create.error ?? games.error ?? productTypes.error ?? accountError}
      validation={validation}
    >
      <Copy muted>What it is</Copy>
      <Row>
        <Choice
          label="Game"
          value={effectiveGameId}
          options={(games.data ?? []).map((game) => option(game.id, game.name))}
          onChange={setGameId}
        />
        <Choice
          label="Product type"
          value={effectiveProductTypeId}
          options={(productTypes.data ?? []).map((type) => option(type.id, type.name))}
          onChange={setProductTypeId}
        />
      </Row>
      <Choice
        label="Language"
        value={language}
        options={LANGUAGES.map((item) => option(item, item))}
        onChange={setLanguage}
      />
      <SetField
        game={games.data?.find(game => game.id === effectiveGameId)?.slug ?? ''}
        value={setLabel}
        onChange={setSetLabel}
        autoFocus={!nameIsTheirs}
      />
      <Field
        label="Name"
        value={effectiveName}
        onChangeText={(value) => {
          setNameTouched(true)
          setName(value)
        }}
        autoFocus={nameIsTheirs}
        placeholder={nameIsTheirs ? 'Card name' : 'Pick a set above'}
      />
      <Row>
        <Field label="Quantity" value={quantity} onChangeText={setQuantity} keyboardType="number-pad" />
        <Field label="Total paid" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
      </Row>
      <DateField label="Purchase date" value={purchaseDate} onChange={setPurchaseDate} />
      <BucketChoice label="Goes to" value={bucket} onChange={setBucket} />
      {!fundingSplit ? <AccountChoice label="Paid from" value={fundedBy} accounts={accounts} onChange={setPaidFrom} /> : null}
      <AllocationEditor funding rows={fundingSplit} onChange={setFundingSplit} accounts={accounts} defaultAccount={fundedBy} disabled={create.isPending} />
      <Button
        label={showOptional ? 'Hide optional details' : 'Show optional details'}
        variant="link"
        onPress={() => setShowOptional((current) => !current)}
      />
      {showOptional ? (
        <>
          <Copy muted>Optional identity, storage and purchase details</Copy>
          <Row>
            <Field label="Collector number" value={collectorNumber} onChangeText={setCollectorNumber} placeholder="123/204" />
            <Field label="Variant" value={variant} onChangeText={setVariant} placeholder="Holo, alternate art" />
          </Row>
          <Row>
            <Field label="Condition" value={condition} onChangeText={setCondition} placeholder="Raw, near mint" />
            <Field label="Storage location" value={storageLocation} onChangeText={setStorageLocation} placeholder="Shelf 1" />
          </Row>
          {showSlabFields ? (
            <>
              <Copy muted>Graded-card details</Copy>
              <Row>
                <Field label="Grading company" value={gradingCompany} onChangeText={setGradingCompany} placeholder="PSA" />
                <Field label="Grade" value={grade} onChangeText={setGrade} placeholder="10" />
                <Field label="Cert number" value={certNumber} onChangeText={setCertNumber} />
              </Row>
            </>
          ) : null}
          <Row>
            <Field label="Shipping" value={shipping} onChangeText={setShipping} keyboardType="decimal-pad" placeholder="0.00" />
            <Field label="Tax" value={tax} onChangeText={setTax} keyboardType="decimal-pad" placeholder="0.00" />
            <Field label="Fees" value={fees} onChangeText={setFees} keyboardType="decimal-pad" placeholder="0.00" />
          </Row>
          <Field label="Bought from" value={source} onChangeText={setSource} />
          <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
        </>
      ) : null}
    </FormSheet>
  )
}

function PurchaseForm({ product, onClose }: { product: Product; onClose: () => void }) {
  const api = useApi()
  const { accounts, mine, error: accountError } = useAccounts()
  const [quantity, setQuantity] = useState('1')
  const [amount, setAmount] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(todayIso())
  const [bucket, setBucket] = useState<Bucket>('inventory')
  const [shipping, setShipping] = useState('')
  const [tax, setTax] = useState('')
  const [fees, setFees] = useState('')
  const [source, setSource] = useState('')
  const [notes, setNotes] = useState('')
  // Keep an explicit "No account recorded" choice distinct from the initial default.
  const [paidFrom, setPaidFrom] = useState<string | null>(null)
  const [fundingSplit, setFundingSplit] = useState<AllocationDraft[] | null>(null)
  const [validation, setValidation] = useState<DraftValidation>({})
  const [showOptional, setShowOptional] = useState(false)
  const create = useLedgerMutation(api.createPurchase, onClose)
  const fundedBy = paidFrom ?? mine?.id ?? ''

  function submit() {
    const errors = validateDraft('purchase', { productId: product.id, quantity, amount, date: purchaseDate })
    if (fundingSplit) errors.funding = allocationError(fundingSplit, [amount, shipping, tax, fees], true) ?? undefined
    setValidation(errors)
    if (firstValidationError(errors)) return
    const parsedQuantity = parseIntegerQuantity(quantity, { positive: true })
    if (parsedQuantity === null) return

    create.mutate({
      product_id: product.id,
      quantity: parsedQuantity,
      amount,
      bucket,
      shipping: shipping || undefined,
      tax: tax || undefined,
      fees: fees || undefined,
      purchase_date: purchaseDate,
      source: optionalText(source),
      notes: optionalText(notes),
      funding: fundingSplit ? fundingPayload(fundingSplit) : fundedBy ? [{ account_id: fundedBy }] : [],
    })
  }

  return (
    <FormSheet
      title={`Add purchase — ${product.name}`}
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Save purchase"
      busy={create.isPending}
      error={create.error ?? accountError}
      validation={validation}
    >
      <Copy muted>{product.stats.quantity_on_hand} units currently on hand.</Copy>
      <Row>
        <Field label="Quantity" value={quantity} onChangeText={setQuantity} autoFocus keyboardType="number-pad" />
        <Field label="Total paid" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
      </Row>
      <DateField label="Purchase date" value={purchaseDate} onChange={setPurchaseDate} />
      <BucketChoice label="Goes to" value={bucket} onChange={setBucket} />
      {!fundingSplit ? <AccountChoice label="Paid from" value={fundedBy} accounts={accounts} onChange={setPaidFrom} /> : null}
      <AllocationEditor funding rows={fundingSplit} onChange={setFundingSplit} accounts={accounts} defaultAccount={fundedBy} disabled={create.isPending} />
      <Button
        label={showOptional ? 'Hide optional details' : 'Show optional details'}
        variant="link"
        onPress={() => setShowOptional((current) => !current)}
      />
      {showOptional ? (
        <>
          <Copy muted>Optional shipping and purchase details</Copy>
          <Row>
            <Field label="Shipping" value={shipping} onChangeText={setShipping} keyboardType="decimal-pad" placeholder="0.00" />
            <Field label="Tax" value={tax} onChangeText={setTax} keyboardType="decimal-pad" placeholder="0.00" />
            <Field label="Fees" value={fees} onChangeText={setFees} keyboardType="decimal-pad" placeholder="0.00" />
          </Row>
          <Field label="Bought from" value={source} onChangeText={setSource} />
          <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
        </>
      ) : null}
    </FormSheet>
  )
}

function EditProductForm({ product, onClose }: { product: Product | ProductDetail; onClose: () => void }) {
  const api = useApi()
  const { games, productTypes } = useGamesAndTypes()
  const [name, setName] = useState(product.name)
  const [gameId, setGameId] = useState(product.game.id)
  const [productTypeId, setProductTypeId] = useState(product.product_type.id)
  const [setLabel, setSetLabel] = useState(text(product.set_name))
  const [collectorNumber, setCollectorNumber] = useState(text(product.collector_number))
  const [variant, setVariant] = useState(text(product.variant))
  const [language, setLanguage] = useState(product.language ?? 'English')
  const [condition, setCondition] = useState(text(product.condition))
  const [gradingCompany, setGradingCompany] = useState(text(product.grading_company))
  const [grade, setGrade] = useState(text(product.grade))
  const [certNumber, setCertNumber] = useState(text(product.cert_number))
  const [externalRef, setExternalRef] = useState(text(product.external_ref))
  const [storageLocation, setStorageLocation] = useState(text(product.storage_location))
  const [notes, setNotes] = useState(text(product.notes))
  const [archived, setArchived] = useState(product.is_archived)
  const [hadSlabMetadata] = useState(() => Boolean(product.grading_company || product.grade || product.cert_number))
  const [validation, setValidation] = useState<DraftValidation>({})
  const update = useLedgerMutation<Partial<NewProduct> & { is_archived?: boolean }>(
    (changes) => api.updateProduct(product.id, changes),
    onClose,
  )
  const selectedType = productTypes.data?.find((type) => type.id === productTypeId)
  const showSlabFields = selectedType?.slug === 'graded-card' || product.product_type.slug === 'graded-card' || hadSlabMetadata

  function submit() {
    const errors = validateDraft('edit', { name, gameId, productTypeId })
    setValidation(errors)
    if (firstValidationError(errors)) return

    const changes: Partial<NewProduct> & { is_archived?: boolean } = {}
    if (name.trim() !== product.name) changes.name = name.trim()
    if (gameId !== product.game.id) changes.game_id = gameId
    if (productTypeId !== product.product_type.id) changes.product_type_id = productTypeId
    if (setLabel.trim() !== text(product.set_name)) changes.set_name = optionalText(setLabel)
    if (collectorNumber.trim() !== text(product.collector_number)) changes.collector_number = optionalText(collectorNumber)
    if (variant.trim() !== text(product.variant)) changes.variant = optionalText(variant)
    if (language !== (product.language ?? 'English')) changes.language = language
    if (condition.trim() !== text(product.condition)) changes.condition = optionalText(condition)
    if (gradingCompany.trim() !== text(product.grading_company)) changes.grading_company = optionalText(gradingCompany)
    if (grade.trim() !== text(product.grade)) changes.grade = optionalText(grade)
    if (certNumber.trim() !== text(product.cert_number)) changes.cert_number = optionalText(certNumber)
    if (externalRef.trim() !== text(product.external_ref)) changes.external_ref = optionalText(externalRef)
    if (storageLocation.trim() !== text(product.storage_location)) changes.storage_location = optionalText(storageLocation)
    if (notes.trim() !== text(product.notes)) changes.notes = optionalText(notes)
    if (archived !== product.is_archived) changes.is_archived = archived

    if (Object.keys(changes).length === 0) {
      onClose()
      return
    }
    update.mutate(changes)
  }

  return (
    <FormSheet
      title={archived ? 'Edit archived product' : 'Edit product'}
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Save changes"
      busy={update.isPending}
      error={update.error ?? games.error ?? productTypes.error}
      validation={validation}
    >
      <Row>
        <Choice label="Game" value={gameId} options={(games.data ?? []).map((game) => option(game.id, game.name))} onChange={setGameId} />
        <Choice label="Product type" value={productTypeId} options={(productTypes.data ?? []).map((type) => option(type.id, type.name))} onChange={setProductTypeId} />
      </Row>
      <Choice label="Language" value={language} options={LANGUAGES.map((item) => option(item, item))} onChange={setLanguage} />
      <SetField game={games.data?.find(game => game.id === gameId)?.slug ?? ''} value={setLabel} onChange={setSetLabel} />
      <Field label="Name" value={name} onChangeText={setName} autoFocus />
      <Row>
        <Field label="Collector number" value={collectorNumber} onChangeText={setCollectorNumber} />
        <Field label="Variant" value={variant} onChangeText={setVariant} />
      </Row>
      <Row>
        <Field label="Condition" value={condition} onChangeText={setCondition} />
        <Field label="Storage location" value={storageLocation} onChangeText={setStorageLocation} />
      </Row>
      {showSlabFields ? (
        <>
          <Copy muted>Graded-card details</Copy>
          <Row>
            <Field label="Grading company" value={gradingCompany} onChangeText={setGradingCompany} />
            <Field label="Grade" value={grade} onChangeText={setGrade} />
            <Field label="Cert number" value={certNumber} onChangeText={setCertNumber} />
          </Row>
        </>
      ) : null}
      <Field label="External reference" value={externalRef} onChangeText={setExternalRef} />
      <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
      <Button label={archived ? 'Restore product' : 'Archive product'} onPress={() => setArchived((current) => !current)} disabled={update.isPending} />
    </FormSheet>
  )
}

function MoveForm({ product, onClose }: { product: Product; onClose: () => void }) {
  const api = useApi()
  const held = product.stats.by_bucket
  const initialFrom = BUCKETS.find((bucket) => held[bucket] > 0) ?? 'inventory'
  const initialTo = BUCKETS.find((bucket) => bucket !== initialFrom) ?? 'store'
  const [from, setFrom] = useState<Bucket>(initialFrom)
  const [to, setTo] = useState<Bucket>(initialTo)
  const [quantity, setQuantity] = useState('1')
  const [movedOn, setMovedOn] = useState(todayIso())
  const [notes, setNotes] = useState('')
  const [validation, setValidation] = useState<DraftValidation>({})
  const move = useLedgerMutation(api.createMove, onClose)
  const available = held[from] ?? 0

  function changeFrom(next: Bucket) {
    setFrom(next)
    if (next === to) setTo(BUCKETS.find((bucket) => bucket !== next) ?? 'store')
  }

  function submit() {
    const errors = validateDraft('move', { productId: product.id, quantity, date: movedOn, fromBucket: from, toBucket: to })
    const parsedQuantity = parseIntegerQuantity(quantity, { positive: true })
    if (parsedQuantity !== null && parsedQuantity > available) errors.quantity = `Only ${available} units are in ${BUCKET_LABELS[from]}.`
    setValidation(errors)
    if (firstValidationError(errors) || parsedQuantity === null) return

    move.mutate({
      product_id: product.id,
      quantity: parsedQuantity,
      from_bucket: from,
      to_bucket: to,
      moved_on: movedOn,
      notes: optionalText(notes),
    })
  }

  return (
    <FormSheet
      title={`Move stock — ${product.name}`}
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Move stock"
      busy={move.isPending}
      error={move.error}
      validation={validation}
    >
      <Copy muted>Moving changes location only; it does not change quantity or cost basis.</Copy>
      <Row>
        <BucketChoice label="From" value={from} counts={held} onChange={changeFrom} />
        <Choice
          label="To"
          value={to}
          options={BUCKETS.filter((bucket) => bucket !== from).map((bucket) => option(bucket, BUCKET_LABELS[bucket]))}
          onChange={(next) => setTo(next as Bucket)}
        />
      </Row>
      <Field label="How many" value={quantity} onChangeText={setQuantity} keyboardType="number-pad" autoFocus />
      <Copy muted>{available} units in {BUCKET_LABELS[from]}.</Copy>
      <DateField label="Date" value={movedOn} onChange={setMovedOn} />
      <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
    </FormSheet>
  )
}

function AdjustForm({ product, onClose }: { product: Product; onClose: () => void }) {
  const api = useApi()
  const [delta, setDelta] = useState('-1')
  const [reason, setReason] = useState('damaged')
  const [cost, setCost] = useState('')
  const [bucket, setBucket] = useState<Bucket>(BUCKETS.find((item) => product.stats.by_bucket[item] > 0) ?? 'inventory')
  const [notes, setNotes] = useState('')
  const [validation, setValidation] = useState<DraftValidation>({})
  const create = useLedgerMutation<NewAdjustment>(api.createAdjustment, onClose)
  const parsedDelta = parseIntegerQuantity(delta)
  const adding = parsedDelta !== null && parsedDelta > 0

  function submit() {
    const errors = validateDraft('adjust', { productId: product.id, quantity: delta, reason, cost })
    setValidation(errors)
    if (firstValidationError(errors) || parsedDelta === null || parsedDelta === 0) return

    create.mutate({
      product_id: product.id,
      quantity_delta: parsedDelta,
      reason,
      bucket,
      cost: adding && cost ? cost : null,
      adjustment_date: todayIso(),
      notes: optionalText(notes),
    })
  }

  return (
    <FormSheet
      title={`Adjust stock — ${product.name}`}
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Save adjustment"
      busy={create.isPending}
      error={create.error}
      validation={validation}
    >
      <Copy muted>{product.stats.quantity_on_hand} units on hand. Use a negative number to remove stock.</Copy>
      <Row>
        <Field label="Change" value={delta} onChangeText={setDelta} keyboardType="number-pad" autoFocus />
        <Choice label="Reason" value={reason} options={ADJUSTMENT_REASONS.map((item) => option(item, humanise(item)))} onChange={setReason} />
      </Row>
      {adding ? <Field label="Cost of these units" value={cost} onChangeText={setCost} keyboardType="decimal-pad" placeholder="Leave blank if unknown" /> : null}
      <BucketChoice label={adding ? 'Counted into' : 'Taken from'} value={bucket} counts={product.stats.by_bucket} onChange={setBucket} />
      <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
    </FormSheet>
  )
}

function TransactionForm({ transaction, onClose }: { transaction: Transaction; onClose: () => void }) {
  const api = useApi()
  const members = useQuery({ queryKey: ['members'], queryFn: api.members })
  const isPurchase = transaction.kind === 'purchase'
  const isAdjustment = transaction.kind === 'adjustment'
  const isMove = transaction.kind === 'move'
  const [quantity, setQuantity] = useState(String(isAdjustment ? transaction.quantity : Math.abs(transaction.quantity)))
  const [amount, setAmount] = useState(isPurchase ? text(transaction.base_amount) : text(transaction.amount))
  const [shipping, setShipping] = useState(text(transaction.shipping))
  const [tax, setTax] = useState(text(transaction.tax))
  const [fees, setFees] = useState(text(transaction.fees))
  const [platformFees, setPlatformFees] = useState(text(transaction.platform_fees))
  const [paymentFees, setPaymentFees] = useState(text(transaction.payment_fees))
  const [shippingPaid, setShippingPaid] = useState(text(transaction.shipping_paid))
  const [occurredOn, setOccurredOn] = useState(transaction.occurred_on ?? '')
  const [label, setLabel] = useState(text(transaction.label))
  const [member, setMember] = useState(text(transaction.member_id))
  const [notes, setNotes] = useState(text(transaction.notes))
  const [auditReason, setAuditReason] = useState('')
  const [validation, setValidation] = useState<DraftValidation>({})
  const update = useLedgerMutation<Record<string, unknown>>(async (changes) => {
    if (transaction.kind === 'purchase') return api.updatePurchase(transaction.id, changes)
    if (transaction.kind === 'sale') return api.updateSale(transaction.id, changes)
    return api.updateAdjustment(transaction.id, changes)
  }, onClose)

  function submit() {
    if (isMove) return
    const errors = validateDraft('transaction', { transaction, quantity, amount, date: occurredOn, reason: label })
    setValidation(errors)
    if (firstValidationError(errors)) return
    const parsedQuantity = parseIntegerQuantity(quantity, { positive: !isAdjustment })
    if (parsedQuantity === null || (isAdjustment && parsedQuantity === 0)) return

    const changes: Record<string, unknown> = {}
    if (isAdjustment) {
      if (parsedQuantity !== transaction.quantity) changes.quantity_delta = parsedQuantity
      if (label !== text(transaction.label)) changes.reason = label
      if (occurredOn !== text(transaction.occurred_on)) changes.adjustment_date = occurredOn
      if (member !== text(transaction.member_id)) changes.member_id = member || null
      if (auditReason.trim()) changes.audit_reason = auditReason.trim()
    } else {
      const originalQuantity = Math.abs(transaction.quantity)
      if (parsedQuantity !== originalQuantity) changes.quantity = parsedQuantity
      const originalAmount = isPurchase ? text(transaction.base_amount) : text(transaction.amount)
      if (amount !== originalAmount) changes.amount = amount
      if (isPurchase) {
        if (shipping !== text(transaction.shipping)) changes.shipping = shipping
        if (tax !== text(transaction.tax)) changes.tax = tax
        if (fees !== text(transaction.fees)) changes.fees = fees
      } else {
        if (platformFees !== text(transaction.platform_fees)) changes.platform_fees = platformFees
        if (paymentFees !== text(transaction.payment_fees)) changes.payment_fees = paymentFees
        if (shippingPaid !== text(transaction.shipping_paid)) changes.shipping_paid = shippingPaid
      }
      if (occurredOn !== text(transaction.occurred_on)) changes[isPurchase ? 'purchase_date' : 'sale_date'] = occurredOn
      if (label !== text(transaction.label)) changes[isPurchase ? 'source' : 'marketplace'] = label || null
      if (member !== text(transaction.member_id)) changes[isPurchase ? 'purchased_by_member_id' : 'sold_by_member_id'] = member || null
      if (auditReason.trim()) changes.reason = auditReason.trim()
    }
    if (notes !== text(transaction.notes)) changes.notes = optionalText(notes)
    if (Object.keys(changes).length === 0) {
      setValidation({ transaction: 'Change at least one field before saving.' })
      return
    }
    update.mutate(changes)
  }

  if (isMove) {
    return (
      <FormSheet title="Edit move" onClose={onClose} onSubmit={() => undefined} submitLabel="Save" busy={false} canSubmit={false}>
        <Copy muted>Move entries are immutable. Void the move and record a new move if the location was wrong.</Copy>
      </FormSheet>
    )
  }

  return (
    <FormSheet
      title={`Edit ${transaction.kind}`}
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Save changes"
      busy={update.isPending}
      error={update.error ?? members.error}
      validation={validation}
    >
      <Card><Copy muted>Editing re-runs FIFO for this product. The resulting cost and profit can change.</Copy></Card>
      <Row>
        <Field label={isAdjustment ? 'Change' : 'Quantity'} value={quantity} onChangeText={setQuantity} keyboardType="number-pad" autoFocus />
        {isAdjustment ? (
          <Choice
            label="Reason"
            value={label}
            options={[
              ...ADJUSTMENT_REASONS.map((item) => option(item, humanise(item))),
              ...(label && !ADJUSTMENT_REASONS.includes(label as (typeof ADJUSTMENT_REASONS)[number]) ? [option(label, humanise(label))] : []),
            ]}
            onChange={setLabel}
          />
        ) : (
          <Field label={isPurchase ? 'Total paid' : 'Total received'} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
        )}
      </Row>
      <Row>
        <DateField label="Date" value={occurredOn} onChange={setOccurredOn} />
        <Choice label={transaction.kind === 'sale' ? 'Sold by' : 'Member'} value={member} options={[option('', 'Unassigned'), ...(members.data ?? []).map((item) => option(item.id, item.display_name))]} onChange={setMember} />
      </Row>
      {isPurchase ? <Field label="Bought from" value={label} onChangeText={setLabel} /> : null}
      {transaction.kind === 'sale' ? <Field label="Marketplace" value={label} onChangeText={setLabel} placeholder="eBay, local show, shop" /> : null}
      {!isAdjustment ? (
        <Row>
          {isPurchase ? (
            <>
              <Field label="Shipping" value={shipping} onChangeText={setShipping} keyboardType="decimal-pad" />
              <Field label="Tax" value={tax} onChangeText={setTax} keyboardType="decimal-pad" />
              <Field label="Fees" value={fees} onChangeText={setFees} keyboardType="decimal-pad" />
            </>
          ) : (
            <>
              <Field label="Platform fees" value={platformFees} onChangeText={setPlatformFees} keyboardType="decimal-pad" />
              <Field label="Payment fees" value={paymentFees} onChangeText={setPaymentFees} keyboardType="decimal-pad" />
              <Field label="Shipping paid" value={shippingPaid} onChangeText={setShippingPaid} keyboardType="decimal-pad" />
            </>
          )}
        </Row>
      ) : null}
      <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
      <Field label="Why the change?" value={auditReason} onChangeText={setAuditReason} placeholder="Receipt was corrected" />
    </FormSheet>
  )
}

function VoidForm({ transaction, onClose }: { transaction: Transaction; onClose: () => void }) {
  const api = useApi()
  const [reason, setReason] = useState('')
  const [validation, setValidation] = useState<DraftValidation>({})
  const run = useLedgerMutation<string>((value) => api.voidTransaction(transaction.kind, transaction.id, value), onClose)

  function submit() {
    const errors = validateDraft('void', { reason })
    setValidation(errors)
    if (firstValidationError(errors)) return
    run.mutate(reason.trim())
  }

  return (
    <FormSheet
      title={`Void ${transaction.kind}`}
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Void transaction"
      busy={run.isPending}
      error={run.error}
      validation={validation}
    >
      <Copy muted>The history row remains marked voided; stock, cost and profit are recalculated without it.</Copy>
      <Field label="Reason" value={reason} onChangeText={setReason} autoFocus placeholder="Entered twice" />
    </FormSheet>
  )
}

/** Unified entry point used by domain screens; only implemented modes are exposed. */
export function ProductForms({ mode, product, transaction, initialName, onClose }: ProductFormsProps) {
  switch (mode) {
    case 'add':
      return <AddProductForm onClose={onClose} initialName={initialName} />
    case 'edit':
      return product ? <EditProductForm product={product} onClose={onClose} /> : <MissingProduct mode={mode} onClose={onClose} />
    case 'purchase':
      return product ? <PurchaseForm product={product} onClose={onClose} /> : <MissingProduct mode={mode} onClose={onClose} />
    case 'move':
      return product ? <MoveForm product={product} onClose={onClose} /> : <MissingProduct mode={mode} onClose={onClose} />
    case 'adjust':
      return product ? <AdjustForm product={product} onClose={onClose} /> : <MissingProduct mode={mode} onClose={onClose} />
    case 'transaction':
      return transaction ? <TransactionForm transaction={transaction} onClose={onClose} /> : <MissingTransaction mode={mode} onClose={onClose} />
    case 'void':
      return transaction ? <VoidForm transaction={transaction} onClose={onClose} /> : <MissingTransaction mode={mode} onClose={onClose} />
    default:
      return <MissingProduct mode={mode} onClose={onClose} />
  }
}

// Named compatibility exports keep future screen ports small while they converge on one
// implementation and one invalidation policy.
export function AddProductDialog({ onClose }: { onClose: () => void }) {
  return <ProductForms mode="add" onClose={onClose} />
}

export function AddPurchaseDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  return <ProductForms mode="purchase" product={product} onClose={onClose} />
}

export function EditItemDialog({ product, onClose }: { product: Product | ProductDetail; onClose: () => void }) {
  return <ProductForms mode="edit" product={product} onClose={onClose} />
}

export function AdjustStockDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  return <ProductForms mode="adjust" product={product} onClose={onClose} />
}

export function MoveStockDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  return <ProductForms mode="move" product={product} onClose={onClose} />
}

export function EditTransactionDialog({ transaction, onClose }: { transaction: Transaction; onClose: () => void }) {
  return <ProductForms mode="transaction" transaction={transaction} onClose={onClose} />
}

export function VoidDialog({ transaction, onClose }: { transaction: Transaction; onClose: () => void }) {
  return <ProductForms mode="void" transaction={transaction} onClose={onClose} />
}

export default ProductForms
