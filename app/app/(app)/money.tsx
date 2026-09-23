import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Text, View } from 'react-native'

import { BalanceAdjustmentDialog, TransferDialog, VoidMovementDialog } from '../../components/money-forms'
import { Button, Card, Choice, Copy, ErrorNotice, Loading, Page, Row, Signed, toneColor } from '../../components/ui'
import { useApi } from '../../context/AppContext'
import { colors } from '../../context/ThemeContext'
import { EXPENSE_CATEGORY_LABELS, MOVEMENT_LABELS, type Account, type Movement, type MovementKind } from '../../lib/api'
import { money } from '../../lib/format'
import { storeCreditMeaning } from '../../lib/money-drafts'

const PAGE_SIZE = 50

const MOVEMENT_KINDS: { value: MovementKind | ''; label: string }[] = [
  { value: '', label: 'All movement types' },
  { value: 'funding', label: MOVEMENT_LABELS.funding },
  { value: 'proceeds', label: MOVEMENT_LABELS.proceeds },
  { value: 'transfer', label: MOVEMENT_LABELS.transfer },
  { value: 'adjustment', label: MOVEMENT_LABELS.adjustment },
  { value: 'expense', label: MOVEMENT_LABELS.expense },
]

function isZeroMoney(value: string): boolean {
  return /^-?0(?:\.0+)?$/.test(value.trim())
}

function isNegativeMoney(value: string): boolean {
  return value.trim().startsWith('-') && !isZeroMoney(value)
}

function accountKindLabel(account: Account): string {
  if (account.kind === 'joint') return 'Joint cash'
  if (account.kind === 'member') return 'Partner owed'
  return 'Store credit'
}

function accountMeaning(account: Account): string {
  if (account.balance_means === 'owed') {
    if (isZeroMoney(account.balance)) return 'All square'
    return isNegativeMoney(account.balance)
      ? `${account.name} is holding the group's money`
      : `The group owes ${account.name}`
  }
  if (account.balance_means === 'credit') {
    return storeCreditMeaning(account.balance, account.name)
  }
  return isNegativeMoney(account.balance) ? 'Cash account is below zero' : 'Cash available to spend'
}

/** Colour a balance by what it means, not by its sign. Only joint cash is a gain or a loss.
 *  A partner balance is negated at read time, so a debt the group owes arrives positive - green
 *  there would read as profit when it is the opposite. Store credit is value, never profit. */
function balanceTone(account: Account): string | undefined {
  if (account.balance_means === 'owed') {
    if (isZeroMoney(account.balance) || isNegativeMoney(account.balance)) return undefined
    return colors.loss
  }
  if (account.balance_means === 'credit') return undefined
  return toneColor(account.balance)
}

function AccountCard({
  account,
  onTransfer,
  onAdjust,
}: {
  account: Account
  onTransfer: () => void
  onAdjust: () => void
}) {
  return (
    <View role="group" accessibilityLabel={account.name}>
      <Card>
        <Row>
          <View style={{ flex: 1, minWidth: 180 }}>
            <Copy>{account.name}</Copy>
            <Copy muted>{accountKindLabel(account)} · {accountMeaning(account)}</Copy>
          </View>
          <Copy><Text style={{ color: balanceTone(account) }}>{money(account.balance)}</Text></Copy>
        </Row>
        <Row>
          <Button label="Move money" onPress={onTransfer} />
          <Button label="Adjust" onPress={onAdjust} />
        </Row>
      </Card>
    </View>
  )
}

function movementAccountKindLabel(kind: Movement['legs'][number]['account_kind']): string {
  if (kind === 'joint') return 'joint cash'
  if (kind === 'member') return 'partner owed'
  return 'store credit'
}

function MovementLegs({ movement }: { movement: Movement }) {
  return (
    <View style={{ gap: 4 }}>
      {movement.legs.map((leg) => (
        <Copy key={leg.account_id} muted>
          {leg.account_name} · {movementAccountKindLabel(leg.account_kind)} · cash flow <Signed value={leg.amount}>{money(leg.amount)}</Signed>
        </Copy>
      ))}
    </View>
  )
}

function MovementCard({ movement, onVoid }: { movement: Movement; onVoid: () => void }) {
  const canVoid = movement.status !== 'voided' && !movement.purchase_id && !movement.sale_id
  return (
    <View role="group" accessibilityLabel={movement.notes || movement.id}>
      <Card>
        <Row>
          <View style={{ flex: 1, minWidth: 180 }}>
            <Copy>{MOVEMENT_LABELS[movement.kind]}</Copy>
            <Copy muted>
              {movement.occurred_on ?? 'No date'}
              {movement.product_name ? ` · ${movement.product_name}` : ''}
              {movement.expense_category ? ` · ${EXPENSE_CATEGORY_LABELS[movement.expense_category]}` : ''}
            </Copy>
          </View>
          <Copy>{money(movement.amount)}</Copy>
        </Row>
        <Copy muted>Legs show signed cash flow: positive arrives, negative leaves.</Copy>
        <MovementLegs movement={movement} />
        {movement.notes ? <Copy muted>{movement.notes}</Copy> : null}
        <Row>
          <Copy muted>{movement.status === 'voided' ? 'Voided — retained for audit' : 'Posted'}</Copy>
          {canVoid ? <Button label="Void" onPress={onVoid} danger /> : null}
        </Row>
      </Card>
    </View>
  )
}

export interface MoneyProps {
  /** Kept for route-shell parity; the screen itself owns its money actions. */
  onRecordSale?: () => void
}

