import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { useApi } from '../context/AppContext'
import {
  buildGradedProductPayload,
  buildReturnFromGradingPayload,
  buildSendToGradingPayload,
  buildVoidGradingPayload,
  firstGradingValidationError,
  gradingAvailable,
  validateGradingReturnContext,
  validateReturnFromGradingDraft,
  validateSendToGradingDraft,
  validateVoidGradingDraft,
  type GradingValidation,
  type ReturnFromGradingDraft,
  type SendToGradingDraft,
  type VoidGradingDraft,
} from '../lib/grading-drafts'
import { todayIso } from '../lib/format'
import {
  BUCKET_LABELS,
  BUCKETS,
  type Bucket,
  type GradingSubmission,
  type Product,
  type ProductDetail,
} from '../lib/api'
import { Button, Card, Choice, Copy, ErrorNotice, Field, Row, Sheet } from './ui'

/** Graders worth a quick tap; the text field remains available for every other company. */
export const GRADING_COMPANIES = ['PSA', 'BGS', 'CGC', 'SGC'] as const

export interface SendToGradingDialogProps {
  product: ProductDetail
  onClose: () => void
}

export interface ReturnFromGradingDialogProps {
  submission: GradingSubmission
  product: ProductDetail
  onClose: () => void
}

export interface VoidGradingDialogProps {
  submission: GradingSubmission
  onClose: () => void
}

interface GradingSheetProps {
  title: string
  onClose: () => void
  onSubmit: () => void
  busy: boolean
  submitLabel: string
  error?: unknown
  validation?: GradingValidation
  canSubmit?: boolean
  children: React.ReactNode
}

function GradingSheet({
  title,
  onClose,
  onSubmit,
  busy,
  submitLabel,
  error,
  validation,
  canSubmit = true,
  children,
}: GradingSheetProps) {
  const validationMessage = firstGradingValidationError(validation ?? {})
  const close = busy ? () => undefined : onClose
  return (
    <Sheet title={title} open onClose={close} dismissDisabled={busy}>
      {children}
      {validationMessage ? <ErrorNotice error={new Error(validationMessage)} /> : null}
      {error ? <ErrorNotice error={error} /> : null}
      {canSubmit ? (
        <Button label={busy ? 'Saving…' : submitLabel} onPress={onSubmit} disabled={busy} />
      ) : null}
    </Sheet>
  )
}

function option(value: string, label: string) {
  return { value, label }
}

function text(value: string | null | undefined): string {
  return value ?? ''
}

function productIdentity(product: Product): string {
  return [
    product.grading_company,
    product.grade,
    product.cert_number ? `Cert ${product.cert_number}` : null,
  ].filter(Boolean).join(' · ')
}

/** "Mickey Mouse Iconic" + PSA + 10 -> "Mickey Mouse Iconic — PSA 10". */
export function gradedName(raw: string, company: string | null, grade: string): string {
  const suffix = [company?.trim(), grade.trim()].filter(Boolean).join(' ')
  return suffix ? `${raw} — ${suffix}` : raw
}

function BucketChoice({
  value,
  counts,
  onChange,
}: {
  value: Bucket
  counts: Record<Bucket, number>
  onChange: (value: Bucket) => void
}) {
  return (
    <Choice
      label="Sent from"
      value={value}
      options={BUCKETS.map((bucket) => option(bucket, `${BUCKET_LABELS[bucket]} (${counts[bucket] ?? 0})`))}
      onChange={(next) => onChange(next as Bucket)}
    />
  )
}

