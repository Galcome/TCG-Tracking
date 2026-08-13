/**
 * Sending cards to a grader, and taking them back.
 *
 * The send does not move anything: the card keeps its bucket and gains a flag with the date
 * it went. The flag is **interactive** - tapping it is how the return gets recorded - and it
 * carries a day count, which is the condition the flag was accepted on. A card quietly
 * sitting at PSA for four months should be visible without anybody going looking.
 *
 * On the way back the graded card's name is pre-filled from the raw one plus the grader and
 * the grade: "Mickey Mouse Iconic" becomes "Mickey Mouse Iconic — PSA 10". Same rule as
 * everywhere else - a sensible default, always shown, never silently applied.
 */

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { BUCKET_LABELS, BUCKETS, api, type Bucket, type ProductDetail } from '../api'
import { todayIso } from '../format'
import { MONEY_INPUT, useLedgerMutation } from './forms'
import { Advanced, Dialog, Field, FIELD_CLASS } from './ui'

/** The graders worth one tap. Free text covers everyone else. */
const GRADERS = ['PSA', 'BGS', 'CGC', 'SGC'] as const

export function SendToGradingDialog({
  product,
  onClose,
}: {
  product: ProductDetail
  onClose: () => void
}) {
  const held = product.stats.by_bucket
  const [bucket, setBucket] = useState<Bucket>(
    BUCKETS.find((option) => (held[option] ?? 0) > 0) ?? 'inventory',
  )
  const [quantity, setQuantity] = useState('1')
  const [company, setCompany] = useState<string>('PSA')
  const [sentOn, setSentOn] = useState(todayIso())
  const [fees, setFees] = useState('')
  const [notes, setNotes] = useState('')
  const [rawValue, setRawValue] = useState('')

  // Only knowable *now*. Once the card is at PSA the raw comp is gone, and no later screen
  // can recover it - so a card graded without this can never be measured retrospectively.
  // Optional and never suggested: the app does not invent values.
  const run = useLedgerMutation(async (input: Parameters<typeof api.sendToGrading>[0]) => {
    const submission = await api.sendToGrading(input)
    if (rawValue.trim()) {
      await api.recordValuation({
        product_id: product.id,
        value: rawValue,
        captured_on: sentOn,
        notes: 'Raw, before grading',
      })
    }
    return submission
  }, onClose)

  return (
    <Dialog
      title={`Send to grading — ${product.name}`}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault()
        run.mutate({
          product_id: product.id,
          quantity: Number(quantity),
          bucket,
          grading_company: company || null,
          sent_on: sentOn,
          fees: fees || undefined,
          notes: notes.trim() || null,
        })
      }}
      submitLabel="Send it"
      busy={run.isPending}
      error={run.error ? (run.error as Error).message : null}
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="How many">
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
        <Field
          label="Fees"
          hint="Grading, postage and insurance. Raises what the graded card cost."
        >
          <input
            {...MONEY_INPUT}
            value={fees}
            onChange={(e) => setFees(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
      </div>

      <div>
        <span className="text-sm font-medium text-(--color-muted)">Grader</span>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {GRADERS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setCompany(option)}
              className={`rounded-full border px-3 py-1.5 text-[0.8125rem] transition-colors ${
                company === option
                  ? 'border-(--color-accent) bg-(--color-accent)/12 font-medium text-(--color-accent)'
                  : 'border-(--color-edge) text-(--color-muted) hover:text-(--color-text)'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
        <input
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          aria-label="Grader name"
          placeholder="Somewhere else"
          className={`${FIELD_CLASS} mt-2`}
        />
      </div>

      <Field label="Sent on">
        <input
          required
          type="date"
          value={sentOn}
          onChange={(e) => setSentOn(e.target.value)}
          className={FIELD_CLASS}
        />
      </Field>

      {/* The other half of "was grading worth it?". Cost basis cannot answer it: for a card
          pulled from a box, cost is a share of that box and says nothing about what the
          card was worth raw. */}
      <Field
        label="What is it worth raw?"
        hint="Optional, and only answerable today — once it is at the grader this is gone."
      >
        <input
          {...MONEY_INPUT}
          value={rawValue}
          onChange={(e) => setRawValue(e.target.value)}
          className={FIELD_CLASS}
        />
      </Field>

      {/* Said plainly, because "it left the house but it is still in Inventory" is the
          sort of thing that reads as a bug when nobody explains it. */}
      <p className="rounded-lg border border-(--color-edge) bg-(--color-ink)/50 px-3 py-2 text-xs text-(--color-muted)">
        It stays in {BUCKET_LABELS[bucket]} while it is away — it is still your stock and
        still your money. You will see how many days it has been out until it comes back.
      </p>

      <Advanced>
        <div>
          <span className="text-sm font-medium text-(--color-muted)">Sent out of</span>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {BUCKETS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setBucket(option)}
                className={`rounded-full border px-3 py-1.5 text-[0.8125rem] transition-colors ${
                  bucket === option
                    ? 'border-(--color-accent) bg-(--color-accent)/12 font-medium text-(--color-accent)'
                    : 'border-(--color-edge) text-(--color-muted) hover:text-(--color-text)'
                }`}
              >
                {BUCKET_LABELS[option]} ({held[option] ?? 0})
              </button>
            ))}
          </div>
        </div>
        <Field label="Note">
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
      </Advanced>
    </Dialog>
  )
}

/** "Mickey Mouse Iconic" + PSA + 10 -> "Mickey Mouse Iconic — PSA 10". */
export function gradedName(raw: string, company: string | null, grade: string): string {
  const suffix = [company, grade].filter(Boolean).join(' ')
  return suffix ? `${raw} — ${suffix}` : raw
}

export function ReturnFromGradingDialog({
  product,
  submissionId,
  gradingCompany,
  onClose,
}: {
  product: ProductDetail
  submissionId: string
  gradingCompany: string | null
  onClose: () => void
}) {
  const types = useQuery({ queryKey: ['productTypes'], queryFn: api.productTypes })

  const [grade, setGrade] = useState('')
  const [name, setName] = useState('')
  const [returnedOn, setReturnedOn] = useState(todayIso())
  const [extraFees, setExtraFees] = useState('')
  const [notes, setNotes] = useState('')
  const [gradedValue, setGradedValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Pre-filled and editable, rebuilt as the grade is typed until somebody overrides it.
  const suggested = gradedName(product.name, gradingCompany, grade)
  const finalName = name || suggested

  const run = useLedgerMutation(
    async (gradedProductId: string) => {
      const returned = await api.returnFromGrading(submissionId, {
        graded_product_id: gradedProductId,
        grade: grade.trim() || null,
        returned_on: returnedOn,
        extra_fees: extraFees || undefined,
        notes: notes.trim() || null,
      })

      // Recorded last, and never allowed to undo the return. The transformation is the
      // fact; the estimate is a note about it, and losing a note must not lose a fact.
      if (gradedValue.trim()) {
        try {
          await api.recordValuation({
            product_id: gradedProductId,
            value: gradedValue,
            captured_on: returnedOn,
          })
        } catch {
          setError(
            'Recorded. The value estimate did not save — add it from the Vault.',
          )
        }
      }
      return returned
    },
    onClose,
  )

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    if (!finalName.trim()) {
      setError('The graded card needs a name.')
      return
    }

    const created = await api.createProduct({
      name: finalName.trim(),
      game_id: product.game.id,
      product_type_id:
        types.data?.find((option) => option.slug === 'graded-card')?.id ??
        types.data?.[0]?.id ??
        '',
      set_name: product.set_name ?? null,
    })
    run.mutate(created.id)
  }

  return (
    <Dialog
      title={`Back from ${gradingCompany ?? 'grading'} — ${product.name}`}
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Record it"
      busy={run.isPending}
      error={error ?? (run.error ? (run.error as Error).message : null)}
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Grade">
          <input
            autoFocus
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            placeholder="10"
            className={FIELD_CLASS}
          />
        </Field>
        <Field label="Came back on">
          <input
            required
            type="date"
            value={returnedOn}
            onChange={(e) => setReturnedOn(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
      </div>

      <Field label="Now called" hint="Built from the card, the grader and the grade. Change it if you like.">
        <input
          value={finalName}
          onChange={(e) => setName(e.target.value)}
          className={FIELD_CLASS}
        />
      </Field>

      {/* A PSA 10 landing is the biggest value event in the whole chain, and it used to
          pass with nothing recorded: the card's cost was tracked to the cent while what
          the grade actually did to it went unwritten. Dated to the return, not to whenever
          somebody got round to typing it. */}
      <Field
        label="What is it worth now?"
        hint="Optional. An estimate kept with its date — it never becomes cost or profit."
      >
        <input
          {...MONEY_INPUT}
          value={gradedValue}
          onChange={(e) => setGradedValue(e.target.value)}
          className={FIELD_CLASS}
        />
      </Field>

      <Field label="Anything else it cost" hint="Added to the fees already recorded.">
        <input
          {...MONEY_INPUT}
          value={extraFees}
          onChange={(e) => setExtraFees(e.target.value)}
          className={FIELD_CLASS}
        />
      </Field>

      <p className="rounded-lg border border-(--color-edge) bg-(--color-ink)/50 px-3 py-2 text-xs text-(--color-muted)">
        The raw card is consumed and the graded one takes its place, carrying what the card
        cost <em>plus</em> the fees. A grade that comes back worse than hoped works the same
        way — the loss just shows.
      </p>

      <Advanced>
        <Field label="Note">
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
      </Advanced>
    </Dialog>
  )
}
