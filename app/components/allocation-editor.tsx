import type { Account } from '../lib/api'
import { emptyAllocation, type AllocationDraft } from '../lib/allocation-drafts'
import { Button, Card, Choice, Copy, Field } from './ui'
export function AllocationEditor({ rows, onChange, accounts, funding = false, defaultAccount = '', disabled = false }: {
  rows: AllocationDraft[] | null; onChange: (rows: AllocationDraft[] | null) => void; accounts: Account[]
  funding?: boolean; defaultAccount?: string; disabled?: boolean
}) {
  const label = funding ? 'Funding' : 'Proceeds'
  const update = (index: number, changes: Partial<AllocationDraft>) => {
    if (disabled || !rows) return
    onChange(rows.map((row, i) => i === index ? { ...row, ...changes } : row))
  }
  if (!rows) return <Button label={`Split ${label.toLowerCase()}`} disabled={disabled} onPress={() => onChange([emptyAllocation(defaultAccount), emptyAllocation()])} />
  return <Card>
    <Copy>{label} split · decimal CAD</Copy>
    <Copy muted>{funding ? 'Allocate the entire paid amount plus shipping, tax and fees.' : 'Allocate the server-previewed net payout after fees. Store credit is not cash.'} This never calculates FIFO cost or profit.</Copy>
    {rows.map((row, index) => <Card key={index}>
      {!funding ? <Choice disabled={disabled} label={`${label} ${index + 1} kind`} value={row.kind} options={[{value:'account',label:'Existing account'},{value:'store',label:'New store credit'}]} onChange={value => update(index, {kind:value as AllocationDraft['kind']})} /> : null}
      {row.kind === 'account' ? <Choice disabled={disabled} label={`${label} ${index + 1} account`} value={row.accountId}
        options={[{value:'',label:'Choose account'}, ...accounts.map(account => ({value:account.id,label:account.name}))]} onChange={value => update(index,{accountId:value})} />
        : <Field label={`${label} ${index + 1} store`} value={row.store} onChangeText={value => update(index,{store:value})} editable={!disabled} />}
      <Field label={`${label} ${index + 1} amount`} value={row.amount} onChangeText={value => update(index,{amount:value})} editable={!disabled} keyboardType="decimal-pad" />
      <Button label={`Remove ${label.toLowerCase()} ${index + 1}`} disabled={disabled || rows.length === 1} onPress={() => onChange(rows.filter((_, i) => i !== index))} />
    </Card>)}
    <Button label={`Add ${label.toLowerCase()} destination`} disabled={disabled || rows.length >= 20} onPress={() => onChange([...rows,emptyAllocation()])} />
    <Button label={`Use single ${label.toLowerCase()} destination`} disabled={disabled} onPress={() => onChange(null)} />
  </Card>
}