/** Send a flag to the grader. Stock and cost do not move until the return transformation. */
export function SendToGradingDialog({ product, onClose }: SendToGradingDialogProps) {
  const api = useApi()
  const queryClient = useQueryClient()
  const submissions = useQuery({ queryKey: ['grading', product.id], queryFn: () => api.gradingSubmissions({ product_id: product.id }) })
  const counts = gradingAvailable(product.id, product.stats.by_bucket, submissions.data ?? [])
  const initialBucket = BUCKETS.find((bucket) => (counts[bucket] ?? 0) > 0) ?? 'inventory'
  const [bucket, setBucket] = useState<Bucket>(initialBucket)
  const [quantity, setQuantity] = useState('1')
  const [gradingCompany, setGradingCompany] = useState('PSA')
  const [sentOn, setSentOn] = useState(todayIso())
  const [fees, setFees] = useState('')
  const [notes, setNotes] = useState('')
  const [validation, setValidation] = useState<GradingValidation>({})

  const send = useMutation({
    mutationFn: async (draft: SendToGradingDraft) => {
      const [current, outstanding] = await Promise.all([api.product(product.id), api.gradingSubmissions({ product_id: product.id })])
      const error = firstGradingValidationError(validateSendToGradingDraft(draft, gradingAvailable(product.id, current.stats.by_bucket, outstanding)))
      if (error) throw new Error(error)
      const payload = buildSendToGradingPayload(draft)
      if (!payload) throw new Error('Complete the grading fields before sending it.')
      return api.sendToGrading(payload)
    },
    onSuccess: async () => {
      // The server is authoritative for stock and cost. Refresh every active view after
      // the committed flag so product history, bucket counts and outstanding submissions
      // cannot remain stale.
      await queryClient.invalidateQueries()
      onClose()
    },
  })

  function submit() {
    const draft: SendToGradingDraft = {
      productId: product.id,
      quantity,
      bucket,
      gradingCompany,
      sentOn,
      fees,
      notes,
    }
    const errors = validateSendToGradingDraft(draft, counts[bucket] ?? 0)
    if (!submissions.isSuccess || submissions.isFetching) errors.submissionId = 'Wait for grading availability to load before sending.'
    setValidation(errors)
    if (firstGradingValidationError(errors)) return
    send.mutate(draft)
  }

  return (
    <GradingSheet
      title={`Send to grading — ${product.name}`}
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Send it"
      busy={send.isPending}
      error={send.error ?? submissions.error}
      validation={validation}
    >
      <Card>
        <Copy>{product.name}</Copy>
        <Copy muted>
          {product.stats.quantity_on_hand} units on hand. The server keeps the original
          purchase dates and FIFO cost until the card comes back.
        </Copy>
      </Card>
      <Row>
        <Field label="How many" value={quantity} onChangeText={setQuantity} keyboardType="number-pad" autoFocus />
        <Field
          label="Grading, postage and insurance"
          value={fees}
          onChangeText={setFees}
          keyboardType="decimal-pad"
          placeholder="0.00"
        />
      </Row>
      <Copy muted>
        Fees stay decimal strings and are added to the graded card&apos;s server-side cost on return.
      </Copy>
      <Choice
        label="Grader"
        value={gradingCompany}
        options={GRADING_COMPANIES.map((company) => option(company, company))}
        onChange={setGradingCompany}
      />
      <Field
        label="Grader name"
        value={gradingCompany}
        onChangeText={setGradingCompany}
        placeholder="PSA, BGS, or another grader"
      />
      <Field
        label="Sent on"
        value={sentOn}
        onChangeText={setSentOn}
        keyboardType="numbers-and-punctuation"
        placeholder="YYYY-MM-DD"
      />
      <BucketChoice value={bucket} counts={counts} onChange={setBucket} />
      <Copy muted>
        It stays in {BUCKET_LABELS[bucket]} while away. The bucket counts above are a
        client-side guard; the server checks availability again when you send.
      </Copy>
      <Field label="Note" value={notes} onChangeText={setNotes} multiline />
    </GradingSheet>
  )
}

interface ReturnMutationInput {
  draft: ReturnFromGradingDraft
  childPayload: ReturnFromGradingDraft
}

function ExistingGradedProductPicker({
  sourceProductId,
  selectedId,
  onSelect,
}: {
  sourceProductId: string
  selectedId: string
  onSelect: (id: string) => void
}) {
  const api = useApi()
  const [search, setSearch] = useState('')
  const products = useQuery({
    queryKey: ['gradingChildProducts', search],
    queryFn: () => api.products({
      q: search.trim() || undefined,
      product_type: 'graded-card',
      include_archived: false,
      limit: 30,
    }),
  })
  const items = (products.data?.items ?? []).filter((item) => item.id !== sourceProductId)

  return (
    <>
      <Field label="Find an existing graded card" value={search} onChangeText={setSearch} autoFocus />
      {products.error ? <ErrorNotice error={products.error} /> : null}
      {products.isPending ? <Copy muted>Looking for graded cards…</Copy> : null}
      {!products.isPending && items.length === 0 ? <Copy muted>No graded cards match.</Copy> : null}
      {items.map((item) => (
        <Button
          key={item.id}
          label={`${selectedId === item.id ? 'Selected: ' : ''}${item.name}${productIdentity(item) ? ` · ${productIdentity(item)}` : ''}`}
          onPress={() => onSelect(item.id)}
        />
      ))}
    </>
  )
}

/**
 * Record the return transformation. A graded child may be selected or created inline.
 * Once an inline child is created, its ID is retained in a ref so a failed return retry
 * cannot create a duplicate child.
 */
