/**
 * Ripping a box open, and logging the hits.
 *
 * The shape follows the one thing that makes per-card ROI mean anything: cost is shared
 * **in proportion to what the hits are worth**, not evenly. Three hits at $500, $50 and $10
 * out of a $150 box come to $134, $13 and $3, so the big hit carries the risk it earned.
 * The split is shown live as values are typed, and every row can be overridden.
 *
 * Whatever the hits do not take is bulk, and bulk is written off here rather than carried
 * as an asset. The group said it outright: nobody would ever rip something in order to sell
 * the bulk. Showing the write-off as it grows is the point - a bad rip should look bad
 * while you are recording it, not in a report three weeks later.
 */

import { useQuery } from '@tanstack/react-query'
import { Camera, Plus, X } from 'lucide-react'
import { useState } from 'react'

import {
  BUCKET_LABELS,
  BUCKETS,
  api,
  type Bucket,
  type ProductCandidate,
  type ProductDetail,
} from '../api'
import { money, todayIso } from '../format'
import { MONEY_INPUT, useLedgerMutation } from './forms'
import { Advanced, Dialog, Field, FIELD_CLASS } from './ui'

interface HitRow {
  key: number
  /** Blank means "make a new product for this one". */
  productId: string
  name: string
  setName: string
  collectorNumber: string
  variant: string
  language: string
  choice: 'undecided' | 'create' | 'reuse'
  selectedProductName: string
  value: string
  bucket: Bucket
}

let nextKey = 1

function emptyRow(): HitRow {
  return {
    key: nextKey++,
    productId: '',
    name: '',
    setName: '',
    collectorNumber: '',
    variant: '',
    language: '',
    choice: 'undecided',
    selectedProductName: '',
    value: '',
    bucket: 'inventory',
  }
}

type IdentityField = 'name' | 'setName' | 'collectorNumber' | 'variant' | 'language'

function identityKey(row: HitRow): string {
  return [row.name, row.setName, row.collectorNumber, row.variant, row.language]
    .map((value) => value.trim())
    .join('\u001f')
}

