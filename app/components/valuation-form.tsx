import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { useApi } from '../context/AppContext'
import {
  buildValuationPayload,
  firstValuationValidationError,
  validateValuationDraft,
  type ValuationDraft,
  type ValuationPayload,
  type ValuationValidation,
} from '../lib/valuation-drafts'
import type { Valuation } from '../lib/api'
import { todayIso } from '../lib/format'
import { Button, Card, Copy, ErrorNotice, Field, Sheet } from './ui'
import { DateField } from './date-field'

export interface RecordValuationDialogProps {
  product: {
    id: string
    name: string
  }
  onClose: () => void
  /** Optional context for a post-operation prompt; the normal Vault form keeps its copy. */
  title?: string
  description?: string
  initialCapturedOn?: string
  onSkip?: () => void
  /** A recorded valuation being corrected, rather than a new one. */
  editing?: Valuation
}

export function RecordValuationDialog({
  product,
  onClose,
  title,
  description,
  initialCapturedOn,
  onSkip,
  editing,
}: RecordValuationDialogProps) {
  const api = useApi()
  const queryClient = useQueryClient()
  const [value, setValue] = useState(editing?.value ?? '')
  const [capturedOn, setCapturedOn] = useState(editing?.captured_on ?? initialCapturedOn ?? todayIso())
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const [validation, setValidation] = useState<ValuationValidation>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submitting = useRef(false)

  const record = useMutation({
    mutationFn: (payload: ValuationPayload): Promise<unknown> =>
      editing
        ? api.updateValuation(editing.id, {
            value: payload.value,
            captured_on: payload.captured_on,
            notes: payload.notes,
          })
        : api.recordValuation(payload),
    onSuccess: () => {
      // A valuation changes what things are thought to be worth, never the ledger. Do not
      // wait for the refetches before closing a form whose write already finished.
      void queryClient.invalidateQueries()
      onClose()
    },
    onSettled: () => {
      submitting.current = false
      setIsSubmitting(false)
    },
  })

  const draft: ValuationDraft = { productId: product.id, value, capturedOn, notes }
  const busy = record.isPending || isSubmitting

  function submit() {
    // The disabled button and Sheet guard cover normal interaction. The ref also closes the
    // synchronous gap before React has rendered the pending mutation state again.
    if (busy || submitting.current) return

    setValidation({})
    const errors = validateValuationDraft(draft)
    setValidation(errors)
    if (firstValuationValidationError(errors)) return

    const payload = buildValuationPayload(draft)
    if (!payload) return
    submitting.current = true
    setIsSubmitting(true)
    record.mutate(payload)
  }

  const validationMessage = firstValuationValidationError(validation)

  return (
    <Sheet title={title ?? `${editing ? 'Edit' : 'Record'} valuation — ${product.name}`} open onClose={onClose} dismissDisabled={busy}>
      <Card>
        <Copy>{product.name}</Copy>
        <Copy muted>
          {description ?? 'Use a manual estimate per unit, including a slab price if you have one. This value stays separate from the ledger and never uses AI.'}
        </Copy>
      </Card>
      <Field
        label="Value per unit (CAD)"
        value={value}
        onChangeText={setValue}
        editable={!busy}
        keyboardType="decimal-pad"
        autoFocus
        placeholder="0.00"
      />
      <DateField label="As at" value={capturedOn} onChange={setCapturedOn} disabled={busy} />
      <Field
        label="Note"
        value={notes}
        onChangeText={setNotes}
        editable={!busy}
        multiline
        placeholder="Optional source or context"
      />
      {validationMessage ? <ErrorNotice error={new Error(validationMessage)} /> : null}
      {record.error ? <ErrorNotice error={record.error} /> : null}
      {onSkip ? <Button label="Skip valuation" onPress={onSkip} disabled={busy} /> : null}
      <Button label={busy ? 'Saving…' : 'Save valuation'} onPress={submit} disabled={busy} />
    </Sheet>
  )
}

export default RecordValuationDialog
