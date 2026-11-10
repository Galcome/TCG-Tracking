import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { BalanceAdjustmentDialog, ContributionDialog, ExpenseDialog, TransferDialog, VoidMovementDialog } from '../../components/money-forms'
import { EditTransactionDialog, VoidDialog } from '../../components/product-forms'
import { Button, Card, Choice, Copy, ErrorNotice, Loading, Page, Row, Signed, toneColor } from '../../components/ui'
import { useApi } from '../../context/AppContext'
import { colors } from '../../context/ThemeContext'
import { EXPENSE_CATEGORY_LABELS, MOVEMENT_LABELS, type Account, type Movement, type MovementKind, type OpenItem, type StatementLine } from '../../lib/api'
import { money, todayIso } from '../../lib/format'
import {
  adjustmentDraftFromMovement,
  costBreakdown,
  expenseEditFromMovement,
  legLine,
  linesSinceSettled,
  openItemLine,
  signedChange,
  statementReason,
  storeCreditMeaning,
  sumMoney,
  transferDraftFromMovement,
  type BalanceAdjustmentDraft,
  type ExpenseEdit,
  type TransferDraft,
} from '../../lib/money-drafts'

const PAGE_SIZE = 50

const MOVEMENT_KINDS: { value: MovementKind | ''; label: string }[] = [
  { value: '', label: 'All movement types' },
  { value: 'funding', label: MOVEMENT_LABELS.funding },
  { value: 'proceeds', label: MOVEMENT_LABELS.proceeds },
  { value: 'transfer', label: MOVEMENT_LABELS.transfer },
  { value: 'adjustment', label: MOVEMENT_LABELS.adjustment },
  { value: 'expense', label: MOVEMENT_LABELS.expense },
  { value: 'contribution', label: MOVEMENT_LABELS.contribution },
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

/** What can be done to a posted movement. Edit is missing when the movement cannot be re-opened. */
interface MovementActions {
  onEdit?: () => void
  onVoid: () => void
}

/** A label and its figure, one per line of a breakdown. */
function BreakdownLine({ label, value }: { label: string; value: string }) {
  return (
    <Row>
      <View style={{ flex: 1, minWidth: 120 }}>
        <Copy muted>{label}</Copy>
      </View>
      <Copy muted>{value}</Copy>
    </Row>
  )
}

/** What a purchase or sale on a statement was made of. */
function StockBreakdown({ movement }: { movement: Movement }) {
  const api = useApi()
  const productId = movement.product_id ?? ''
  const product = useQuery({ queryKey: ['product', productId], queryFn: () => api.product(productId), enabled: Boolean(productId) })
  const id = movement.purchase_id ?? movement.sale_id
  const kind = movement.purchase_id ? 'purchase' : 'sale'
  if (product.error) return <ErrorNotice error={product.error} retry={() => void product.refetch()} />
  if (!product.data) return <Loading />
  const transaction = product.data.history.find((row) => row.kind === kind && row.id === id)
  if (!transaction) return <Copy muted>The {kind} behind this line is no longer on the product.</Copy>
  return (
    <>
      {costBreakdown(transaction).map((row) => <BreakdownLine key={row.label} label={row.label} value={row.value} />)}
    </>
  )
}

/** Tapping a statement line opens what it was made of, then who paid for it. */
function LineBreakdown({ line }: { line: StatementLine }) {
  const { movement } = line
  const isStock = Boolean((movement.purchase_id || movement.sale_id) && movement.product_id)
  return (
    <View style={{ gap: 4, paddingLeft: 12, borderLeftWidth: 2, borderColor: colors.edge }}>
      {isStock ? <StockBreakdown movement={movement} /> : <BreakdownLine label="Amount" value={money(movement.amount)} />}
      {movement.legs.map((leg) => <Copy key={leg.account_id} muted>{legLine(leg)}</Copy>)}
    </View>
  )
}

/** Only the lines that make up the balance right now, newest first. Anything from before the
 *  balance last hit zero has netted out and lives in Movements below. */
function AccountStatement({
  account,
  actionsFor,
  openItems,
  onPayBackItem,
  onPayBackAll,
}: {
  account: Account
  actionsFor: (movement: Movement) => MovementActions
  openItems: OpenItem[]
  onPayBackItem: (item: OpenItem) => void
  onPayBackAll: (balance: string) => void
}) {
  const api = useApi()
  const [opened, setOpened] = useState<string | null>(null)
  const statement = useQuery({ queryKey: ['statement', account.id], queryFn: () => api.statement(account.id) })
  if (statement.error) return <ErrorNotice error={statement.error} retry={() => void statement.refetch()} />
  if (!statement.data) return <Loading />
  const lines = linesSinceSettled(statement.data.items)
  if (lines.length === 0) return <Copy muted>Nothing owing.</Copy>
  const balance = statement.data.balance
  const owedToThem = account.balance_means === 'owed' && !isZeroMoney(balance) && !isNegativeMoney(balance)
  return (
    <View style={{ gap: 8 }}>
      {lines.map((line) => {
        const actions = actionsFor(line.movement)
        const reason = statementReason(line, account)
        const open = openItems.find((item) => item.movement.id === line.movement.id)
        const showing = opened === line.movement.id
        return (
          <View key={line.movement.id} role="group" accessibilityLabel={`Statement: ${reason}`} style={{ gap: 8, borderTopWidth: 1, borderColor: colors.edge, paddingTop: 8 }}>
            <Row>
              <View style={{ flex: 1, minWidth: 180 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Breakdown of ${reason}`}
                  aria-expanded={showing}
                  accessibilityState={{ expanded: showing }}
                  onPress={() => setOpened(showing ? null : line.movement.id)}
                >
                  <Copy><Text style={{ color: colors.accent }}>{reason} {showing ? '−' : '+'}</Text></Copy>
                </Pressable>
                {/* The reason already names the product, so only the date and notes follow. */}
                <Copy muted>{[line.movement.occurred_on ?? 'No date', line.movement.notes].filter(Boolean).join(' · ')}</Copy>
              </View>
              <Copy>{signedChange(line.change)}</Copy>
            </Row>
            {showing ? <LineBreakdown line={line} /> : null}
            {/* A statement only lists active movements, so every line can still be voided. */}
            <Row>
              {open ? <Button label="Pay back" onPress={() => onPayBackItem(open)} /> : null}
              {actions.onEdit ? <Button label="Edit" onPress={actions.onEdit} /> : null}
              <Button label="Void" onPress={actions.onVoid} danger />
            </Row>
          </View>
        )
      })}
      <View style={{ gap: 8, borderTopWidth: 1, borderColor: colors.edge, paddingTop: 8 }}>
        <Row>
          <View style={{ flex: 1, minWidth: 180 }}>
            <Copy>Total</Copy>
          </View>
          <Copy>{money(balance)}</Copy>
        </Row>
        {owedToThem ? (
          <Row>
            <Button label={`Pay back all ${money(balance)}`} onPress={() => onPayBackAll(balance)} variant="primary" />
          </Row>
        ) : null}
      </View>
    </View>
  )
}

function AccountCard({
  account,
  onTransfer,
  onAdjust,
  onExpense,
  actionsFor,
  openItems,
  onPayBackItem,
  onPayBackAll,
}: {
  account: Account
  onTransfer: () => void
  onAdjust: () => void
  onExpense: () => void
  actionsFor: (movement: Movement) => MovementActions
  openItems: OpenItem[]
  onPayBackItem: (item: OpenItem) => void
  onPayBackAll: (balance: string) => void
}) {
  const [showing, setShowing] = useState(false)
  return (
    <View role="group" accessibilityLabel={account.name}>
      <Card>
        <Row>
          <View style={{ flex: 1, minWidth: 180 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Why is ${account.name} at ${money(account.balance)}`}
              aria-expanded={showing}
              accessibilityState={{ expanded: showing }}
              onPress={() => setShowing(!showing)}
            >
              <Copy><Text style={{ color: colors.accent }}>{account.name} {showing ? '−' : '+'}</Text></Copy>
            </Pressable>
            <Copy muted>{accountKindLabel(account)} · {accountMeaning(account)}</Copy>
            {account.contributed && !isZeroMoney(account.contributed) ? (
              <Copy muted>Put in for shares: {money(account.contributed)}</Copy>
            ) : null}
          </View>
          <Copy><Text style={{ color: balanceTone(account) }}>{money(account.balance)}</Text></Copy>
        </Row>
        <Row>
          <Button label="Move money" onPress={onTransfer} />
          <Button label="Adjust" onPress={onAdjust} />
          <Button label="Add expense" onPress={onExpense} />
        </Row>
        {showing ? (
          <AccountStatement account={account} actionsFor={actionsFor} openItems={openItems} onPayBackItem={onPayBackItem} onPayBackAll={onPayBackAll} />
        ) : null}
      </Card>
    </View>
  )
}

function MovementLegs({ movement }: { movement: Movement }) {
  return (
    <View style={{ gap: 4 }}>
      {movement.legs.map((leg) => (
        <Copy key={leg.account_id} muted>
          {legLine(leg)}
        </Copy>
      ))}
    </View>
  )
}

/** What a movement is about, for the line under its title. */
function movementDetail(movement: Movement): string {
  return [
    movement.occurred_on ?? 'No date',
    movement.product_name,
    movement.expense_category ? EXPENSE_CATEGORY_LABELS[movement.expense_category] : null,
  ].filter(Boolean).join(' · ')
}

function OpenItemCard({ item, onPayBack }: { item: OpenItem; onPayBack: () => void }) {
  return (
    <View role="group" accessibilityLabel={`Open: ${item.movement.product_name ?? MOVEMENT_LABELS[item.movement.kind]}`}>
      <Card>
        <Row>
          <View style={{ flex: 1, minWidth: 180 }}>
            <Copy>{MOVEMENT_LABELS[item.movement.kind]}</Copy>
            <Copy muted>{movementDetail(item.movement)}</Copy>
            <Copy muted>{openItemLine(item)}</Copy>
          </View>
          <Copy>{money(item.outstanding)}</Copy>
        </Row>
        <Row>
          <Button label="Pay back" onPress={onPayBack} />
        </Row>
      </Card>
    </View>
  )
}

function MovementCard({
  movement,
  onVoid,
  onEdit,
}: {
  movement: Movement
  onVoid: () => void
  onEdit?: () => void
}) {
  const canVoid = movement.status !== 'voided'
  return (
    <View role="group" accessibilityLabel={movement.notes || movement.id}>
      <Card>
        <Row>
          <View style={{ flex: 1, minWidth: 180 }}>
            <Copy>{MOVEMENT_LABELS[movement.kind]}</Copy>
            <Copy muted>{movementDetail(movement)}</Copy>
          </View>
          <Copy>{money(movement.amount)}</Copy>
        </Row>
        <MovementLegs movement={movement} />
        {movement.notes ? <Copy muted>{movement.notes}</Copy> : null}
        <Row>
          <Copy muted>{movement.status === 'voided' ? 'Voided' : 'Posted'}</Copy>
          {canVoid && onEdit ? <Button label="Edit" onPress={onEdit} /> : null}
          {canVoid ? <Button label="Void" onPress={onVoid} danger /> : null}
        </Row>
      </Card>
    </View>
  )
}

type EditTarget =
  | { kind: 'adjustment'; id: string; account: Account; draft: BalanceAdjustmentDraft }
  | { kind: 'expense'; id: string; edit: ExpenseEdit }
  | { kind: 'transfer'; id: string; draft: TransferDraft }

/** A movement can be re-opened only when every account it touched is still on the books. */
function editTarget(movement: Movement, accounts: Account[]): EditTarget | null {
  if (!movement.legs.every((leg) => accounts.some((item) => item.id === leg.account_id))) return null
  const today = todayIso()
  if (movement.kind === 'expense') {
    const edit = expenseEditFromMovement(movement, today)
    return edit ? { kind: 'expense', id: movement.id, edit } : null
  }
  if (movement.kind === 'transfer') {
    const draft = transferDraftFromMovement(movement, today)
    return draft ? { kind: 'transfer', id: movement.id, draft } : null
  }
  const account = accounts.find((item) => item.id === movement.legs[0]?.account_id)
  if (!account) return null
  const draft = adjustmentDraftFromMovement(movement, account.balance_means === 'owed', today)
  return draft ? { kind: 'adjustment', id: movement.id, account, draft } : null
}

/** A row that came from a purchase or sale opens that transaction's own form. */
interface StockAction {
  mode: 'edit' | 'void'
  movement: Movement
}

function StockActionDialog({ action, onClose }: { action: StockAction; onClose: () => void }) {
  const api = useApi()
  const productId = action.movement.product_id ?? ''
  const product = useQuery({ queryKey: ['product', productId], queryFn: () => api.product(productId) })
  const id = action.movement.purchase_id ?? action.movement.sale_id
  const kind = action.movement.purchase_id ? 'purchase' : 'sale'
  const transaction = product.data?.history.find((row) => row.kind === kind && row.id === id)

  if (product.error) return <ErrorNotice error={product.error} retry={() => void product.refetch()} />
  if (!transaction) return <Loading />
  return action.mode === 'edit'
    ? <EditTransactionDialog transaction={transaction} onClose={onClose} />
    : <VoidDialog transaction={transaction} onClose={onClose} />
}

/** Joint cash going to a partner: for one open row, or for their whole balance. */
interface PayBack {
  key: string
  fromAccountId?: string
  toAccountId: string
  amount: string
  notes: string
  movementId?: string
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
  const [expenseFrom, setExpenseFrom] = useState<string | null>(null)
  const [contributing, setContributing] = useState(false)
  const [editing, setEditing] = useState<EditTarget | null>(null)
  const [voiding, setVoiding] = useState<string | null>(null)
  const [stockAction, setStockAction] = useState<StockAction | null>(null)
  // A voided row changed nothing, so it is noise until someone asks for it.
  const [hideVoided, setHideVoided] = useState(true)
  const [payingBack, setPayingBack] = useState<PayBack | null>(null)

  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.accounts })
  const open = useQuery({ queryKey: ['openItems'], queryFn: api.openItems })
  const movements = useQuery({
    queryKey: ['movements', accountFilter, kindFilter, hideVoided, offset],
    queryFn: () => api.movements({
      account_id: accountFilter || undefined,
      kind: kindFilter || undefined,
      include_voided: hideVoided ? false : undefined,
      limit: PAGE_SIZE,
      offset,
    }),
  })

  const items = useMemo(
    () => (accounts.data?.items ?? []).filter((account) => account.is_active),
    [accounts.data],
  )
  const rows = movements.data?.items ?? []
  const openItems = open.data?.items ?? []
  // One group per partner, so nobody's items sit behind somebody else's older ones.
  const openByPartner = useMemo(() => {
    const groups = new Map<string, OpenItem[]>()
    for (const item of open.data?.items ?? []) groups.set(item.account_id, [...(groups.get(item.account_id) ?? []), item])
    return [...groups.values()]
  }, [open.data])
  const spentStores = items.filter((account) => account.balance_means === 'credit' && isZeroMoney(account.balance))
  const shownAccounts = items.filter((account) => !spentStores.includes(account))
  const accountOptions = useMemo(
    () => [{ value: '', label: 'All accounts' }, ...items.map((account) => ({ value: account.id, label: `${account.name} · ${accountKindLabel(account)}` }))],
    [items],
  )

  /** A purchase or sale opens its own transaction form; anything else opens the money form it came from. */
  function actionsFor(movement: Movement): MovementActions {
    if (movement.purchase_id || movement.sale_id) {
      return {
        onEdit: () => setStockAction({ mode: 'edit', movement }),
        onVoid: () => setStockAction({ mode: 'void', movement }),
      }
    }
    const target = editTarget(movement, items)
    return {
      onEdit: target ? () => setEditing(target) : undefined,
      onVoid: () => setVoiding(movement.id),
    }
  }

  const jointId = accounts.data?.items.find((account) => account.kind === 'joint')?.id

  /** Pay a partner back for one open row, from joint cash. */
  function payBackItem(item: OpenItem) {
    setPayingBack({
      key: item.movement.id + item.account_id,
      fromAccountId: jointId ?? accounts.data?.items.find((account) => account.id !== item.account_id)?.id,
      toAccountId: item.account_id,
      amount: item.outstanding,
      notes: `Paying back ${item.movement.product_name ?? MOVEMENT_LABELS[item.movement.kind].toLowerCase()}`,
      movementId: item.movement.id,
    })
  }

  /** Pay a partner their whole balance from joint cash. With no single row named, the server
   *  takes it off their oldest open items first, so everything they are owed closes. */
  function payBackAll(account: Account, balance: string) {
    setPayingBack({
      key: 'all' + account.id,
      fromAccountId: jointId ?? accounts.data?.items.find((other) => other.id !== account.id)?.id,
      toAccountId: account.id,
      amount: balance,
      notes: `Paying back ${account.name}`,
    })
  }

  function resetMovementPage() {
    setOffset(0)
  }

  function retry() {
    void accounts.refetch()
    void open.refetch()
    void movements.refetch()
  }

  return (
    <Page title="Money">
      {accounts.data ? (
        <>
          <Row>
            {items.length > 0 ? <Button label="Move money" onPress={() => setTransferFrom(items[0].id)} /> : null}
            <Button label="Put in for shares" onPress={() => setContributing(true)} />
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
                <Copy muted>Personal money the business pays back</Copy>
              </View>
              <View style={{ flex: 1, minWidth: 150 }}>
                <Copy muted>Put in for shares</Copy>
                <Copy>{money(accounts.data.total_contributed)}</Copy>
                <Copy muted>Ownership - never paid back</Copy>
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
            <Copy muted>These balances are different facts and are never added together.</Copy>
          </Card>
          {shownAccounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              onTransfer={() => setTransferFrom(account.id)}
              onAdjust={() => setAdjusting(account)}
              onExpense={() => setExpenseFrom(account.id)}
              actionsFor={actionsFor}
              openItems={openItems.filter((item) => item.account_id === account.id)}
              onPayBackItem={payBackItem}
              onPayBackAll={(balance) => payBackAll(account, balance)}
            />
          ))}
          {spentStores.length > 0 ? (
            <Copy muted>
              {spentStores.length} {spentStores.length === 1 ? 'store has' : 'stores have'} no credit left: {spentStores.map((account) => account.name).join(', ')}
            </Copy>
          ) : null}
        </>
      ) : null}

      {openItems.length > 0 ? (
        <>
          <Copy>Open transactions</Copy>
          <Copy muted>What partners paid for and have not been paid back yet, oldest first. Each partner&apos;s items add up to what they are owed.</Copy>
          {openByPartner.map((group) => (
            <View key={group[0].account_id} style={{ gap: 12 }}>
              <Copy>
                {group[0].account_name} · {group.length} open · {money(sumMoney(group.map((item) => item.outstanding)))}
              </Copy>
              {group.map((item) => (
                <OpenItemCard
                  key={`${item.movement.id}:${item.account_id}`}
                  item={item}
                  onPayBack={() => payBackItem(item)}
                />
              ))}
            </View>
          ))}
        </>
      ) : null}

      <Copy>Movements</Copy>
      <Card>
        <Row>
          <Button
            label={hideVoided ? 'Show voided' : 'Hide voided'}
            onPress={() => {
              setHideVoided(!hideVoided)
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
          <Choice
            label="Account"
            value={accountFilter}
            options={accountOptions}
            onChange={(value) => {
              setAccountFilter(value)
              resetMovementPage()
            }}
          />
        </Row>
      </Card>
      <Copy muted>{movements.data ? `${rows.length} movement${rows.length === 1 ? '' : 's'} shown${movements.data.total > rows.length ? ` of ${movements.data.total}` : ''}.` : 'Loading movements…'}</Copy>
      <ErrorNotice error={accounts.error ?? open.error ?? movements.error} retry={retry} />
      {accounts.isPending || movements.isPending ? <Loading /> : null}
      {movements.data && rows.length === 0 ? (
        <Card>
          <Copy muted>
            {accountFilter || kindFilter || hideVoided
              ? 'No movements match those filters.'
              : 'Nothing has moved yet. Purchases and sales will appear here.'}
          </Copy>
        </Card>
      ) : null}
      {rows.map((movement) => (
        <MovementCard key={movement.id} movement={movement} {...actionsFor(movement)} />
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
      {contributing ? <ContributionDialog accounts={items} onClose={() => setContributing(false)} /> : null}
      {adjusting ? <BalanceAdjustmentDialog account={adjusting} onClose={() => setAdjusting(null)} /> : null}
      {expenseFrom ? <ExpenseDialog from={expenseFrom} onClose={() => setExpenseFrom(null)} /> : null}
      {editing?.kind === 'adjustment' ? (
        <BalanceAdjustmentDialog
          key={editing.id}
          account={editing.account}
          replacing={{ id: editing.id, draft: editing.draft }}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {editing?.kind === 'expense' ? (
        <ExpenseDialog key={editing.id} replacing={{ id: editing.id, edit: editing.edit }} onClose={() => setEditing(null)} />
      ) : null}
      {editing?.kind === 'transfer' ? (
        <TransferDialog
          key={editing.id}
          accounts={items}
          replacing={{ id: editing.id, draft: editing.draft }}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {voiding ? <VoidMovementDialog id={voiding} onClose={() => setVoiding(null)} /> : null}
      {stockAction ? <StockActionDialog key={stockAction.movement.id + stockAction.mode} action={stockAction} onClose={() => setStockAction(null)} /> : null}
      {payingBack && accounts.data ? (
        <TransferDialog
          key={payingBack.key}
          // Every account, not just active ones: a partner who left can still be owed.
          accounts={accounts.data.items}
          from={payingBack.fromAccountId}
          payingBack={payingBack}
          onClose={() => setPayingBack(null)}
        />
      ) : null}
    </Page>
  )
}

export default Money