export function Money(_props: MoneyProps = {}) {
  const api = useApi()
  const [accountFilter, setAccountFilter] = useState('')
  const [kindFilter, setKindFilter] = useState<MovementKind | ''>('')
  const [offset, setOffset] = useState(0)
  const [transferFrom, setTransferFrom] = useState<string | null>(null)
  const [adjusting, setAdjusting] = useState<Account | null>(null)
  const [voiding, setVoiding] = useState<string | null>(null)

  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.accounts })
  const movements = useQuery({
    queryKey: ['movements', accountFilter, kindFilter, offset],
    queryFn: () => api.movements({
      account_id: accountFilter || undefined,
      kind: kindFilter || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
  })

  const items = useMemo(
    () => (accounts.data?.items ?? []).filter((account) => account.is_active),
    [accounts.data],
  )
  const rows = movements.data?.items ?? []
  const spentStores = items.filter((account) => account.balance_means === 'credit' && isZeroMoney(account.balance))
  const shownAccounts = items.filter((account) => !spentStores.includes(account))
  const accountOptions = useMemo(
    () => [{ value: '', label: 'All accounts' }, ...items.map((account) => ({ value: account.id, label: `${account.name} · ${accountKindLabel(account)}` }))],
    [items],
  )

  function resetMovementPage() {
    setOffset(0)
  }

  function retry() {
    void accounts.refetch()
    void movements.refetch()
  }

  return (
    <Page title="Money">
      {accounts.data ? (
        <>
          <Row>
            {items.length > 0 ? <Button label="Move money" onPress={() => setTransferFrom(items[0].id)} /> : null}
          </Row>
          <Card>
            <Row>
              <View style={{ flex: 1, minWidth: 150 }}>
                <Copy muted>In the joint account</Copy>
                <Copy><Signed value={accounts.data.joint_balance}>{money(accounts.data.joint_balance)}</Signed></Copy>
                <Copy muted>Cash the group can spend</Copy>
              </View>
              <View style={{ flex: 1, minWidth: 150 }}>
                <Copy muted>Owed to partners</Copy>
                <Copy>{money(accounts.data.total_owed)}</Copy>
                <Copy muted>Money put in from personal pockets</Copy>
              </View>
              <View style={{ flex: 1, minWidth: 150 }}>
                <Copy muted>In store credit</Copy>
                <Copy>{money(accounts.data.total_credit)}</Copy>
                <Copy muted>
                  {accounts.data.credit_stores === 0
                    ? 'Nothing on account anywhere'
                    : `Across ${accounts.data.credit_stores} ${accounts.data.credit_stores === 1 ? 'store' : 'stores'} · value, not cash`}
                </Copy>
              </View>
            </Row>
            <Copy muted>These three balances are different facts and are never added together.</Copy>
          </Card>
          {shownAccounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              onTransfer={() => setTransferFrom(account.id)}
              onAdjust={() => setAdjusting(account)}
            />
          ))}
          {spentStores.length > 0 ? (
            <Copy muted>
              {spentStores.length} {spentStores.length === 1 ? 'store has' : 'stores have'} no credit left: {spentStores.map((account) => account.name).join(', ')}
            </Copy>
          ) : null}
        </>
      ) : null}

      <Choice
        label="Account"
        value={accountFilter}
        options={accountOptions}
        onChange={(value) => {
          setAccountFilter(value)
          resetMovementPage()
        }}
      />
      <Choice
        label="Movement type"
        value={kindFilter}
        options={MOVEMENT_KINDS}
        onChange={(value) => {
          setKindFilter(value as MovementKind | '')
          resetMovementPage()
        }}
      />
      <Copy muted>{movements.data ? `${rows.length} movement${rows.length === 1 ? '' : 's'} shown${movements.data.total > rows.length ? ` of ${movements.data.total}` : ''}.` : 'Loading movements…'}</Copy>
      <ErrorNotice error={accounts.error ?? movements.error} retry={retry} />
      {accounts.isPending || movements.isPending ? <Loading /> : null}
      {movements.data && rows.length === 0 ? (
        <Card>
          <Copy muted>
            {accountFilter || kindFilter
              ? 'No movements match those filters.'
              : 'Nothing has moved yet. Purchases and sales will appear here.'}
          </Copy>
        </Card>
      ) : null}
      {rows.map((movement) => (
        <MovementCard key={movement.id} movement={movement} onVoid={() => setVoiding(movement.id)} />
      ))}
      {movements.data && movements.data.total > PAGE_SIZE ? (
        <Row>
          <Button
            label="Previous"
            disabled={offset === 0 || movements.isFetching}
            onPress={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          />
          <Copy muted>
            {rows.length === 0 ? 0 : offset + 1}-{offset + rows.length} of {movements.data.total}
          </Copy>
          <Button
            label="Next"
            disabled={offset + PAGE_SIZE >= movements.data.total || movements.isFetching}
            onPress={() => setOffset(offset + PAGE_SIZE)}
          />
        </Row>
      ) : null}

      {transferFrom ? <TransferDialog accounts={items} from={transferFrom} onClose={() => setTransferFrom(null)} /> : null}
      {adjusting ? <BalanceAdjustmentDialog account={adjusting} onClose={() => setAdjusting(null)} /> : null}
      {voiding ? <VoidMovementDialog id={voiding} onClose={() => setVoiding(null)} /> : null}
    </Page>
  )
}

export default Money
