/**
 * The money-side dialogs: moving money between accounts, correcting a balance, voiding.
 *
 * Kept apart from forms.tsx because these do not touch stock at all. Nothing here has a
 * product, a quantity or a cost basis - the whole file is about where the cash is.
 */

import { useState } from 'react'

import { api, type Account } from '../api'
import { money, todayIso } from '../format'
import { MONEY_INPUT, useLedgerMutation } from './forms'
import { Advanced, Dialog, Field, FIELD_CLASS } from './ui'

/**
 * What a transfer will actually do, in words.
 *
 * Paying a partner back lowers the joint balance *and* what they are owed - both fall.
 * That surprises people, so the form says it before the button is pressed rather than
 * leaving them to work it out from two numbers that moved in the same direction.
 */
export function transferMeaning(from: Account, to: Account, amount: string): string {
  const value = money(amount)
  if (from.kind === 'joint' && to.kind === 'member') {
    return `Pays ${to.name} back. The joint account drops ${value}, and what the group owes ${to.name} drops ${value}.`
  }
  if (from.kind === 'member' && to.kind === 'joint') {
    return `${from.name} puts ${value} in. The joint account rises ${value}, and the group owes ${from.name} ${value} more.`
  }
  return `The group owes ${from.name} ${value} more and ${to.name} ${value} less.`
}

/**
 * Moving money between two accounts.
 *
 * Paying a partner back, putting personal cash into the joint account, and one partner
 * settling with another are all this one form. Which of those it reads as is a consequence
 * of the two accounts and the direction, not a mode anybody has to choose - the group said
 * the requirement was fluidity, and a form with three buttons is not fluid.
 */
export function TransferDialog({
  accounts,
  from,
  onClose,
}: {
  accounts: Account[]
  /** Pre-selected source, when opened from one account's row. */
  from?: string
  onClose: () => void
}) {
  const initial = from ?? accounts[0]?.id ?? ''
  const [source, setSource] = useState(initial)
  const [destination, setDestination] = useState(
    accounts.find((account) => account.id !== initial)?.id ?? '',
  )
  const [amount, setAmount] = useState('')
  const [occurredOn, setDate] = useState(todayIso())
  const [notes, setNotes] = useState('')

  const create = useLedgerMutation(api.createTransfer, onClose)

  const sourceAccount = accounts.find((account) => account.id === source)
  const destinationAccount = accounts.find((account) => account.id === destination)

  return (
    <Dialog
      title="Move money"
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault()
        create.mutate({
          from_account_id: source,
          to_account_id: destination,
          amount,
          occurred_on: occurredOn,
          notes: notes.trim() || null,
        })
      }}
      submitLabel="Move it"
      busy={create.isPending}
      error={create.error ? (create.error as Error).message : null}
    >
      <div className="grid grid-cols-2 gap-4">
        {/* aria-labels rather than relying on the wrapping label: an option's text becomes
            part of a nested select's accessible name, so "Out of" would read as
            "Out ofJoint accountPatrick…" to anything matching on the label. */}
        <Field label="Out of">
          <select
            aria-label="Out of"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className={FIELD_CLASS}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Into">
          <select
            aria-label="Into"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            className={FIELD_CLASS}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="How much">
        <input
          required
          autoFocus
          {...MONEY_INPUT}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={FIELD_CLASS}
        />
      </Field>

      {sourceAccount && destinationAccount && amount && (
        <p className="rounded-lg border border-(--color-edge) bg-(--color-ink)/50 px-3 py-2 text-xs text-(--color-muted)">
          {transferMeaning(sourceAccount, destinationAccount, amount)}
        </p>
      )}

      <Field label="Date">
        <input
          required
          type="date"
          value={occurredOn}
          onChange={(e) => setDate(e.target.value)}
          className={FIELD_CLASS}
        />
      </Field>

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

/**
 * Setting a balance directly.
 *
 * This is how the spreadsheet's rollover column arrives: "Jason was already owed $5,000
 * when we started." It is also how a double-counted payback is undone, which is why it
 * goes both ways.
 *
 * The two directions are labelled in the account's own terms - "Owed more" on a person,
 * "Money in" on the joint account - so nobody has to reason about which way cash
 * notionally travelled to produce the balance they want.
 */
export function BalanceAdjustmentDialog({
  account,
  onClose,
}: {
  account: Account
  onClose: () => void
}) {
  const [direction, setDirection] = useState<'up' | 'down'>('up')
  const [amount, setAmount] = useState('')
  const [occurredOn, setDate] = useState(todayIso())
  const [notes, setNotes] = useState('')

  const create = useLedgerMutation(api.createMoneyAdjustment, onClose)
  const owed = account.balance_means === 'owed'

  const labels = owed
    ? { up: 'Owed more', down: 'Owed less' }
    : { up: 'Money in', down: 'Money out' }

  return (
    <Dialog
      title={`Adjust ${account.name}`}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault()
        // Integer cents, signed by the direction chosen above. The server reads it in this
        // account's own terms and does the flip to raw cash flow itself, in one place.
        const cents = Math.round(Number(amount) * 100) * (direction === 'up' ? 1 : -1)
        create.mutate({
          account_id: account.id,
          amount: cents,
          occurred_on: occurredOn,
          notes: notes.trim() || null,
        })
      }}
      submitLabel="Save"
      busy={create.isPending}
      error={create.error ? (create.error as Error).message : null}
    >
      <div>
        <span className="text-sm font-medium text-(--color-muted)">Direction</span>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {(['up', 'down'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setDirection(option)}
              className={`rounded-full border px-3 py-1.5 text-[0.8125rem] transition-colors ${
                direction === option
                  ? 'border-(--color-accent) bg-(--color-accent)/12 font-medium text-(--color-accent)'
                  : 'border-(--color-edge) text-(--color-muted) hover:text-(--color-text)'
              }`}
            >
              {labels[option]}
            </button>
          ))}
        </div>
      </div>

      <Field
        label="How much"
        hint={
          owed
            ? 'Carry over what someone was already owed before any of this was recorded here.'
            : 'Set what was already sitting in the joint account.'
        }
      >
        <input
          required
          autoFocus
          {...MONEY_INPUT}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
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

/** Voiding a movement. Same rule as voiding a sale: it stays on the ledger, and say why. */
export function VoidMovementDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const run = useLedgerMutation((input: string) => api.voidMovement(id, input), onClose)

  return (
    <Dialog
      title="Void this movement"
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault()
        run.mutate(reason.trim())
      }}
      submitLabel="Void it"
      busy={run.isPending}
      error={run.error ? (run.error as Error).message : null}
    >
      <p className="text-sm text-(--color-muted)">
        The row stays on the ledger and stops counting towards any balance. That is what
        explains the change later.
      </p>
      <Field label="Reason">
        <input
          required
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Entered twice"
          className={FIELD_CLASS}
        />
      </Field>
    </Dialog>
  )
}
