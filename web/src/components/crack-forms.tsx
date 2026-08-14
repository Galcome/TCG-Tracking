/**
 * Opening sealed product into what is inside it.
 *
 * Two jobs, one screen: a **case** becomes boxes, a **box** becomes packs. Every noun and
 * every default on it is derived from the source, because for a while they were not - it
 * asked "How many cases" and offered "Boxes per case: 6" while turning a box into packs.
 * Six is the boxes in a case; a Pokemon box holds thirty-six packs, so the suggestion was
 * both the wrong word and six times too small, on the screen whose entire job is splitting
 * cost correctly.
 *
 * The shape of this screen follows one rule from the brief: a default that is **shown and
 * editable**, never silently applied. Case size is suggested from the game and the
 * language, the split across buckets is pre-filled with everything going to Inventory, and
 * every number on screen can be changed before anything is written.
 *
 * The boxes may not exist as a product yet, so the form can create one - pre-filled from
 * the case's own name, game and set. Being unable to record what you just opened because
 * somebody has not set up a product first is exactly the friction that stops people using
 * the app at all.
 */

import { useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  BUCKET_LABELS,
  BUCKETS,
  api,
  boxSize,
  caseSize,
  type Bucket,
  type Product,
  type ProductDetail,
  type Taxonomy,
} from '../api'
import { money, todayIso } from '../format'
import { bySlug, opensInto, suggestedProductName } from '../product-types'
import { useLedgerMutation } from './forms'
import { Advanced, Dialog, Field, FIELD_CLASS } from './ui'

/**
 * The name of whatever comes out.
 *
 * Prefers the set plus the type actually being produced, so the name agrees with the type
 * rather than contradicting it: a case of "Mega Evolution: Pitch Black Night" yields
 * "Mega Evolution: Pitch Black Night Booster Box", not "… Night Box".
 *
 * Falls back to swapping the source's own noun out of its name, which is all there is to
 * go on for a product carrying no set. The noun comes from the produced type, so opening a
 * box gives "… Booster Pack" rather than the "Box" this used to hardcode.
 */
function suggestBoxName(
  sourceName: string,
  setLabel: string | null,
  type: Taxonomy | undefined,
): string {
  const fromSet = suggestedProductName(setLabel ?? '', type)
  if (fromSet) return fromSet

  const child = type?.name ?? 'Box'
  const swapped = sourceName.replace(/\b(cases?|boxes|box)\b/i, child)
  return swapped === sourceName ? `${sourceName} ${child}` : swapped
}