export function ReturnFromGradingDialog({
  submission,
  product,
  onClose,
}: ReturnFromGradingDialogProps) {
  const api = useApi()
  const queryClient = useQueryClient()
  const productTypes = useQuery({ queryKey: ['productTypes'], queryFn: api.productTypes })
  const [childMode, setChildMode] = useState<'create' | 'existing'>('create')
  const [existingProductId, setExistingProductId] = useState('')
  const createdChildIdRef = useRef<string | null>(null)
  const [createdChildId, setCreatedChildId] = useState<string | null>(null)
  const [grade, setGrade] = useState('')
  const [name, setFinalName] = useState('')
  const [certNumber, setCertNumber] = useState('')
  const [setLabel, setSetLabel] = useState(text(product.set_name))
  const [collectorNumber, setCollectorNumber] = useState(text(product.collector_number))
  const [variant, setVariant] = useState(text(product.variant))
  const [language, setLanguage] = useState(text(product.language))
  const [condition, setCondition] = useState('')
  const [storageLocation, setStorageLocation] = useState('')
  const [returnedOn, setReturnedOn] = useState(todayIso())
  const [extraFees, setExtraFees] = useState('')
  const [notes, setNotes] = useState('')
  const [validation, setValidation] = useState<GradingValidation>({})

  const gradedTypeId = productTypes.data?.find((item) => item.slug === 'graded-card')?.id ?? ''
  const suggested = gradedName(product.name, submission.grading_company, grade)
  const finalName = name || suggested
  const lockedChild = Boolean(createdChildId)
  const canReturn = submission.status === 'out'

  const returned = useMutation({
    mutationFn: async ({ draft, childPayload }: ReturnMutationInput) => {
      const [current, outstanding] = await Promise.all([api.product(product.id), api.gradingSubmissions({ product_id: product.id })])
      const latest = outstanding.find(s => s.id === submission.id)
      if (!latest) throw new Error('This grading submission is no longer available.')
      const error = firstGradingValidationError(validateGradingReturnContext(latest, current.stats.by_bucket, draft.returnedOn))
      if (error) throw new Error(error)
      // This ref is the retry identity. It is set immediately after createProduct resolves,
      // before invalidation or the return call, so every later attempt reuses that row.
      let gradedProductId = createdChildIdRef.current ?? (draft.gradedProductId.trim() || null)
      if (!gradedProductId) {
        const child = buildGradedProductPayload(childPayload)
        if (!child) throw new Error('Complete the graded card identity before creating it.')
        const created = await api.createProduct(child)
        gradedProductId = created.id
        createdChildIdRef.current = gradedProductId
        setCreatedChildId(gradedProductId)
        // Product creation is a committed write even if the subsequent return fails.
        await queryClient.invalidateQueries()
      }

      const payload = buildReturnFromGradingPayload({ ...draft, gradedProductId })
      if (!payload) throw new Error('Complete the return fields before recording it.')
      const result = await api.returnFromGrading(submission.id, payload)
      await queryClient.invalidateQueries()
      return result
    },
    onSuccess: onClose,
  })

  function submit() {
    const selectedId = createdChildIdRef.current ?? (childMode === 'existing' ? existingProductId : '')
    const inlineTypeId = gradedTypeId
    const draft: ReturnFromGradingDraft = {
      submissionId: submission.id,
      sourceProductId: product.id,
      gradedProductId: selectedId,
      name: finalName,
      gameId: product.game.id,
      productTypeId: inlineTypeId,
      setName: setLabel,
      collectorNumber,
      variant,
      language,
      condition,
      gradingCompany: submission.grading_company,
      grade,
      certNumber,
      storageLocation,
      returnedOn,
      extraFees,
      notes,
    }
    const errors = validateReturnFromGradingDraft(draft)
    Object.assign(errors, validateGradingReturnContext(submission, product.stats.by_bucket, returnedOn))
    if (!canReturn) errors.submissionId = 'Only an outstanding submission can be returned.'
    if (childMode === 'existing' && !selectedId) {
      errors.gradedProductId = 'Choose an existing graded card, or switch to create one.'
    }
    if (!gradedTypeId && !selectedId) {
      errors.productTypeId = productTypes.error
        ? 'The graded card product type could not be loaded.'
        : 'The graded card product type is not available.'
    }
    setValidation(errors)
    if (firstGradingValidationError(errors)) return

    returned.mutate({ draft, childPayload: draft })
  }

  const childError = productTypes.error
  return (
    <GradingSheet
      title={`Back from ${submission.grading_company ?? 'grading'} — ${product.name}`}
      onClose={onClose}
      onSubmit={submit}
      submitLabel={returned.isError && createdChildId ? 'Retry return' : 'Record it'}
      busy={returned.isPending}
      error={returned.error ?? childError}
      validation={validation}
      canSubmit={canReturn}
    >
      <Card>
        <Copy>{product.name}</Copy>
        <Copy muted>
          {submission.quantity} unit{submission.quantity === 1 ? '' : 's'} · {BUCKET_LABELS[submission.bucket]} ·
          {' '}{submission.days_out} day{submission.days_out === 1 ? '' : 's'} out
        </Copy>
        <Copy muted>
          The server consumes the raw row on return and carries its original purchase date
          and FIFO cost into the graded child, plus the fees below.
        </Copy>
      </Card>
      {!canReturn ? <ErrorNotice error={new Error('Only an outstanding submission can be returned.')} /> : null}
      <Row>
        <Field label="Grade" value={grade} onChangeText={setGrade} autoFocus placeholder="10" editable={!lockedChild} />
        <Field
          label="Came back on"
          value={returnedOn}
          onChangeText={setReturnedOn}
          keyboardType="numbers-and-punctuation"
          placeholder="YYYY-MM-DD"
        />
      </Row>
      <Choice
        label="Graded card"
        value={createdChildId ? 'created' : childMode}
        options={[
          ...(createdChildId ? [{ value: 'created', label: 'Created graded card (retry reuses it)' }] : []),
          { value: 'create', label: 'Create a graded card' },
          { value: 'existing', label: 'Use an existing graded card' },
        ]}
        onChange={(next) => {
          if (!lockedChild) setChildMode(next as 'create' | 'existing')
        }}
      />
      {childMode === 'existing' && !createdChildId ? (
        <ExistingGradedProductPicker
          sourceProductId={product.id}
          selectedId={existingProductId}
          onSelect={setExistingProductId}
        />
      ) : null}
      {createdChildId ? (
        <Card>
          <Copy>Created graded card</Copy>
          <Copy muted>The same child will be reused if recording the return needs a retry.</Copy>
        </Card>
      ) : null}
      {childMode === 'create' && !createdChildId ? (
        <>
          <Field
            label="Now called"
            value={finalName}
            onChangeText={setFinalName}
            placeholder="Name for the slab"
          />
          <Row>
            <Field label="Grading company" value={text(submission.grading_company)} editable={false} />
            <Field label="Cert number" value={certNumber} onChangeText={setCertNumber} placeholder="Optional" />
          </Row>
          <Row>
            <Field label="Set" value={setLabel} onChangeText={setSetLabel} />
            <Field label="Collector number" value={collectorNumber} onChangeText={setCollectorNumber} />
          </Row>
          <Row>
            <Field label="Variant" value={variant} onChangeText={setVariant} />
            <Field label="Language" value={language} onChangeText={setLanguage} />
          </Row>
          <Row>
            <Field label="Condition" value={condition} onChangeText={setCondition} placeholder="Optional" />
            <Field label="Storage location" value={storageLocation} onChangeText={setStorageLocation} placeholder="Optional" />
          </Row>
        </>
      ) : null}
      <Field
        label="Anything else it cost"
        value={extraFees}
        onChangeText={setExtraFees}
        keyboardType="decimal-pad"
        placeholder="0.00"
      />
      <Copy muted>
        Extra fees stay decimal strings. They are added by the server to the fee already
        recorded on the submission; the client never calculates cost or profit.
      </Copy>
      <Field label="Note" value={notes} onChangeText={setNotes} multiline />
    </GradingSheet>
  )
}

