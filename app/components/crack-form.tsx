import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'

import { useApi } from '../context/AppContext'
import {
  BUCKET_LABELS,
  BUCKETS,
  LANGUAGES,
  caseSize,
  boxSize,
  type Bucket,
  type Product,
  type ProductDetail,
  type Taxonomy,
} from '../lib/api'
import {
  EMPTY_CRACK_SPLIT,
  buildCrackPayload,
  crackInteger,
  crackSplitTotal,
  crackTotal,
  crackWords,
  validateCrackDraft,
  type CrackDraft,
  type CrackSplit,
  type CrackValidation,
} from '../lib/crack-drafts'
import { bySlug, opensInto, suggestedProductName } from '../lib/product-types'
import { todayIso } from '../lib/format'
import { Button, Card, Choice, Copy, ErrorNotice, Field, Loading, Row, Sheet } from './ui'

export interface CrackCaseDialogProps {
  product: ProductDetail
  onClose: () => void
}

interface CrackSheetProps {
  title: string
  onClose: () => void
  onSubmit: () => void
  busy: boolean
  error?: unknown
  validation?: CrackValidation
  children: React.ReactNode
}

function CrackSheet({ title, onClose, onSubmit, busy, error, validation, children }: CrackSheetProps) {
  const firstError = Object.values(validation ?? {}).find((message): message is string => Boolean(message))
  return (
    <Sheet title={title} open onClose={onClose} dismissDisabled={busy}>
      {children}
      {firstError ? <ErrorNotice error={new Error(firstError)} /> : null}
      {error ? <ErrorNotice error={error} /> : null}
      <Button label={busy ? 'Saving…' : 'Crack it open'} onPress={onSubmit} disabled={busy} />
    </Sheet>
  )
}

function option(value: string, label: string) {
  return { value, label }
}

function suggestChildName(sourceName: string, setName: string | null, childType: Taxonomy | undefined): string {
  const fromSet = suggestedProductName(setName ?? '', childType)
  if (fromSet) return fromSet
  const childTypeName = childType?.name ?? 'Child'
  const swapped = sourceName.replace(/\b(cases?|boxes|box)\b/i, childTypeName || 'Child')
  return swapped === sourceName ? `${sourceName} ${childTypeName || 'Child'}` : swapped
}

function bucketCountLabel(bucket: Bucket, count: number): string {
  return `${BUCKET_LABELS[bucket]} (${count})`
}

function childOptions(candidates: Product[], source: ProductDetail, setName: string | null) {
  const pickable = candidates.filter((item) => item.id !== source.id)
  const setKey = (setName ?? '').trim().toLowerCase()
  const sameSet = setKey
    ? pickable.filter((item) => (item.set_name ?? '').trim().toLowerCase() === setKey)
    : []
  const others = pickable.filter((item) => !sameSet.includes(item))
  return [
    option('', 'Create a new child product'),
    ...sameSet.map((item) => option(item.id, `${item.name} · ${item.product_type.name} · this set`)),
    ...others.map((item) => option(item.id, `${item.name} · ${item.product_type.name}`)),
  ]
}

