/**
 * Where the money actually is, and who is owed what.
 *
 * This is a different question from the Dashboard's "Since day one" block. That one says
 * what was spent on stock and what came back; this one says whose money paid for it and
 * where the proceeds went. Both are true at once, and the two are never added together.
 */

import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeftRight,
  Landmark,
  PiggyBank,
  SlidersHorizontal,
  Store,
  Wallet,
} from 'lucide-react'
import { useState } from 'react'

import { api, MOVEMENT_LABELS, type Account, type Movement } from '../api'
import { PageHeader } from '../components/AppShell'
import {
  BalanceAdjustmentDialog,
  TransferDialog,
  VoidMovementDialog,
} from '../components/money-forms'
import { Button, Card, Empty, RowAction, Skeleton, StatSkeleton } from '../components/ui'
import { money, shortDate, signedMoney, toneFor } from '../format'

/**
 * One account, with what its balance means said in words rather than implied by a sign.
 *
 * A member's balance is what the group owes them. Negative means the opposite - they are
 * holding money that belongs to the group - and that has to read as a sentence, because
 * "-$300" on its own is the kind of number people quietly interpret backwards.
 */
function AccountCard({
  account,
  onTransfer,
  onAdjust,
}: {
  account: Account
  onTransfer: () => void
  onAdjust: () => void
}) {
  const value = Number(account.balance)
  const owed = account.balance_means === 'owed'
  const credit = account.balance_means === 'credit'

  const meaning = owed
    ? value > 0
      ? `The group owes ${account.name}`
      : value < 0
        ? `${account.name} is holding the group's money`
        : 'All square'
    : credit
      ? value > 0
        ? `Credit to spend at ${account.name}. Not cash.`
        : 'Nothing left here'
      : value < 0
        ? 'Overdrawn — more has been spent from it than put in'
        : 'Cash available to spend'

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            {owed ? <Wallet size={15} /> : credit ? <Store size={15} /> : <Landmark size={15} />}
            {account.name}
          </p>
          <p className="mt-1 text-xs text-(--color-faint)">{meaning}</p>
        </div>
        <p
          className={`font-display shrink-0 text-xl font-bold tabular-nums ${
            owed ? toneFor(account.balance) : value < 0 ? 'text-(--color-loss)' : ''
          }`}
        >
          {owed ? signedMoney(account.balance) : money(account.balance)}
        </p>
      </div>
      <div className="mt-3 flex gap-2 border-t border-(--color-edge) pt-3">
        <RowAction onClick={onTransfer}>
          <ArrowLeftRight size={13} />
          Move money
        </RowAction>
        <RowAction onClick={onAdjust}>
          <SlidersHorizontal size={13} />
          Adjust
        </RowAction>
      </div>
    </Card>
  )
}

/** A movement's legs, said as a sentence: which account, which way, how much. */
function Legs({ movement }: { movement: Movement }) {
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5">
      {movement.legs.map((leg) => (
        <span key={leg.account_id} className="whitespace-nowrap text-xs">
          <span className="text-(--color-faint)">{leg.account_name}</span>{' '}
          <span className={`tabular-nums ${toneFor(leg.amount)}`}>{signedMoney(leg.amount)}</span>
        </span>
      ))}
    </span>
  )
}