/** Cancel an outstanding submission without changing stock; the audit row remains. */
export function VoidGradingDialog({ submission, onClose }: VoidGradingDialogProps) {
  const api = useApi()
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const [validation, setValidation] = useState<GradingValidation>({})
  const voidMutation = useMutation({
    mutationFn: (draft: VoidGradingDraft) => {
      const payload = buildVoidGradingPayload(draft)
      if (!payload) throw new Error('Give a reason before cancelling this submission.')
      return api.voidGradingSubmission(submission.id, payload)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      onClose()
    },
  })

  const canVoid = submission.status === 'out'
  function submit() {
    const draft = { submissionId: submission.id, reason }
    const errors = validateVoidGradingDraft(draft)
    if (!canVoid) errors.reason = 'Only an outstanding submission can be cancelled.'
    setValidation(errors)
    if (firstGradingValidationError(errors)) return
    voidMutation.mutate(draft)
  }

  return (
    <GradingSheet
      title="Cancel grading submission"
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Cancel submission"
      busy={voidMutation.isPending}
      error={voidMutation.error}
      validation={validation}
      canSubmit={canVoid}
    >
      <Card>
        <Copy>{submission.product_name}</Copy>
        <Copy muted>
          This leaves stock where it is and marks the submission cancelled in history.
        </Copy>
      </Card>
      {!canVoid ? <ErrorNotice error={new Error('Only an outstanding submission can be cancelled.')} /> : null}
      <Field label="Reason" value={reason} onChangeText={setReason} autoFocus placeholder="Entered twice" multiline />
    </GradingSheet>
  )
}
