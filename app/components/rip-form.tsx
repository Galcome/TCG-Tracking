import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { View } from 'react-native'

import { useApi } from '../context/AppContext'
import { colors } from '../context/ThemeContext'
import {
  BUCKET_LABELS,
  BUCKETS,
  type Api,
  type Bucket,
  type ProductCandidate,
  type Product,
  type ReadCard,
  type RipPreview,
} from '../lib/api'
import {
  buildRipPreviewPayload,
  buildRipPayload,
  emptyRipConfirmationKey,
  filledRipHits,
  firstRipValidationError,
  isRipPreviewCurrent,
  ripCandidateIdentity,
  ripHitProductType,
  ripIdentityKey,
  ripPreviewKey,
  validateRipPreviewDraft,
  validateRipDraft,
  type RipDraft,
  type RipHitChoice,
  type RipHitDraft,
  type RipPreviewEnvelope,
  type RipValidation,
} from '../lib/rip-drafts'
import { money, todayIso } from '../lib/format'
import { Button, Card, Choice, Copy, ErrorNotice, Field, Loading, Row, Sheet } from './ui'
import { PhotoReader } from './photo-reader'
import { CardScanner, canLiveScan } from './card-scanner'
import { scanReviewError, type ScanItem } from '../lib/scan-session'
import { DateField } from './date-field'

export interface RipDialogProps {
  product: Product
  onClose: () => void
  initialBucket?: Bucket
}

type IdentityField = 'name' | 'setName' | 'collectorNumber' | 'variant' | 'language'

let nextHitKey = 1

function emptyHit(bucket: Bucket = 'inventory'): RipHitDraft {
  return {
    key: nextHitKey++,
    productId: '',
    name: '',
    setName: '',
    collectorNumber: '',
    variant: '',
    language: '',
    choice: 'undecided',
    selectedProductName: '',
    quantity: '1',
    value: '',
    cost: '',
    bucket,
  }
}

function candidateIdentitySummary(candidate: ProductCandidate): string {
  return [
    candidate.set_name,
    candidate.collector_number,
    candidate.variant,
    candidate.language,
  ]
    .filter(Boolean)
    .join(' · ')
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexGrow: 1, minWidth: 130, gap: 3 }}>
      <Copy muted>{label}</Copy>
      <Copy>{value}</Copy>
    </View>
  )
}

function RipPreviewCard({
  preview,
  rows,
  loading,
  error,
  validation,
  onRetry,
}: {
  preview: RipPreview | null
  rows: readonly RipHitDraft[]
  loading: boolean
  error?: unknown
  validation: RipValidation
  onRetry: () => void
}) {
  const validationError = firstRipValidationError(validation)
  return (
    <Card>
      <Copy>Estimated FIFO allocation</Copy>
      <Copy muted>Estimated FIFO allocation. Not reserved; stock and costs are checked again when saved.</Copy>
      {validationError ? <ErrorNotice error={new Error(validationError)} /> : null}
      {!validationError && error ? <ErrorNotice error={error} retry={onRetry} /> : null}
      {!validationError && loading ? <Loading /> : null}
      {!validationError && !loading && preview ? (
        <>
          <Row>
            <PreviewMetric label="Source cost" value={preview.has_unknown_cost ? 'Unknown' : money(preview.source_cost)} />
            <PreviewMetric label="Available in bucket" value={String(preview.quantity_available)} />
            <PreviewMetric label="Bulk write-off" value={money(preview.bulk_cost)} />
          </Row>
          {preview.hits.length === 0 ? <Copy muted>No tracked hits; the source cost is shown as bulk.</Copy> : (
            <View style={{ gap: 8 }}>
              {preview.hits.map((hit) => {
                const draft = rows.find((row) => String(row.key) === hit.key)
                const name = draft?.name.trim() || draft?.selectedProductName || `Hit ${hit.key}`
                return (
                  <View key={hit.key} style={{ borderTopWidth: 1, borderTopColor: colors.edge, paddingTop: 8 }}>
                    <Copy>{name} · {hit.quantity} unit{hit.quantity === 1 ? '' : 's'}</Copy>
                    <Copy muted>Allocated cost: {money(hit.cost)}</Copy>
                  </View>
                )
              })}
            </View>
          )}
          {preview.nonbinding ? <Copy muted>Not reserved.</Copy> : null}
        </>
      ) : null}
    </Card>
  )
}