export function Money() {
  const [transferFrom, setTransferFrom] = useState<string | null>(null)
  const [adjusting, setAdjusting] = useState<Account | null>(null)
  const [voiding, setVoiding] = useState<string | null>(null)

  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.accounts })
  const movements = useQuery({
    queryKey: ['movements'],
    queryFn: () => api.movements({ limit: 100 }),
  })

  const items = accounts.data?.items ?? []
  const rows = movements.data?.items ?? []

  // Shops with nothing left get a count rather than a card each. They are still in the
  // totals and still one tap away on the sale form; what they are not is worth a third of
  // the screen when the joint balance is the thing somebody opened this page for.
  const spent = items.filter(
    (account) => account.balance_means === 'credit' && Number(account.balance) === 0,
  )
  const shown = items.filter((account) => !spent.includes(account))

  return (
    <div className="space-y-5">
      <PageHeader title="Money">
        {items.length > 0 && (
          <Button type="button" onClick={() => setTransferFrom(items[0].id)}>
            <ArrowLeftRight size={15} />
            Move money
          </Button>
        )}
      </PageHeader>

      {accounts.isLoading && (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((index) => (
            <StatSkeleton key={index} />
          ))}
        </div>
      )}
      {accounts.isError && (
        <p className="rounded-lg border border-(--color-loss)/40 bg-(--color-loss)/10 px-3 py-2 text-sm text-(--color-loss)">
          {(accounts.error as Error).message}
        </p>
      )}

      {accounts.data && (
        <>
          {/* Two figures, never one. Cash you have and money you owe your own partners are
              different facts, and a single netted number hides whichever is the problem. */}
          <Card>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-[0.6875rem] font-semibold tracking-[0.12em] text-(--color-faint)">
                  IN THE JOINT ACCOUNT
                </p>
                <p
                  className={`font-display mt-1 text-2xl font-bold tabular-nums ${
                    Number(accounts.data.joint_balance) < 0 ? 'text-(--color-loss)' : ''
                  }`}
                >
                  {money(accounts.data.joint_balance)}
                </p>
                <p className="mt-1 text-xs text-(--color-muted)">Cash the group can spend</p>
              </div>
              <div>
                <p className="text-[0.6875rem] font-semibold tracking-[0.12em] text-(--color-faint)">
                  OWED TO PARTNERS
                </p>
                <p
                  className={`font-display mt-1 text-2xl font-bold tabular-nums ${toneFor(
                    accounts.data.total_owed,
                  )}`}
                >
                  {signedMoney(accounts.data.total_owed)}
                </p>
                <p className="mt-1 text-xs text-(--color-muted)">
                  Money put in out of their own pockets and not yet taken back
                </p>
              </div>
              <div>
                <p className="text-[0.6875rem] font-semibold tracking-[0.12em] text-(--color-faint)">
                  IN STORE CREDIT
                </p>
                <p className="font-display mt-1 text-2xl font-bold tabular-nums">
                  {money(accounts.data.total_credit)}
                </p>
                <p className="mt-1 text-xs text-(--color-muted)">
                  {accounts.data.credit_stores === 0
                    ? 'Nothing on account anywhere'
                    : `Across ${accounts.data.credit_stores} ${
                        accounts.data.credit_stores === 1 ? 'store' : 'stores'
                      } — value, but not money`}
                </p>
              </div>
            </div>
            <p className="mt-4 border-t border-(--color-edge) pt-3 text-xs text-(--color-faint)">
              These three are not added together, and neither is the Dashboard&rsquo;s
              money&nbsp;in/money&nbsp;out. Cash you have, money you owe your own partners, and
              credit you can only spend at one shop are different facts.
            </p>
          </Card>

          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((account) => (
              <li key={account.id}>
                <AccountCard
                  account={account}
                  onTransfer={() => setTransferFrom(account.id)}
                  onAdjust={() => setAdjusting(account)}
                />
              </li>
            ))}
          </ul>

          {spent.length > 0 && (
            <p className="text-xs text-(--color-faint)">
              {spent.length} {spent.length === 1 ? 'shop has' : 'shops have'} no credit left:{' '}
              {spent.map((account) => account.name).join(', ')}
            </p>
          )}
        </>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-(--color-muted)">
          Everything that moved
        </h2>

        {movements.isLoading && <Skeleton className="h-40 w-full" />}

        {movements.data && rows.length === 0 && (
          <Card>
            <Empty icon={<PiggyBank size={30} strokeWidth={1.5} />}>
              Nothing has moved yet. Buying stock and recording sales fills this in on its
              own; use Adjust on an account to carry over what somebody was already owed.
            </Empty>
          </Card>
        )}

        {rows.length > 0 && (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-(--color-edge) text-left text-xs uppercase tracking-wide text-(--color-muted)">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">What</th>
                  <th className="px-4 py-3 font-medium">Accounts</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                  <th className="py-3 pl-2 pr-4" />
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-edge)">
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={row.status === 'voided' ? 'text-(--color-muted) line-through' : ''}
                  >
                    <td className="whitespace-nowrap px-4 py-3">{shortDate(row.occurred_on)}</td>
                    <td className="px-4 py-3">
                      {MOVEMENT_LABELS[row.kind]}
                      {row.product_name && (
                        <span className="ml-2 text-xs text-(--color-faint)">
                          {row.product_name}
                        </span>
                      )}
                      {row.notes && (
                        <span className="ml-2 text-xs text-(--color-faint)">{row.notes}</span>
                      )}
                      {row.status === 'voided' && <span className="ml-2 text-xs">(voided)</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Legs movement={row} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(row.amount)}</td>
                    <td className="whitespace-nowrap py-3 pl-2 pr-4 text-right">
                      {/* Funding and proceeds have no Void here on purpose: they describe a
                          purchase or a sale, so the honest correction is to that
                          transaction, and its money record follows automatically. */}
                      {row.status !== 'voided' && !row.purchase_id && !row.sale_id && (
                        <RowAction onClick={() => setVoiding(row.id)}>Void</RowAction>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      {transferFrom && (
        <TransferDialog
          accounts={items}
          from={transferFrom}
          onClose={() => setTransferFrom(null)}
        />
      )}
      {adjusting && (
        <BalanceAdjustmentDialog account={adjusting} onClose={() => setAdjusting(null)} />
      )}
      {voiding && <VoidMovementDialog id={voiding} onClose={() => setVoiding(null)} />}
    </div>
  )
}