function candidateIdentity(row: HitRow, gameId: string) {
  return {
    game_id: gameId,
    name: row.name.trim(),
    ...(row.setName.trim() ? { set_name: row.setName.trim() } : {}),
    ...(row.collectorNumber.trim() ? { collector_number: row.collectorNumber.trim() } : {}),
    ...(row.variant.trim() ? { variant: row.variant.trim() } : {}),
    ...(row.language.trim() ? { language: row.language.trim() } : {}),
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

function HitIdentityChooser({
  row,
  index,
  gameId,
  onFieldChange,
  onValueChange,
  onRemove,
  canRemove,
  onChoice,
}: {
  row: HitRow
  index: number
  gameId: string
  onFieldChange: (field: IdentityField, value: string) => void
  onValueChange: (value: string) => void
  onRemove: () => void
  canRemove: boolean
  onChoice: (choice: 'create' | 'reuse', candidate?: ProductCandidate) => void
}) {
  const key = identityKey(row)
  const [searchedKey, setSearchedKey] = useState('')
  const candidates = useQuery({
    queryKey: ['productCandidates', gameId, key],
    queryFn: () => api.productCandidates(candidateIdentity(row, gameId)),
    enabled: row.name.trim().length > 0 && searchedKey === key,
  })

  const fields: [IdentityField, string][] = [
    ['setName', 'Set'],
    ['collectorNumber', 'Collector number'],
    ['variant', 'Variant'],
    ['language', 'Language'],
  ]

  return (
    <>
      <div className="grid grid-cols-[1fr_7rem_auto] gap-2">
        <input
          value={row.name}
          onChange={(event) => onFieldChange('name', event.target.value)}
          placeholder="Card name"
          aria-label={`Hit ${index + 1} name`}
          className={`${FIELD_CLASS} mt-0`}
        />
        <input
          {...MONEY_INPUT}
          value={row.value}
          onChange={(event) => onValueChange(event.target.value)}
          aria-label={`Hit ${index + 1} value`}
          className={`${FIELD_CLASS} mt-0`}
        />
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove hit ${index + 1}`}
          disabled={!canRemove}
          className="rounded-md border border-(--color-edge) px-2 text-(--color-faint) transition-colors hover:border-(--color-loss)/50 hover:text-(--color-loss) disabled:opacity-30"
        >
          <X size={14} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {fields.map(([field, label]) => (
          <input
            key={field}
            value={row[field]}
            onChange={(event) => onFieldChange(field, event.target.value)}
            placeholder={label}
            aria-label={`Hit ${index + 1} ${label.toLowerCase()}`}
            className={`${FIELD_CLASS} mt-0 text-xs`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setSearchedKey(key)}
          disabled={!row.name.trim() || candidates.isFetching}
          className="rounded-md border border-(--color-edge) px-2.5 py-1.5 text-(--color-muted) hover:border-(--color-edge-strong) hover:text-(--color-text) disabled:opacity-40"
        >
          {candidates.isFetching ? 'Searching…' : 'Find existing product'}
        </button>
        <button
          type="button"
          onClick={() => onChoice('create')}
          className={`rounded-md border px-2.5 py-1.5 transition-colors ${
            row.choice === 'create'
              ? 'border-(--color-accent) bg-(--color-accent)/12 text-(--color-accent)'
              : 'border-(--color-edge) text-(--color-muted) hover:border-(--color-edge-strong) hover:text-(--color-text)'
          }`}
        >
          Create new product
        </button>
        {row.choice === 'reuse' && (
          <span className="text-(--color-accent)">
            Reusing {row.selectedProductName || 'selected product'}
          </span>
        )}
        {row.choice === 'create' && (
          <span className="text-(--color-muted)">A new product will be created</span>
        )}
        {row.choice === 'undecided' && (
          <span className="text-(--color-loss)">Choose reuse or create before saving</span>
        )}
      </div>
      {searchedKey === key && candidates.isError && (
        <p className="mt-1 text-xs text-(--color-loss)">
          Could not search existing products. You can still choose Create new product.
        </p>
      )}
      {searchedKey === key && candidates.data && candidates.data.length === 0 && (
        <p className="mt-1 text-xs text-(--color-faint)">
          No strong match found. Choose Create new product if this is a new item.
        </p>
      )}
      {searchedKey === key && candidates.data && candidates.data.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-lg border border-(--color-edge) bg-(--color-ink)/40 p-2">
          {candidates.data.map((candidate) => (
            <li key={candidate.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 text-xs text-(--color-muted)">
                <span className="font-medium text-(--color-text)">{candidate.name}</span>
                {candidateIdentitySummary(candidate) && (
                  <span className="ml-1 text-(--color-faint)">
                    · {candidateIdentitySummary(candidate)}
                  </span>
                )}
                <span className="ml-1 text-(--color-faint)">
                  · {candidate.quantity_on_hand} in stock
                </span>
              </span>
              <button
                type="button"
                onClick={() => onChoice('reuse', candidate)}
                className="rounded-md border border-(--color-accent)/50 px-2 py-1 text-xs text-(--color-accent) hover:bg-(--color-accent)/10"
              >
                Reuse this product
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/**
 * What each hit's share works out at, live.
 *
 * Mirrors the server's largest-remainder split closely enough to be honest about the
 * shape - the server recomputes it and its answer is the one that gets written. Showing an
 * approximation here beats showing nothing while somebody decides what to type.
 */
function shares(values: number[], total: number): number[] {
  const pool = values.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return values.map(() => 0)
  if (pool <= 0) return values.map(() => total / values.length)
  return values.map((value) => (total * value) / pool)
}

export function RipDialog({
  product,
  onClose,
}: {
  product: ProductDetail
  onClose: () => void
}) {
  const types = useQuery({ queryKey: ['productTypes'], queryFn: api.productTypes })

  const held = product.stats.by_bucket
  const [fromBucket, setFromBucket] = useState<Bucket>(
    BUCKETS.find((bucket) => (held[bucket] ?? 0) > 0) ?? 'inventory',
  )
  const [boxes, setBoxes] = useState('1')
  const [occurredOn, setDate] = useState(todayIso())
  const [rows, setRows] = useState<HitRow[]>([emptyRow()])
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)

  // Hidden when no key is configured, rather than offered and always failing.
  const vision = useQuery({ queryKey: ['visionStatus'], queryFn: api.visionStatus })

  const unitCost = Number(product.stats.average_unit_cost ?? 0)
  const boxCost = unitCost * Number(boxes || 0)

  const filled = rows.filter((row) => row.name.trim() || row.productId)
  const split = shares(
    filled.map((row) => Number(row.value || 0)),
    boxCost,
  )

  const run = useLedgerMutation(
    (hits: { product_id: string; quantity: number; bucket: Bucket; value: string }[]) =>
      api.ripOpen({
        product_id: product.id,
        quantity: Number(boxes),
        from_bucket: fromBucket,
        hits,
        occurred_on: occurredOn,
      }),
    onClose,
  )

  function updateIdentity(key: number, field: IdentityField, value: string) {
    setRows((current) =>
      current.map((row) =>
        row.key === key
          ? {
              ...row,
              [field]: value,
              // A changed identity invalidates a previous reuse decision. Keeping the old
              // product id here would silently send the newly typed card to the old item.
              productId: '',
              choice: 'undecided',
              selectedProductName: '',
            }
          : row,
      ),
    )
  }

  function updateChoice(key: number, choice: 'create' | 'reuse', candidate?: ProductCandidate) {
    setRows((current) =>
      current.map((row) =>
        row.key === key
          ? {
              ...row,
              choice,
              productId: candidate?.id ?? '',
              selectedProductName: candidate?.name ?? '',
            }
          : row,
      ),
    )
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    const undecided = filled.find((row) => row.choice === 'undecided')
    if (undecided) {
      setError('Choose Reuse or Create new product for every hit before saving.')
      return
    }

    const hits = []
    for (const row of filled) {
      let productId = row.productId
      if (row.choice === 'create') {
        // Created inline. Being unable to log the card you are holding because nobody set
        // up a product for it first is exactly how this screen would go unused.
        const created = await api.createProduct({
          name: row.name.trim(),
          game_id: product.game.id,
          product_type_id: types.data?.find((t) => t.slug === 'single')?.id
            ?? types.data?.[0]?.id
            ?? '',
          // Vision suggestions stay attached to the hit. Fall back to the box's set only
          // when the row did not supply one, which preserves the convenient manual path.
          set_name: row.setName.trim() || product.set_name || null,
          collector_number: row.collectorNumber.trim() || null,
          variant: row.variant.trim() || null,
          language: row.language.trim() || product.language || null,
        })
        productId = created.id
      } else if (!productId) {
        setError('Choose an existing product or Create new product for every hit.')
        return
      }
      hits.push({
        product_id: productId,
        quantity: 1,
        bucket: row.bucket,
        value: row.value || '0',
      })
    }

    run.mutate(hits)
  }

  const assigned = split.reduce((sum, share) => sum + share, 0)
  const bulk = Math.max(boxCost - assigned, 0)

  return (
    <Dialog
      title={`Rip open — ${product.name}`}
      onClose={onClose}
      onSubmit={submit}
      submitLabel={filled.length === 0 ? 'Rip it, nothing worth keeping' : 'Log the hits'}
      busy={run.isPending}
      error={error ?? (run.error ? (run.error as Error).message : null)}
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="How many">
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
        <Field label="Date">
          <input
            required
            type="date"
            value={occurredOn}
            onChange={(e) => setDate(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
      </div>

      <div>
        <span className="text-sm font-medium text-(--color-muted)">Ripped out of</span>
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
      </div>

      <div>
        <span className="text-sm font-medium text-(--color-muted)">
          What were the hits?
        </span>
        <p className="mt-1 text-xs text-(--color-faint)">
          Only the cards worth tracking. Everything else is bulk, and bulk is written off
          here rather than carried as stock.
        </p>

        <ul className="mt-2 space-y-2">
          {rows.map((row, index) => {
            const position = filled.indexOf(row)
            return (
              <li key={row.key} className="space-y-1">
                <HitIdentityChooser
                  row={row}
                  index={index}
                  gameId={product.game.id}
                  onFieldChange={(field, value) => updateIdentity(row.key, field, value)}
                  onValueChange={(value) =>
                    setRows((current) =>
                      current.map((other) =>
                        other.key === row.key ? { ...other, value } : other,
                      ),
                    )
                  }
                  onRemove={() => setRows((current) => current.filter((other) => other.key !== row.key))}
                  canRemove={rows.length > 1}
                  onChoice={(choice, candidate) => updateChoice(row.key, choice, candidate)}
                />
                {position >= 0 && boxCost > 0 && (
                  <span className="block text-xs text-(--color-faint)">
                    takes {money(split[position].toFixed(2))} of the box
                  </span>
                )}
              </li>
            )
          })}
        </ul>

        <button
          type="button"
          onClick={() => setRows([...rows, emptyRow()])}
          className="mt-2 inline-flex items-center gap-1.5 text-xs text-(--color-accent) hover:underline"
        >
          <Plus size={13} />
          Add another
        </button>
      </div>

      {/* Eyes, not judgement. The photo fills in identity fields; a person still presses
          save, and nothing here is ever asked what a card is worth. Hidden entirely when
          no key is configured, rather than offered and always failing. */}
      {vision.data?.available && (
        <div>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-(--color-accent) hover:underline">
            <Camera size={13} />
            {reading ? 'Reading the photo…' : 'Photograph them instead'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              disabled={reading}
              onChange={async (event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return

                setPhotoError(null)
                setReading(true)
                try {
                  const found = await api.readCards(file)
                  // Batches append. Accuracy falls off on twenty overlapping cards, so
                  // several relaxed photos beat one crowded one and the flow should
                  // encourage that rather than fight it.
                  if (found.cards.length > 0) {
                    setRows((current) => [
                      ...current.filter((row) => row.name.trim() || row.productId),
                      ...found.cards.map((card) => ({
                        ...emptyRow(),
                        name: card.name,
                        setName: card.set_name,
                        collectorNumber: card.collector_number,
                        variant: card.variant,
                        language: card.language,
                        value: '',
                        bucket: current[0]?.bucket ?? ('inventory' as Bucket),
                      })),
                      emptyRow(),
                    ])
                  } else {
                    setPhotoError('Nothing readable in that one. Try a less crowded shot.')
                  }
                } catch (error) {
                  // Degrades to typing, always. The field below still works.
                  setPhotoError((error as Error).message)
                } finally {
                  setReading(false)
                }
              }}
            />
          </label>
          <p className="mt-1 text-xs text-(--color-faint)">
            Identity suggestions only &mdash; check the set, number, variant and language
            yourself before saving. Unsure fields stay blank.
          </p>
          {photoError && (
            <p className="mt-1 text-xs text-(--color-loss)">{photoError}</p>
          )}
        </div>
      )}

      {/* The write-off, growing as you type. A bad rip should look bad while you are
          recording it, not in a report three weeks later. */}
      {boxCost > 0 && (
        <p className="rounded-lg border border-(--color-edge) bg-(--color-ink)/50 px-3 py-2 text-xs text-(--color-muted)">
          {money(boxCost.toFixed(2))} of box.{' '}
          {filled.length === 0
            ? 'All of it written off as bulk.'
            : `${money(bulk.toFixed(2))} left over, written off as bulk.`}
          <span className="mt-1 block text-(--color-faint)">
            What you type is an estimate on the day. It shares out the cost and is kept as a
            dated value — it never becomes profit.
          </span>
        </p>
      )}

      <Advanced>
        <Field label="Where the hits go">
          <select
            aria-label="Where the hits go"
            value={rows[0]?.bucket ?? 'inventory'}
            onChange={(e) =>
              setRows(rows.map((row) => ({ ...row, bucket: e.target.value as Bucket })))
            }
            className={FIELD_CLASS}
          >
            {BUCKETS.map((bucket) => (
              <option key={bucket} value={bucket}>
                {BUCKET_LABELS[bucket]}
              </option>
            ))}
          </select>
        </Field>
      </Advanced>
    </Dialog>
  )
}
