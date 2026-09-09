import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Text } from 'react-native'

import { useApi } from '../context/AppContext'
import { colors } from '../context/ThemeContext'
import {
  BUCKET_LABELS,
  BUCKETS,
  MARKETPLACES,
  type Account,
  type Bucket,
  type NewSale,
  type Product,
  type SalePreview,
} from '../lib/api'
import {
  buildSalePayload,
  isPreviewCurrent,
  previewInput,
  resolveSaleProceeds,
  salePreviewKey,
  validateSaleDraft,
  type SaleDraft,
  type SalePreviewEnvelope,
  type SaleProceeds,
  type SaleValidation,
} from '../lib/sale-drafts'
import { money, todayIso } from '../lib/format'
import { Button, Card, Choice, Copy, ErrorNotice, Field, Row, Sheet } from './ui'

export interface RecordSaleDialogProps {
  /** Omit to open a product picker before showing the sale fields. */
  product?: Product
  onClose: () => void
}

type SaleSheetProps = {
  title: string
  onClose: () => void
  onSubmit: () => void
  busy: boolean
  submitLabel: string
  error?: unknown
  validation?: SaleValidation
  children: React.ReactNode
}

function SaleSheet({ title, onClose, onSubmit, busy, submitLabel, error, validation, children }: SaleSheetProps) {
  const close = busy ? () => undefined : onClose
  const firstError = Object.values(validation ?? {}).find((message): message is string => Boolean(message))
  return (
    <Sheet title={title} open onClose={close} dismissDisabled={busy}>
      {children}
      {firstError ? <ErrorNotice error={new Error(firstError)} /> : null}
      {error ? <ErrorNotice error={error} /> : null}
      <Button label={busy ? 'Saving…' : submitLabel} onPress={onSubmit} disabled={busy} />
    </Sheet>
  )
}

function option(value: string, label: string) {
  return { value, label }
}

function accountLabel(account: Account): string {
  return account.kind === 'store_credit' ? `${account.name} (store credit)` : account.name
}

function useSaleAccounts() {
  const api = useApi()
  const me = useQuery({ queryKey: ['me'], queryFn: api.me })
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.accounts })
  const items = useMemo(() => (accounts.data?.items ?? []).filter((account) => account.is_active), [accounts.data])
  return { accounts: items, currentMemberId: me.data?.id, error: me.error ?? accounts.error }
}

function fullestBucket(counts: Record<Bucket, number>): Bucket {
  return BUCKETS.reduce((best, bucket) => (counts[bucket] > counts[best] ? bucket : best), BUCKETS[0])
}

function ProductPicker({
  products,
  search,
  onSearch,
  onPick,
  onClose,
  error,
}: {
  products: Product[]
  search: string
  onSearch: (value: string) => void
  onPick: (product: Product) => void
  onClose: () => void
  error?: unknown
}) {
  return (
    <Sheet title="Record sale — choose product" open onClose={onClose}>
      <Field label="Search products in stock" value={search} onChangeText={onSearch} autoFocus />
      {error ? <ErrorNotice error={error} /> : null}
      {products.length === 0 ? <Card><Copy muted>Nothing in stock matches that search.</Copy></Card> : null}
      {products.map((item) => (
        <Button
          key={item.id}
          label={`${item.name} · ${item.stats.quantity_on_hand} in stock`}
          onPress={() => onPick(item)}
        />
      ))}
    </Sheet>
  )
}

function ProceedsChoice({
  accounts,
  value,
  onChange,
}: {
  accounts: Account[]
  value: SaleProceeds
  onChange: (next: SaleProceeds) => void
}) {
  const pots = accounts.filter((account) => account.kind !== 'store_credit')
  const shops = accounts.filter((account) => account.kind === 'store_credit')
  const selected = value.kind === 'account'
    ? `account:${value.accountId}`
    : value.kind === 'store'
      ? `store:${value.store}`
      : 'none'
  const choices = [
    ...pots.map((account) => option(`account:${account.id}`, accountLabel(account))),
    ...shops.map((account) => option(`store:${account.name}`, accountLabel(account))),
    option('store:', 'Store credit…'),
    option('none', 'No account recorded'),
  ]

  function choose(next: string) {
    if (next === 'none') {
      onChange({ kind: 'none' })
    } else if (next.startsWith('account:')) {
      onChange({ kind: 'account', accountId: next.slice('account:'.length) })
    } else {
      onChange({ kind: 'store', store: next.slice('store:'.length) })
    }
  }

  return (
    <>
      <Choice label="Money went to" value={selected} options={choices} onChange={choose} />
      {value.kind === 'store' ? (
        <Field
          label="Store holding the credit"
          value={value.store}
          onChangeText={(store) => onChange({ kind: 'store', store })}
          autoFocus={!value.store}
          placeholder="Which shop?"
        />
      ) : null}
      <Copy muted>
        {value.kind === 'store'
          ? 'Store credit counts toward profit, never cash, and can only be spent at that shop.'
          : 'Choose the account that received the payout, or leave it unassigned.'}
      </Copy>
    </>
  )
}

