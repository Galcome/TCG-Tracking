import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type ReactNode } from 'react'

import { useApi } from '../context/AppContext'
import {
  buildBalanceAdjustmentPayload,
  buildTransferPayload,
  firstMoneyValidationError,
  validateBalanceAdjustmentDraft,
  validateTransferDraft,
  validateVoidMovementDraft,
  type BalanceAdjustmentDraft,
  type MoneyAdjustmentDirection,
  type MoneyValidation,
  type TransferDraft,
  positiveMoney,
} from '../lib/money-drafts'
import { money, todayIso } from '../lib/format'
import type { Account } from '../lib/api'
import { Button, Card, Choice, Copy, ErrorNotice, Field, Row, Sheet } from './ui'
import { DateField } from './date-field'

interface MoneySheetProps {
  title: string
  onClose: () => void
  onSubmit: () => void
  busy: boolean
  submitLabel: string
  error?: unknown
  validation?: MoneyValidation
  children: ReactNode
}

function MoneySheet({ title, onClose, onSubmit, busy, submitLabel, error, validation, children }: MoneySheetProps) {
  const validationMessage = firstMoneyValidationError(validation ?? {})
  return (
    <Sheet title={title} open onClose={onClose} dismissDisabled={busy}>
      {children}
      {validationMessage ? <ErrorNotice error={new Error(validationMessage)} /> : null}
      {error ? <ErrorNotice error={error} /> : null}
      <Button label={busy ? 'Saving…' : submitLabel} onPress={onSubmit} disabled={busy} />
    </Sheet>
  )
}

function accountKindLabel(account: Account): string {
  if (account.kind === 'joint') return 'Joint cash'
  if (account.kind === 'member') return 'Partner owed'
  return 'Store credit'
}

function accountOption(account: Account) {
  return { value: account.id, label: `${account.name} · ${accountKindLabel(account)}` }
}

function accountMeaning(account: Account): string {
  if (account.balance_means === 'owed') {
    if (account.balance === '0' || account.balance === '0.0' || account.balance === '0.00') return 'All square.'
    return `This balance tracks what the group owes ${account.name}.`
  }
  if (account.balance_means === 'credit') return `Credit held at ${account.name}; it is value, not cash.`
  return 'Cash available to spend from the joint account.'
}

function useMoneyMutation<T>(run: (input: T) => Promise<unknown>, onClose: () => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      onClose()
    },
  })
}

export interface TransferDialogProps {
  accounts: Account[]
  from?: string
  onClose: () => void
}

export function TransferDialog({ accounts, from, onClose }: TransferDialogProps) {
  const api = useApi()
  const initialFrom = from ?? accounts[0]?.id ?? ''
  const [source, setSource] = useState(initialFrom)
  const [destination, setDestination] = useState(
    accounts.find((account) => account.id !== initialFrom)?.id ?? '',
  )
  const [amount, setAmount] = useState('')
  const [occurredOn, setOccurredOn] = useState(todayIso())
  const [notes, setNotes] = useState('')
  const [validation, setValidation] = useState<MoneyValidation>({})
  const mutation = useMoneyMutation(api.createTransfer, onClose)

  const draft = useMemo<TransferDraft>(() => ({
    fromAccountId: source,
    toAccountId: destination,
    amount,
    occurredOn,
    notes,
  }), [amount, destination, notes, occurredOn, source])

  function submit() {
    const payload = buildTransferPayload(draft)
    const errors = payload ? {} : validateTransferDraft(draft)
    setValidation(errors)
    if (!payload) return
    mutation.mutate(payload)
  }

  return (
    <MoneySheet
      title="Move money"
      onClose={onClose}
      onSubmit={submit}
      busy={mutation.isPending}
      submitLabel="Move it"
      error={mutation.error}
      validation={validation}
    >
      <Row>
        <Choice label="Out of" value={source} options={accounts.map(accountOption)} onChange={setSource} />
        <Choice label="Into" value={destination} options={accounts.map(accountOption)} onChange={setDestination} />
      </Row>
      {accounts.find((account) => account.id === source) && accounts.find((account) => account.id === destination) ? (
        <Copy muted>
          {transferMeaning(
            accounts.find((account) => account.id === source)!,
            accounts.find((account) => account.id === destination)!,
            amount,
          )}
        </Copy>
      ) : null}
      <Field label="How much" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" autoFocus />
      <DateField label="Date" value={occurredOn} onChange={setOccurredOn} />
      <Field label="Note" value={notes} onChangeText={setNotes} multiline />
    </MoneySheet>
  )
}