export function CrackCaseDialog({ product, onClose }: CrackCaseDialogProps) {
  const api = useApi()
  const queryClient = useQueryClient()
  const words = crackWords(product.product_type.slug)
  const types = useQuery({ queryKey: ['productTypes'], queryFn: api.productTypes, enabled: Boolean(words) })
  const games = useQuery({ queryKey: ['games'], queryFn: api.games, enabled: Boolean(words) })

  const [fromBucket, setFromBucket] = useState<Bucket>(
    BUCKETS.find((bucket) => (product.stats.by_bucket[bucket] ?? 0) > 0) ?? 'inventory',
  )
  const [sourceQuantity, setSourceQuantity] = useState('1')
  const [childrenPerSource, setChildrenPerSource] = useState('')
  const [childrenTouched, setChildrenTouched] = useState(false)
  const [occurredOn, setOccurredOn] = useState(todayIso())
  const [gameId, setGameId] = useState(product.game.id)
  const initialLanguage = product.language ?? 'English'
  const [language, setLanguage] = useState(initialLanguage)
  const [customLanguage, setCustomLanguage] = useState(!LANGUAGES.includes(initialLanguage as (typeof LANGUAGES)[number]))
  const [existingChildId, setExistingChildId] = useState('')
  const [childName, setChildName] = useState('')
  const [childNameTouched, setChildNameTouched] = useState(false)
  const [childTypeId, setChildTypeId] = useState('')
  const [split, setSplit] = useState<CrackSplit>(EMPTY_CRACK_SPLIT)
  const [validation, setValidation] = useState<CrackValidation>({})
  const [createdChildName, setCreatedChildName] = useState<string | null>(null)
  const [createdChildIdState, setCreatedChildIdState] = useState<string | null>(null)
  const createdChildId = useRef<string | null>(null)

  const gameSlug = games.data?.find((game) => game.id === gameId)?.slug
    ?? (gameId === product.game.id ? product.game.slug : undefined)
  const childSlug = opensInto(product.product_type.slug)
  const producedType = bySlug(types.data, childSlug)
  const selectedType = childTypeId
    ? types.data?.find((type) => type.id === childTypeId)
    : bySlug(types.data, childSlug)
  const effectiveTypeId = childTypeId || producedType?.id || ''
  const suggested = product.product_type.slug === 'sealed-case'
    ? caseSize(gameSlug ?? product.game.slug, language)
    : product.product_type.slug === 'booster-box'
      ? boxSize(gameSlug ?? product.game.slug, language)
      : undefined

  // The size is a visible, editable suggestion. Only fill it while it is still blank so
  // changing game/language never overwrites a number somebody already corrected.
  const effectiveChildrenPerSource = childrenTouched ? childrenPerSource : (suggested ? String(suggested) : '')
  const effectiveName = childNameTouched
    ? childName
    : suggestChildName(product.name, product.set_name, selectedType)

  const candidates = useQuery({
    queryKey: ['products', 'crack-candidates', gameSlug],
    enabled: Boolean(words && gameSlug),
    queryFn: () => api.products({ game: gameSlug!, limit: 100, offset: 0 }),
  })
  const existingOptions = childOptions(candidates.data?.items ?? [], product, product.set_name)
  const available = product.stats.by_bucket[fromBucket] ?? 0
  const total = crackTotal(sourceQuantity, effectiveChildrenPerSource)
  const allocated = crackSplitTotal(split)

  const draft = useMemo<CrackDraft>(() => ({
    sourceProductId: product.id,
    sourceQuantity,
    childrenPerSource: effectiveChildrenPerSource,
    fromBucket,
    childProductId: existingChildId,
    childName: effectiveName,
    childTypeId: effectiveTypeId,
    gameId,
    language,
    split,
    occurredOn,
  }), [effectiveChildrenPerSource, effectiveName, effectiveTypeId, existingChildId, fromBucket, gameId, language, occurredOn, product.id, sourceQuantity, split])

  const run = useMutation({
    mutationFn: async (submitted: CrackDraft) => {
      let childProductId = submitted.childProductId || createdChildId.current
      if (!childProductId) {
        const created = await api.createProduct({
          name: submitted.childName.trim(),
          game_id: submitted.gameId,
          product_type_id: submitted.childTypeId,
          set_name: product.set_name ?? null,
          language: submitted.language.trim() || null,
        })
        childProductId = created.id
        createdChildId.current = childProductId
        setCreatedChildIdState(childProductId)
        setCreatedChildName(submitted.childName.trim())
        // Creating identity commits independently of the transformation. Keep lists
        // current even when the crack is rejected and the user closes the dialog.
        await queryClient.invalidateQueries()
      }
      const payload = buildCrackPayload(submitted, childProductId, product)
      if (!payload) throw new Error('Complete the crack fields before saving.')
      return api.crackCase(payload)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      onClose()
    },
  })

  function retryLookups() {
    void games.refetch()
    void types.refetch()
    void candidates.refetch()
  }

  function submit() {
    setValidation({})
    const errors = validateCrackDraft(draft, product)
    if (Object.keys(errors).length > 0) {
      setValidation(errors)
      return
    }
    run.mutate(draft)
  }

  if (!words) {
    return (
      <CrackSheet title={`Crack open — ${product.name}`} onClose={onClose} onSubmit={() => undefined} busy={false}>
        <ErrorNotice error={new Error(`A ${product.product_type.name} cannot be cracked open.`)} />
      </CrackSheet>
    )
  }

  const lookupError = games.error ?? types.error ?? candidates.error
  const lookupPending = games.isPending || types.isPending || candidates.isPending
  const createdId = createdChildIdState

  return (
    <CrackSheet
      title={`Crack open — ${product.name}`}
      onClose={onClose}
      onSubmit={submit}
      busy={run.isPending}
      error={run.error}
      validation={validation}
    >
      {lookupError ? <ErrorNotice error={lookupError} retry={retryLookups} /> : null}
      {lookupPending ? <Loading /> : null}
      <Card>
        <Copy>{product.name}</Copy>
        <Copy muted>
          {product.game.name} · {product.product_type.name} · {product.stats.by_bucket[fromBucket] ?? 0} in {BUCKET_LABELS[fromBucket]}
        </Copy>
        <Copy muted>Cost and original purchase date stay authoritative on the server and carry into the child products.</Copy>
      </Card>
      <Row>
        <Field
          label={`How many ${words.sources}`}
          value={sourceQuantity}
          onChangeText={setSourceQuantity}
          keyboardType="number-pad"
          autoFocus
        />
        <Field
          label={`${words.children[0].toUpperCase()}${words.children.slice(1)} per ${words.source}`}
          value={effectiveChildrenPerSource}
          onChangeText={(value) => {
            setChildrenTouched(true)
            setChildrenPerSource(value)
          }}
          keyboardType="number-pad"
          placeholder={suggested ? String(suggested) : 'Enter count'}
        />
      </Row>
      <Copy muted>
        {suggested
          ? `Suggested for ${gameSlug ?? product.game.slug} / ${language}: ${suggested}. Change it when this ${words.source} differs.`
          : `No confirmed size for ${gameSlug ?? product.game.slug}; enter what was in this ${words.source}.`}
      </Copy>
      <Choice
        label="Game for the child"
        value={gameId}
        options={[
          ...((games.data ?? []).map((game) => option(game.id, game.name))),
          ...(games.data?.some((game) => game.id === product.game.id) ? [] : [option(product.game.id, product.game.name)]),
        ]}
        onChange={setGameId}
      />
      <Choice
        label="Language"
        value={customLanguage ? '__custom__' : language}
        options={[
          ...LANGUAGES.map((value) => option(value, value)),
          ...(initialLanguage && !LANGUAGES.includes(initialLanguage as (typeof LANGUAGES)[number]) ? [option(initialLanguage, initialLanguage)] : []),
          option('__custom__', 'Other'),
        ]}
        onChange={(value) => {
          if (value === '__custom__') {
            setCustomLanguage(true)
          } else {
            setCustomLanguage(false)
            setLanguage(value)
          }
        }}
      />
      {customLanguage ? <Field label="Language name" value={language} onChangeText={setLanguage} placeholder="English, Japanese, Korean…" /> : null}
      {createdId ? (
        <Card>
          <Copy>New child created: {createdChildName ?? createdId}</Copy>
          <Copy muted>The crack did not finish. Retrying will reuse this child and will not create a duplicate.</Copy>
        </Card>
      ) : (
        <>
          <Choice label="What came out" value={existingChildId} options={existingOptions} onChange={setExistingChildId} />
          {!existingChildId ? (
            <>
              <Field label="Child name" value={effectiveName} onChangeText={(value) => { setChildNameTouched(true); setChildName(value) }} />
              <Choice
                label="Child product type"
                value={effectiveTypeId}
                options={(types.data ?? []).map((type) => option(type.id, type.name))}
                onChange={setChildTypeId}
              />
              <Copy muted>Creating a child here only creates its identity. The crack supplies stock; no initial purchase is written.</Copy>
            </>
          ) : null}
        </>
      )}
      <Choice
        label="Opened out of"
        value={fromBucket}
        options={BUCKETS.map((bucket) => option(bucket, bucketCountLabel(bucket, product.stats.by_bucket[bucket] ?? 0)))}
        onChange={(value) => setFromBucket(value as Bucket)}
      />
      {crackInteger(sourceQuantity, true) !== null && crackInteger(sourceQuantity, true)! > available ? (
        <Copy muted>{BUCKET_LABELS[fromBucket]} only holds {available}.</Copy>
      ) : null}
      <Card>
        <Copy>
          Where the {words.children} go{total !== null ? ` · ${total} total` : ''}
        </Copy>
        {BUCKETS.map((bucket) => (
          <Field
            key={bucket}
            label={BUCKET_LABELS[bucket]}
            value={split[bucket]}
            onChangeText={(value) => setSplit((current) => ({ ...current, [bucket]: value }))}
            keyboardType="number-pad"
            placeholder="0"
          />
        ))}
        <Copy muted>
          {allocated === null
            ? 'Use whole numbers of zero or more.'
            : allocated === 0
              ? `Leave these blank and all ${total ?? 0} go to ${BUCKET_LABELS[fromBucket]}.`
              : `${allocated} of ${total ?? 0} allocated.`}
        </Copy>
      </Card>
      <Copy muted>
        The server will carry the source cost and original purchase date into these {words.children}; this screen never recalculates either value.
      </Copy>
      <Field
        label="Date opened"
        value={occurredOn}
        onChangeText={setOccurredOn}
        keyboardType="numbers-and-punctuation"
        placeholder="YYYY-MM-DD"
      />
    </CrackSheet>
  )
}

export default CrackCaseDialog