interface HitIdentityChooserProps {
  api: Api
  row: RipHitDraft
  index: number
  gameId: string
  newProductTypeLabel: string
  busy: boolean
  onFieldChange: (field: IdentityField, value: string) => void
  onQuantityChange: (value: string) => void
  onValueChange: (value: string) => void
  onCostChange: (value: string) => void
  onRemove: () => void
  canRemove: boolean
  onChoice: (choice: RipHitChoice, candidate?: ProductCandidate) => void
}

function HitIdentityChooser({
  api,
  row,
  index,
  gameId,
  newProductTypeLabel,
  busy,
  onFieldChange,
  onQuantityChange,
  onValueChange,
  onCostChange,
  onRemove,
  canRemove,
  onChoice,
}: HitIdentityChooserProps) {
  const key = ripIdentityKey(row)
  const [searchedKey, setSearchedKey] = useState('')
  const candidates = useQuery({
    queryKey: ['productCandidates', gameId, row.key, key],
    queryFn: () => api.productCandidates(ripCandidateIdentity(row, gameId)),
    enabled: !busy && row.name.trim().length > 0 && searchedKey === key,
  })

  const fields: [IdentityField, string][] = [
    ['setName', 'Set'],
    ['collectorNumber', 'Collector number'],
    ['variant', 'Variant'],
    ['language', 'Language'],
  ]

  function search() {
    if (searchedKey === key) {
      void candidates.refetch()
    } else {
      setSearchedKey(key)
    }
  }

  const createdAndRetained = row.choice === 'create' && Boolean(row.productId)

  return (
    <Card>
      <Row>
        <Field
          label={`Hit ${index + 1} name`}
          value={row.name}
          onChangeText={(value) => onFieldChange('name', value)}
          editable={!busy}
          autoFocus={index === 0}
          placeholder="Card name"
        />
        <Field
          label={`Hit ${index + 1} value`}
          value={row.value}
          onChangeText={onValueChange}
          editable={!busy}
          keyboardType="decimal-pad"
          placeholder="0.00"
        />
        <Field
          label={`Hit ${index + 1} cost override`}
          value={row.cost ?? ''}
          onChangeText={onCostChange}
          editable={!busy}
          keyboardType="decimal-pad"
          placeholder="Optional"
        />
        <Field
          label={`Hit ${index + 1} quantity`}
          value={row.quantity}
          onChangeText={onQuantityChange}
          editable={!busy}
          keyboardType="number-pad"
          placeholder="1"
        />
        <Button
          label={`Remove hit ${index + 1}`}
          disabled={busy || !canRemove}
          onPress={onRemove}
        />
      </Row>
      <Row>
        {fields.map(([field, label]) => (
          <Field
            key={field}
            label={`Hit ${index + 1} ${label}`}
            value={row[field]}
            onChangeText={(value) => onFieldChange(field, value)}
            editable={!busy}
            placeholder={label}
          />
        ))}
      </Row>
      <Row>
        <Button
          label={candidates.isFetching ? 'Searching existing products…' : 'Find existing product'}
          disabled={busy || !row.name.trim() || candidates.isFetching}
          onPress={search}
        />
        <Button
          label="Create new product"
          disabled={busy}
          onPress={() => onChoice('create')}
        />
      </Row>
      {row.choice === 'reuse' ? (
        <Copy muted>Reusing {row.selectedProductName || 'the selected product'}.</Copy>
      ) : row.choice === 'create' ? (
        <Copy muted>
          {createdAndRetained
            ? `New product ready: ${row.selectedProductName || row.productId}. Retry will reuse it.`
            : `A new ${newProductTypeLabel} product will be created when this rip is saved.`}
        </Copy>
      ) : (
        <Copy muted>Choose Reuse or Create new product before saving.</Copy>
      )}
      {searchedKey === key && candidates.isError ? (
        <ErrorNotice error={candidates.error} retry={() => { void candidates.refetch() }} />
      ) : null}
      {searchedKey === key && candidates.data && candidates.data.length === 0 ? (
        <Copy muted>No strong match found. Choose Create new product if this is new.</Copy>
      ) : null}
      {searchedKey === key && candidates.data && candidates.data.length > 0 ? (
        <Card>
          <Copy muted>Review a candidate, then explicitly choose whether to reuse it.</Copy>
          {candidates.data.map((candidate) => (
            <Card key={candidate.id}>
              <Copy>
                {candidate.name}
                {candidateIdentitySummary(candidate) ? ` · ${candidateIdentitySummary(candidate)}` : ''}
              </Copy>
              <Copy muted>
                {candidate.product_type.name} · {candidate.quantity_on_hand} in stock · score {candidate.match_score}
              </Copy>
              <Button
                label={`Reuse ${candidate.name}`}
                disabled={busy}
                onPress={() => onChoice('reuse', candidate)}
              />
            </Card>
          ))}
        </Card>
      ) : null}
    </Card>
  )
}