function transferMeaning(from: Account, to: Account, amount: string): string {
  const shown = amount ? (positiveMoney(amount) ? money(amount) : amount) : 'the entered amount'
  if (from.kind === 'joint' && to.kind === 'member') {
    return `Pays ${to.name} back: joint cash drops ${shown}, and what the group owes them drops too.`
  }
  if (from.kind === 'member' && to.kind === 'joint') {
    return `${from.name} puts ${shown} into joint cash, increasing what the group owes them.`
  }
  if (to.kind === 'store_credit') return `${shown} moves into ${to.name} as store credit, not cash.`
  if (from.kind === 'store_credit') return `${shown} leaves ${from.name}'s store credit.`
  return `${shown} moves from ${from.name} to ${to.name}.`
}

export interface BalanceAdjustmentDialogProps {
  account: Account
  onClose: () => void
}

export function BalanceAdjustmentDialog({ account, onClose }: BalanceAdjustmentDialogProps) {
  const api = useApi()
  const [direction, setDirection] = useState<MoneyAdjustmentDirection>('up')
  const [amount, setAmount] = useState('')
  const [occurredOn, setOccurredOn] = useState(todayIso())
  const [notes, setNotes] = useState('')
  const [validation, setValidation] = useState<MoneyValidation>({})
  const mutation = useMoneyMutation(api.createMoneyAdjustment, onClose)
  const draft = useMemo<BalanceAdjustmentDraft>(() => ({
    accountId: account.id,
    direction,
    amount,
    occurredOn,
    notes,
  }), [account.id, amount, direction, notes, occurredOn])
  const labels = account.balance_means === 'owed'
    ? { up: 'Owed more', down: 'Owed less' }
    : account.kind === 'store_credit'
      ? { up: 'Credit added', down: 'Credit removed' }
      : { up: 'Money in', down: 'Money out' }

  function submit() {
    const payload = buildBalanceAdjustmentPayload(draft)
    const errors = payload ? {} : validateBalanceAdjustmentDraft(draft)
    setValidation(errors)
    if (!payload) return
    mutation.mutate(payload)
  }

  return (
    <MoneySheet
      title={`Adjust ${account.name}`}
      onClose={onClose}
      onSubmit={submit}
      busy={mutation.isPending}
      submitLabel="Save"
      error={mutation.error}
      validation={validation}
    >
      <Card>
        <Copy>{account.name}</Copy>
        <Copy muted>{accountKindLabel(account)} · {accountMeaning(account)}</Copy>
      </Card>
      <Choice
        label="Direction"
        value={direction}
        options={[{ value: 'up', label: labels.up }, { value: 'down', label: labels.down }]}
        onChange={(value) => setDirection(value as MoneyAdjustmentDirection)}
      />
      <Field label="How much" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" autoFocus />
      <DateField label="Date" value={occurredOn} onChange={setOccurredOn} />
      <Field label="Audit note" value={notes} onChangeText={setNotes} multiline placeholder="Why this balance needs correcting" />
    </MoneySheet>
  )
}

export interface VoidMovementDialogProps {
  id: string
  onClose: () => void
}

export function VoidMovementDialog({ id, onClose }: VoidMovementDialogProps) {
  const api = useApi()
  const [reason, setReason] = useState('')
  const [validation, setValidation] = useState<MoneyValidation>({})
  const mutation = useMoneyMutation((value: string) => api.voidMovement(id, value), onClose)

  function submit() {
    const errors = validateVoidMovementDraft({ reason })
    setValidation(errors)
    if (Object.keys(errors).length > 0) return
    mutation.mutate(reason.trim())
  }

  return (
    <MoneySheet
      title="Void this movement"
      onClose={onClose}
      onSubmit={submit}
      busy={mutation.isPending}
      submitLabel="Void it"
      error={mutation.error}
      validation={validation}
    >
      <Card>
        <Copy muted>This row stays on the ledger as an audit trail, but stops counting toward balances.</Copy>
      </Card>
      <Field label="Reason" value={reason} onChangeText={setReason} autoFocus placeholder="Entered twice" />
    </MoneySheet>
  )
}