export function CrackCaseDialog({
  product,
  onClose,
}: {
  product: ProductDetail
  onClose: () => void
}) {
  const types = useQuery({ queryKey: ['productTypes'], queryFn: api.productTypes })
  const navigate = useNavigate()

  // The dialog serves two jobs - a case into boxes, a box into packs - so every word and
  // every default has to come from what is actually being opened. It used to say "How many
  // cases" and "Boxes per case: 6" while turning a box into packs, which is both the wrong
  // noun and a number six times too small: a Pokemon case holds 6 boxes, a box holds 36
  // packs.
  const openingACase = product.product_type.slug === 'sealed-case'
  const words = openingACase
    ? { source: 'case', sources: 'cases', child: 'box', children: 'boxes' }
    : { source: 'box', sources: 'boxes', child: 'pack', children: 'packs' }

  const suggested = openingACase
    ? caseSize(product.game.slug, product.language)
    : boxSize(product.game.slug, product.language)
  const held = product.stats.by_bucket

  const [fromBucket, setFromBucket] = useState<Bucket>(
    BUCKETS.find((bucket) => (held[bucket] ?? 0) > 0) ?? 'inventory',
  )
  const [cases, setCases] = useState('1')
  const [boxes, setBoxes] = useState(String(suggested ?? ''))
  const [occurredOn, setDate] = useState(todayIso())

  // What a case yields is boxes, and what a box yields is packs. Looked up by slug: this
  // used to fall through to `types.data[0]`, which is `Single` purely because it sorts
  // first, so every box a crack produced was filed as a single and quietly wrecked the
  // tier report - the one place product type is load-bearing.
  const producedType = bySlug(types.data, opensInto(product.product_type.slug))

  // Which existing product the boxes are, or blank to make a new one.
  const [existingId, setExistingId] = useState('')
  const [newName, setNewName] = useState('')
  const [newTypeId, setNewType] = useState('')

  const effectiveTypeId = newTypeId || producedType?.id || types.data?.[0]?.id || ''
  const effectiveName = newName || suggestBoxName(product.name, product.set_name, producedType)

  // How the boxes are shared out. Everything to Inventory until somebody says otherwise.
  const [split, setSplit] = useState<Record<Bucket, string>>({
    inventory: '',
    store: '',
    vault: '',
  })

  const [error, setError] = useState<string | null>(null)

  const candidates = useQuery({
    queryKey: ['products', 'crack-candidates', product.game.slug],
    queryFn: () => api.products({ game: product.game.slug, stock: '' }),
  })

  // Same set first. Default stays "Create a new product" - correct the first time a set
  // is cracked, and it never picks a product on somebody's behalf.
  const pickable = (candidates.data?.items ?? []).filter(
    (item: Product) => item.id !== product.id,
  )
  const setKey = (product.set_name ?? '').trim().toLowerCase()
  const sameSet = setKey
    ? pickable.filter((item: Product) => (item.set_name ?? '').trim().toLowerCase() === setKey)
    : []
  const others = pickable.filter((item: Product) => !sameSet.includes(item))

  const total = Number(cases || 0) * Number(boxes || 0)
  const allocated = BUCKETS.reduce((sum, bucket) => sum + Number(split[bucket] || 0), 0)
  // Nothing typed means "all of them to the source's bucket" rather than an error.
  const untouched = allocated === 0
  const available = held[fromBucket] ?? 0

  // Cracking leaves the source at zero, so staying here means staring at a page for
  // something you no longer have and wondering whether it worked. Everything that proves
  // it did is below the fold. Land on what came out instead: it is where the value went
  // and where the next action is - moving it to the Store or the Vault.
  //
    // A ref, not state: the success callback is created during this render, so a state
    // value set moments before `mutate` would still read as null inside it. A ref is read
    // when the callback actually runs.
  const madeId = useRef<string | null>(null)

  const run = useLedgerMutation(
    async (input: {
      productId: string
      outputs: { product_id: string; quantity: number; bucket: Bucket }[]
    }) =>
      api.crackCase({
        product_id: product.id,
        quantity: Number(cases),
        from_bucket: fromBucket,
        outputs: input.outputs,
        occurred_on: occurredOn,
      }),
    () => {
      onClose()
      if (madeId.current) navigate(`/products/${madeId.current}`)
    },
  )

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    if (total <= 0) {
      setError(`Say how many ${words.children} came out.`)
      return
    }
    if (!untouched && allocated !== total) {
      setError(`The split adds up to ${allocated}, but ${total} ${words.children} came out.`)
      return
    }

    let productId = existingId
    if (!productId) {
      if (!effectiveName.trim()) {
        setError(`The ${words.children} need a name.`)
        return
      }
      // Created here rather than made a prerequisite. Being unable to record what you
      // just opened because a product does not exist yet is how an app stops being used.
      const created = await api.createProduct({
        name: effectiveName.trim(),
        game_id: product.game.id,
        product_type_id: effectiveTypeId,
        set_name: product.set_name ?? null,
      })
      productId = created.id
    }

    const outputs = untouched
      ? [{ product_id: productId, quantity: total, bucket: fromBucket }]
      : BUCKETS.filter((bucket) => Number(split[bucket] || 0) > 0).map((bucket) => ({
          product_id: productId,
          quantity: Number(split[bucket]),
          bucket,
        }))

    madeId.current = productId
    run.mutate({ productId, outputs })
  }

  return (
    <Dialog
      title={`Crack open — ${product.name}`}
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Crack it open"
      busy={run.isPending}
      error={error ?? (run.error ? (run.error as Error).message : null)}
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label={`How many ${words.sources}`}>
          <input
            required
            type="number"
            min={1}
            inputMode="numeric"
            value={cases}
            onChange={(e) => setCases(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
        <Field
          label={`${words.children[0].toUpperCase()}${words.children.slice(1)} per ${words.source}`}
          hint={
            suggested
              ? `Usually ${suggested} for ${product.game.name}. Change it if this one differs.`
              : 'No confirmed size for this game — type what was in it.'
          }
        >
          <input
            required
            type="number"
            min={1}
            inputMode="numeric"
            value={boxes}
            onChange={(e) => setBoxes(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
      </div>

      <div>
        <span className="text-sm font-medium text-(--color-muted)">Opened out of</span>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {BUCKETS.map((bucket) => (
            <button
              key={bucket}
              type="button"
              onClick={() => setFromBucket(bucket)}
              className={`rounded-full border px-3 py-1.5 text-[0.8125rem] transition-colors ${
                fromBucket === bucket
                  ? 'border-(--color-accent) bg-(--color-accent)/12 font-medium text-(--color-accent)'
                  : 'border-(--color-edge) text-(--color-muted) hover:text-(--color-text)'
              }`}
            >
              {BUCKET_LABELS[bucket]} ({held[bucket] ?? 0})
            </button>
          ))}
        </div>
        {Number(cases || 0) > available && (
          <span className="mt-1 block text-xs text-(--color-loss)">
            {BUCKET_LABELS[fromBucket]} only holds {available}.
          </span>
        )}
      </div>

      <Field
        label="What came out"
        hint="Pick the box if it already exists, or leave it blank and one gets created."
      >
        <select
          aria-label="What came out"
          value={existingId}
          onChange={(e) => setExistingId(e.target.value)}
          className={FIELD_CLASS}
        >
          <option value="">Create a new product</option>
          {/* The set you are cracking leads. Everything else stays reachable rather than
              filtered away - a mis-set product would otherwise become unpickable, which is
              how people end up creating a second copy of something they already own. */}
          {sameSet.length > 0 && (
            <optgroup label="From this set">
              {sameSet.map((item: Product) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </optgroup>
          )}
          {others.length > 0 && (
            <optgroup label={sameSet.length > 0 ? 'Everything else' : 'Your products'}>
              {others.map((item: Product) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </Field>

      {!existingId && (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name">
            <input
              value={effectiveName}
              onChange={(e) => setNewName(e.target.value)}
              className={FIELD_CLASS}
            />
          </Field>
          <Field label="Type">
            <select
              aria-label="Type"
              value={effectiveTypeId}
              onChange={(e) => setNewType(e.target.value)}
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
      )}

      <div>
        <span className="text-sm font-medium text-(--color-muted)">
          Where they go{total > 0 ? ` — ${total} ${words.children}` : ''}
        </span>
        <div className="mt-1.5 grid grid-cols-3 gap-3">
          {BUCKETS.map((bucket) => (
            <Field key={bucket} label={BUCKET_LABELS[bucket]}>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="0"
                value={split[bucket]}
                onChange={(e) => setSplit({ ...split, [bucket]: e.target.value })}
                className={FIELD_CLASS}
              />
            </Field>
          ))}
        </div>
        <span className="mt-1 block text-xs text-(--color-faint)">
          {untouched
            ? `Leave these blank and all ${total || 0} go to ${BUCKET_LABELS[fromBucket]}.`
            : `${allocated} of ${total} allocated.`}
        </span>
      </div>

      {/* The two facts that make cracking safe to do, said before the button rather than
          discovered in a report afterwards. */}
      <p className="rounded-lg border border-(--color-edge) bg-(--color-ink)/50 px-3 py-2 text-xs text-(--color-muted)">
        The {words.children} keep the {words.source}&rsquo;s purchase date
        {product.stats.average_unit_cost
          ? ` and split its ${money(product.stats.average_unit_cost)} between them`
          : ''}
        , so nothing resets the clock on how long the money has been asleep.
      </p>

      <Advanced>
        <Field label="Date opened" hint="Recorded separately from the purchase date above.">
          <input
            required
            type="date"
            value={occurredOn}
            onChange={(e) => setDate(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
      </Advanced>
    </Dialog>
  )
}

/** Undoing a crack. The case comes back, the boxes go away, the row stays as the reason. */
export function VoidTransformationDialog({
  id,
  onClose,
}: {
  id: string
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const run = useLedgerMutation(
    (input: string) => api.voidTransformation(id, input),
    onClose,
  )

  return (
    <Dialog
      title="Undo this"
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault()
        run.mutate(reason.trim())
      }}
      submitLabel="Undo it"
      busy={run.isPending}
      error={run.error ? (run.error as Error).message : null}
    >
      <p className="text-sm text-(--color-muted)">
        The case comes back into stock and the boxes go away. The row stays on the record as
        the explanation.
      </p>
      <Field label="Reason">
        <input
          required
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Wrong case"
          className={FIELD_CLASS}
        />
      </Field>
    </Dialog>
  )
}