function PreviewCard({ preview }: { preview: SalePreview }) {
  return (
    <Card>
      <Copy muted>Server preview</Copy>
      <Row>
        <ViewMetric label="Gross" value={money(preview.gross)} />
        <ViewMetric label="Fees" value={money(preview.fees)} />
        <ViewMetric label="Net proceeds" value={money(preview.net_proceeds)} />
      </Row>
      <Row>
        <ViewMetric label="Cost basis (FIFO)" value={preview.has_unknown_cost ? 'Unknown' : money(preview.cost_basis)} />
        <ViewMetric label="Realized profit" value={preview.has_unknown_cost ? 'Unknown' : money(preview.realized_profit)} />
      </Row>
      <Copy muted>
        Leaves {preview.quantity_remaining} unit{preview.quantity_remaining === 1 ? '' : 's'} on hand · {money(preview.remaining_cost)} at cost
      </Copy>
    </Card>
  )
}

function ViewMetric({ label, value }: { label: string; value: string }) {
  return <Text style={{ color: colors.text, minWidth: 100 }}><Text style={{ color: colors.muted }}>{label}{'\n'}</Text>{value}</Text>
}

function SaleForm({ product, onClose }: { product: Product; onClose: () => void }) {
  const api = useApi()
  const { accounts, currentMemberId, error: accountError } = useSaleAccounts()
  const members = useQuery({ queryKey: ['members'], queryFn: api.members })
  const [quantity, setQuantity] = useState('1')
  const [amount, setAmount] = useState('')
  const [saleDateValue, setSaleDateValue] = useState(todayIso())
  const [soldByMemberId, setSoldByMemberId] = useState('')
  const [marketplace, setMarketplace] = useState('')
  const [customMarketplace, setCustomMarketplace] = useState(false)
  const [platformFees, setPlatformFees] = useState('')
  const [paymentFees, setPaymentFees] = useState('')
  const [shippingPaid, setShippingPaid] = useState('')
  const [notes, setNotes] = useState('')
  const [bucketOverride, setBucketOverride] = useState<Bucket | null>(null)
  const [proceeds, setProceeds] = useState<SaleProceeds>(() => ({ kind: 'account', accountId: '' }))
  const [accountOverride, setAccountOverride] = useState<string | null>(null)
  const [allowOversell, setAllowOversell] = useState(false)
  const [validation, setValidation] = useState<SaleValidation>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: (input: NewSale) => api.createSale(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      onClose()
    },
  })

  const effectiveProceeds = useMemo(
    () => resolveSaleProceeds(proceeds, accountOverride, soldByMemberId, currentMemberId, accounts),
    [accountOverride, accounts, currentMemberId, proceeds, soldByMemberId],
  )
  const soldFrom = bucketOverride ?? fullestBucket(product.stats.by_bucket)
  const selectedMarketplace = MARKETPLACES.find((item) => item.name === marketplace)
  const draft = useMemo<SaleDraft>(() => ({
    productId: product.id,
    quantity,
    amount,
    platformFees,
    paymentFees,
    shippingPaid,
    saleDate: saleDateValue,
    bucket: soldFrom,
    soldByMemberId,
    marketplace,
    notes,
    allowOversell,
    proceeds: effectiveProceeds,
  }), [product.id, quantity, amount, platformFees, paymentFees, shippingPaid, saleDateValue, soldFrom, soldByMemberId, marketplace, notes, allowOversell, effectiveProceeds])
  const request = useMemo(() => previewInput(draft), [draft])
  const requestKey = request ? salePreviewKey(request) : 'invalid'
  const preview = useQuery<SalePreviewEnvelope>({
    queryKey: ['salePreview', requestKey],
    enabled: request !== null,
    queryFn: async () => {
      if (!request) throw new Error('Sale preview input is incomplete.')
      return { input: request, result: await api.previewSale(request) }
    },
  })
  const currentPreview = request && preview.data && isPreviewCurrent(request, preview.data.input)
    ? preview.data.result
    : null
  const availableHere = product.stats.by_bucket[soldFrom] ?? 0

  function chooseProceeds(next: SaleProceeds) {
    setProceeds(next)
    setAccountOverride(next.kind === 'account' ? next.accountId : '')
  }

  function submit() {
    setSubmitError(null)
    const errors = validateSaleDraft(draft)
    if (currentPreview?.exceeds_stock && !allowOversell) {
      errors.quantity = `Only ${currentPreview.quantity_available} units are recorded. Allow oversell to continue.`
    }
    if (request && preview.isFetching && !currentPreview) {
      setSubmitError('Wait for the latest server preview before recording this sale.')
    }
    setValidation(errors)
    if (Object.keys(errors).length > 0 || (request && preview.isFetching && !currentPreview)) return
    const payload = buildSalePayload(draft)
    if (!payload) {
      setSubmitError('Complete the sale fields before recording it.')
      return
    }
    create.mutate(payload)
  }

  return (
    <SaleSheet
      title={`Record sale — ${product.name}`}
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Record sale"
      busy={create.isPending}
      error={create.error ?? accountError ?? members.error ?? (submitError ? new Error(submitError) : preview.error)}
      validation={validation}
    >
      <Card>
        <Copy>{product.name}</Copy>
        <Copy muted>{product.game.name} · {product.product_type.name} · {product.stats.quantity_on_hand} on hand</Copy>
      </Card>
      <Row>
        <Field label="Quantity" value={quantity} onChangeText={setQuantity} keyboardType="number-pad" autoFocus />
        <Field label="Total received" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
      </Row>
      <Choice
        label="Sold from"
        value={soldFrom}
        options={BUCKETS.map((bucket) => option(bucket, `${BUCKET_LABELS[bucket]} (${product.stats.by_bucket[bucket] ?? 0})`))}
        onChange={(next) => setBucketOverride(next as Bucket)}
      />
      <Copy muted>{availableHere} units are recorded in {BUCKET_LABELS[soldFrom]}.</Copy>
      <Choice
        label="Sold on"
        value={customMarketplace ? '__custom__' : marketplace}
        options={[
          option('', 'Choose a channel'),
          ...MARKETPLACES.map((item) => option(item.name, item.name)),
          option('__custom__', 'Other'),
        ]}
        onChange={(next) => {
          if (next === '__custom__') {
            setCustomMarketplace(true)
            setMarketplace('')
          } else {
            setCustomMarketplace(false)
            setMarketplace(next)
          }
        }}
      />
      {customMarketplace ? <Field label="Channel name" value={marketplace} onChangeText={setMarketplace} autoFocus placeholder="Card shop, show, trade" /> : null}
      {selectedMarketplace ? <Copy muted>{selectedMarketplace.name} usually lists a {selectedMarketplace.feePercent}% all-in cut; enter what was actually charged.</Copy> : null}
      <ProceedsChoice accounts={accounts} value={effectiveProceeds} onChange={chooseProceeds} />
      <Row>
        <Choice
          label="Sold by"
          value={soldByMemberId}
          options={[option('', 'Me'), ...(members.data ?? []).map((member) => option(member.id, member.display_name))]}
          onChange={setSoldByMemberId}
        />
        <Field label="Sale date" value={saleDateValue} onChangeText={setSaleDateValue} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />
      </Row>
      <Row>
        <Field label="Platform fees" value={platformFees} onChangeText={setPlatformFees} keyboardType="decimal-pad" placeholder="0.00" />
        <Field label="Payment fees" value={paymentFees} onChangeText={setPaymentFees} keyboardType="decimal-pad" placeholder="0.00" />
        <Field label="Shipping paid" value={shippingPaid} onChangeText={setShippingPaid} keyboardType="decimal-pad" placeholder="0.00" />
      </Row>
      {currentPreview ? <PreviewCard preview={currentPreview} /> : null}
      {currentPreview?.exceeds_stock ? (
        <Card>
          <Copy muted>This sale exceeds the available quantity and would leave the extra units with unknown cost.</Copy>
          <Button label={allowOversell ? 'Oversell allowed' : 'Allow oversell'} onPress={() => setAllowOversell((current) => !current)} />
        </Card>
      ) : null}
      <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
    </SaleSheet>
  )
}

export function RecordSaleDialog({ product, onClose }: RecordSaleDialogProps) {
  const api = useApi()
  const [picked, setPicked] = useState(product)
  const [search, setSearch] = useState('')
  const picker = useQuery({
    queryKey: ['products', 'sale-picker', search],
    enabled: !picked,
    queryFn: () => api.products({ q: search || undefined, stock: 'in', limit: 30 }),
  })

  if (!picked) {
    return (
      <ProductPicker
        products={picker.data?.items ?? []}
        search={search}
        onSearch={setSearch}
        onPick={setPicked}
        onClose={onClose}
        error={picker.error}
      />
    )
  }
  return <SaleForm product={picked} onClose={onClose} />
}

export default RecordSaleDialog