interface RipSheetProps {
  title: string
  onClose: () => void
  onSubmit: () => void
  submitLabel: string
  busy: boolean
  error?: unknown
  uploadBusy?: boolean
  validation: RipValidation
  children: React.ReactNode
}

function RipSheet({
  title,
  onClose,
  onSubmit,
  submitLabel,
  busy,
  error,
  uploadBusy,
  validation,
  children,
}: RipSheetProps) {
  const firstError = firstRipValidationError(validation)
  return (
    <Sheet title={title} open onClose={busy ? () => undefined : onClose} dismissDisabled={busy}>
      {children}
      {firstError ? <ErrorNotice error={new Error(firstError)} /> : null}
      {error ? <ErrorNotice error={error} /> : null}
      <Button label={busy ? 'Saving…' : submitLabel} onPress={onSubmit} disabled={busy || uploadBusy} />
    </Sheet>
  )
}

function option(value: string, label: string) {
  return { value, label }
}

function bucketLabel(bucket: Bucket, count: number): string {
  return `${BUCKET_LABELS[bucket]} (${count})`
}

/**
 * Photo suggestions and manual entry share human-controlled identity and save decisions.
 */
export function RipDialog({ product, onClose, initialBucket }: RipDialogProps) {
  const api = useApi()
  const queryClient = useQueryClient()
  const productTypes = useQuery({ queryKey: ['productTypes'], queryFn: api.productTypes })

  const held = product.stats.by_bucket
  const [fromBucket, setFromBucket] = useState<Bucket>(
    initialBucket && (held[initialBucket] ?? 0) > 0
      ? initialBucket
      : BUCKETS.find((bucket) => (held[bucket] ?? 0) > 0) ?? 'inventory',
  )
  const [sourceQuantity, setSourceQuantity] = useState('1')
  const [occurredOn, setOccurredOn] = useState(todayIso())
  const [rows, setRows] = useState<RipHitDraft[]>([emptyHit()])
  const [photoBusy, setPhotoBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [validation, setValidation] = useState<RipValidation>({})
  const [emptyConfirmedKey, setEmptyConfirmedKey] = useState<string | null>(null)

  const draft = useMemo<RipDraft>(() => ({
    sourceProductId: product.id,
    sourceQuantity,
    fromBucket,
    occurredOn,
    hits: rows,
  }), [fromBucket, occurredOn, product.id, rows, sourceQuantity])
  const filled = filledRipHits(rows)
  const emptyKey = emptyRipConfirmationKey(draft)
  const emptyConfirmationShown = filled.length === 0 && emptyConfirmedKey === emptyKey
  const previewValidation = useMemo(() => validateRipPreviewDraft(draft), [draft])
  const previewInput = useMemo(() => buildRipPreviewPayload(draft), [draft])
  const previewKey = previewInput ? ripPreviewKey(previewInput) : 'invalid'
  const preview = useQuery<RipPreviewEnvelope>({
    queryKey: ['ripPreview', previewKey],
    enabled: previewInput !== null,
    queryFn: async () => {
      if (!previewInput) throw new Error('Rip preview input is incomplete.')
      return { input: previewInput, result: await api.previewRip(previewInput) }
    },
  })
  const currentPreview = previewInput && preview.data && isRipPreviewCurrent(previewInput, preview.data.input)
    ? preview.data.result
    : null

  const run = useMutation({
    mutationFn: async (submitted: RipDraft) => {
      const resolvedRows: RipHitDraft[] = []
      for (const row of filledRipHits(submitted.hits)) {
        let productId = row.productId
        if (row.choice === 'create' && !productId) {
          const type = ripHitProductType(productTypes.data)
          if (!type) throw new Error('Single or Raw Single product types are unavailable; cannot create a hit.')
          const created = await api.createProduct({
            name: row.name.trim(),
            game_id: product.game.id,
            product_type_id: type.id,
            set_name: row.setName.trim() || product.set_name || null,
            collector_number: row.collectorNumber.trim() || null,
            variant: row.variant.trim() || null,
            language: row.language.trim() || product.language || null,
          })
          productId = created.id
          // Keep the committed identity in the form before the next operation. If the rip
          // itself fails, retrying uses this id and cannot create a duplicate product.
          setRows((current) => current.map((item) => item.key === row.key
            ? {
                ...item,
                productId,
                selectedProductName: created.name,
                selectedProductTypeSlug: type.slug,
              }
            : item))
          // Product creation is a real partial commit, so refresh lists immediately even if
          // the subsequent rip write fails.
          await queryClient.invalidateQueries()
        }
        if (!productId) throw new Error('Choose an existing product or Create new product for every hit.')
        resolvedRows.push({ ...row, productId })
      }

      const resolvedDraft: RipDraft = {
        ...submitted,
        hits: submitted.hits.map((row) => {
          const resolved = resolvedRows.find((item) => item.key === row.key)
          return resolved ?? row
        }),
      }
      const payload = buildRipPayload(resolvedDraft, product, { productTypes: productTypes.data })
      if (!payload) throw new Error('Complete all rip fields before saving.')
      return api.ripOpen(payload)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      onClose()
    },
  })

  function submit() {
    if (run.isPending || photoBusy) return
    setValidation({})
    const errors = validateRipDraft(draft, product, { productTypes: productTypes.data })
    if (Object.keys(errors).length > 0) {
      setValidation(errors)
      return
    }
    if (filled.length === 0 && emptyConfirmedKey !== emptyKey) {
      setEmptyConfirmedKey(emptyKey)
      return
    }
    run.mutate(draft)
  }

  function changeSourceBucket(next: Bucket) {
    if (run.isPending) return
    setEmptyConfirmedKey(null)
    setFromBucket(next)
  }

  function changeSourceQuantity(next: string) {
    setEmptyConfirmedKey(null)
    setSourceQuantity(next)
  }

  function changeDate(next: string) {
    setEmptyConfirmedKey(null)
    setOccurredOn(next)
  }

  function updateIdentity(key: number | string, field: IdentityField, value: string) {
    setEmptyConfirmedKey(null)
    setRows((current) => current.map((row) => row.key === key
      ? {
          ...row,
          [field]: value,
          // A changed identity invalidates any old reuse/create identity. This also clears
          // an inline-created id so a new identity cannot silently reuse it.
          productId: '',
          choice: 'undecided',
          selectedProductName: '',
          selectedProductTypeSlug: undefined,
        }
      : row))
  }

  function updateChoice(key: number | string, choice: RipHitChoice, candidate?: ProductCandidate) {
    if (run.isPending) return
    setRows((current) => current.map((row) => row.key === key
      ? {
          ...row,
          choice,
          productId: candidate?.id ?? (choice === 'reuse' ? '' : row.productId),
          selectedProductName: candidate?.name ?? (choice === 'create' && row.productId ? row.selectedProductName : ''),
          selectedProductTypeSlug: candidate?.product_type.slug,
        }
      : row))
    setEmptyConfirmedKey(null)
  }

  function updateValue(key: number | string, value: string) {
    setEmptyConfirmedKey(null)
    setRows((current) => current.map((row) => row.key === key ? { ...row, value } : row))
  }

  function updateCost(key: number | string, cost: string) {
    setEmptyConfirmedKey(null)
    setRows((current) => current.map((row) => row.key === key ? { ...row, cost } : row))
  }

  function updateQuantity(key: number | string, quantity: string) {
    setEmptyConfirmedKey(null)
    setRows((current) => current.map((row) => row.key === key ? { ...row, quantity } : row))
  }

  function addRow() {
    if (run.isPending) return
    setEmptyConfirmedKey(null)
    setRows((current) => [...current, emptyHit(current[0]?.bucket ?? 'inventory')])
  }

  function removeRow(key: number | string) {
    if (run.isPending) return
    setEmptyConfirmedKey(null)
    setRows((current) => current.filter((row) => row.key !== key))
  }

  const lookupError = productTypes.error
  const lookupPending = productTypes.isPending
  const currentBucket = rows[0]?.bucket ?? 'inventory'

  function appendHits(hits: Partial<RipHitDraft>[]) {
    if (!hits.length) return
    setEmptyConfirmedKey(null)
    setRows((current) => {
      const blank = current.length === 1 && current[0].choice === 'undecided' && !current[0].productId &&
        !current[0].name && !current[0].setName && !current[0].collectorNumber && !current[0].variant && !current[0].language && !current[0].value && !current[0].cost && current[0].quantity === '1'
      const bucket = current[0]?.bucket ?? 'inventory'
      return [...(blank ? [] : current), ...hits.map((hit) => ({ ...emptyHit(bucket), ...hit }))]
    })
  }

  function appendPhotoCards(cards: ReadCard[]) {
    appendHits(cards.map((card) => ({
      name: card.name, setName: card.set_name, collectorNumber: card.collector_number,
      variant: card.variant, language: card.language,
    })))
  }

  /** Scanned cards arrive priced: the market price is each hit's value for the allocation. */
  function appendScannedCards(items: ScanItem[]) {
    appendHits(items.map((item) => ({
      name: item.name, setName: item.setName, collectorNumber: item.collectorNumber,
      variant: item.variant, language: item.language, quantity: String(item.quantity), value: item.price.trim(),
    })))
  }

  return (
    <RipSheet
      title={`Rip open — ${product.name}`}
      onClose={onClose}
      onSubmit={submit}
      submitLabel={filled.length === 0
        ? (emptyConfirmationShown ? 'Confirm bulk write-off' : 'Review bulk write-off')
        : 'Log the hits'}
      busy={run.isPending}
      uploadBusy={photoBusy}
      error={run.error ?? lookupError}
      validation={validation}
    >
      {lookupPending ? <Loading /> : null}
      <Card>
        <Copy>{product.name}</Copy>
        <Copy muted>
          {product.game.name} · {product.product_type.name} · {held[fromBucket] ?? 0} in {BUCKET_LABELS[fromBucket]}
        </Copy>
        <Copy muted>
          The API assigns FIFO cost and writes off unlogged bulk. This form never calculates
          cost, profit or any other financial amount.
        </Copy>
      </Card>

      <Row>
        <Field
          label="How many"
          value={sourceQuantity}
          onChangeText={changeSourceQuantity}
          editable={!run.isPending}
          keyboardType="number-pad"
          autoFocus
        />
        <DateField label="Date" value={occurredOn} onChange={changeDate} disabled={run.isPending} />
      </Row>

      <Choice
        label="Ripped out of"
        value={fromBucket}
        options={BUCKETS.map((bucket) => option(bucket, bucketLabel(bucket, held[bucket] ?? 0)))}
        onChange={(value) => changeSourceBucket(value as Bucket)}
      />

      <Choice
        label="Where hits go"
        value={currentBucket}
        options={BUCKETS.map((bucket) => option(bucket, BUCKET_LABELS[bucket]))}
        onChange={(value) => {
          if (run.isPending) return
          setEmptyConfirmedKey(null)
          setRows((current) => current.map((row) => ({ ...row, bucket: value as Bucket })))
        }}
      />

      <Copy muted>
        Add only the cards worth tracking. Every entered value is a dated estimate for the
        server&apos;s proportional allocation; it never becomes cost basis or profit.
      </Copy>
      {canLiveScan ? <Card>
        <Copy>Scan the hits</Copy>
        <Copy muted>Point the camera at the cards. Each is named and priced from TCGplayer in CAD; you review every row before logging.</Copy>
        <Button variant="primary" label="Scan cards" disabled={run.isPending} onPress={() => setScanning(true)} />
      </Card> : null}
      <CardScanner
        open={scanning}
        gameId={product.game.id}
        title="Scan the hits"
        doneLabel="Add to hits"
        validate={scanReviewError}
        onDone={appendScannedCards}
        onClose={() => setScanning(false)}
      />
      <PhotoReader disabled={run.isPending} onCards={appendPhotoCards} onBusy={setPhotoBusy} />
      {rows.map((row, index) => (
        <HitIdentityChooser
          key={row.key}
          api={api}
          row={row}
          index={index}
          gameId={product.game.id}
          newProductTypeLabel={ripHitProductType(productTypes.data)?.name ?? 'Single or Raw Single'}
          busy={run.isPending}
          onFieldChange={(field, value) => updateIdentity(row.key, field, value)}
          onQuantityChange={(value) => updateQuantity(row.key, value)}
          onValueChange={(value) => updateValue(row.key, value)}
          onCostChange={(value) => updateCost(row.key, value)}
          onRemove={() => removeRow(row.key)}
          canRemove={rows.length > 1 && !(row.choice === 'create' && Boolean(row.productId))}
          onChoice={(choice, candidate) => updateChoice(row.key, choice, candidate)}
        />
      ))}
      <RipPreviewCard
        preview={currentPreview}
        rows={filled}
        loading={previewInput !== null && preview.isFetching && !currentPreview}
        error={previewInput ? preview.error : undefined}
        validation={previewValidation}
        onRetry={() => { void preview.refetch() }}
      />
      <Button label="Add another hit" disabled={run.isPending} onPress={addRow} />

      {emptyConfirmationShown ? (
        <Card>
          <Copy>Confirm complete bulk write-off</Copy>
          <Copy muted>
            No hit products are entered. Recording this rip consumes {sourceQuantity} unit
            {sourceQuantity === '1' ? '' : 's'} from {BUCKET_LABELS[fromBucket]} and writes the
            complete FIFO source cost off as bulk.
          </Copy>
          <Button
            label="Confirm rip and write off as bulk"
            disabled={run.isPending || photoBusy}
            onPress={submit}
          />
        </Card>
      ) : null}
    </RipSheet>
  )
}

export default RipDialog
