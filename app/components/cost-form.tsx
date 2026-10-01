import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Pressable, Text } from 'react-native'

import { useApi } from '../context/AppContext'
import { colors } from '../context/ThemeContext'
import { useTypography } from '../context/TypographyContext'
import { MAX_INDIVIDUAL_UNITS, costChanges, costError, costUnits, openPurchases, type CostChange } from '../lib/cost-drafts'
import { Button, Copy, ErrorNotice, Field, Loading, Row, Sheet } from './ui'

function Checkbox({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  const fonts = useTypography()
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, opacity: disabled ? 0.6 : 1 }}
    >
      <Text accessible={false} style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: checked ? colors.accent : colors.edge, backgroundColor: checked ? colors.accent : 'transparent', color: colors.background, textAlign: 'center', lineHeight: 22, fontWeight: '700' }}>{checked ? '✓' : ''}</Text>
      <Text style={{ color: colors.text, fontFamily: fonts.medium, fontSize: 15, flexShrink: 1 }}>{label}</Text>
    </Pressable>
  )
}

/** What each unit on hand cost, one field per unit, or one price ticked for all of them. */
export function EditCostDialog({ product, onClose }: { product: { id: string; name: string }; onClose: () => void }) {
  const api = useApi()
  const queryClient = useQueryClient()
  const detail = useQuery({ queryKey: ['product', product.id], queryFn: () => api.product(product.id) })
  const purchases = detail.data ? openPurchases(detail.data.history) : []
  const units = costUnits(purchases)
  const tooMany = units.length > MAX_INDIVIDUAL_UNITS
  // Only what was typed is kept, by unit position; untouched units keep what they cost.
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [sameForAll, setSameForAll] = useState(false)
  const [invalid, setInvalid] = useState<string | null>(null)
  const same = units.length > 1 && (tooMany || sameForAll)
  const costs = units.map((unit, index) => (same ? drafts[0] ?? units[0].cost : drafts[index] ?? unit.cost))

  const save = useMutation({
    mutationFn: async (changes: CostChange[]) => {
      try {
        for (const change of changes) {
          if (change.kind === 'total') await api.updatePurchase(change.purchaseId, { amount: change.amount })
          else await api.setPurchaseUnitCosts(change.purchaseId, change.unitCosts)
        }
      } finally {
        await queryClient.invalidateQueries()
      }
    },
    onSuccess: onClose,
    // A failure part-way leaves earlier purchases already repriced and re-split, so the
    // typed rows no longer line up with the units; start again from what was saved.
    onError: () => setDrafts({}),
  })
  const busy = save.isPending

  function submit() {
    const error = costError(costs)
    setInvalid(error)
    if (error) return
    // Nothing typed and nothing ticked is a plain close, even when one price is forced.
    const touched = sameForAll || Object.keys(drafts).length > 0
    const changes = touched ? costChanges(units, costs) : []
    if (changes.length === 0) onClose()
    else save.mutate(changes)
  }

  const footer = units.length > 0 ? (
    <>
      {invalid ? <ErrorNotice error={new Error(invalid)} /> : null}
      {save.error ? <ErrorNotice error={save.error} /> : null}
      <Button label={busy ? 'Saving…' : 'Save cost'} disabled={busy} onPress={submit} variant="primary" />
    </>
  ) : undefined

  return (
    <Sheet title={`Edit cost — ${product.name}`} open onClose={onClose} dismissDisabled={busy} footer={footer}>
      <ErrorNotice error={detail.error} retry={() => { void detail.refetch() }} />
      {detail.isPending ? <Loading /> : null}
      {detail.data && units.length === 0 ? <Copy muted>Nothing here was bought directly, so there is no purchase cost to edit.</Copy> : null}
      {units.length > 0 ? (
        <>
          <Copy muted>What each unit cost, before shipping, tax and fees.</Copy>
          {units.length > 1 ? (
            <Checkbox
              label={`Same price for all ${units.length}`}
              checked={same}
              disabled={tooMany || busy}
              onChange={setSameForAll}
            />
          ) : null}
          <Row>
            {units.map((unit, index) => (same && index > 0 ? null : (
              <Field
                key={index}
                label={same || units.length === 1 ? 'Cost per unit' : `Unit ${index + 1}${purchases.length > 1 ? ` · bought ${purchases.find((purchase) => purchase.id === unit.purchaseId)?.occurred_on ?? 'undated'}` : ''}`}
                value={drafts[index] ?? (unit.cost === '0.00' ? '' : unit.cost)}
                onChangeText={(value) => setDrafts((current) => ({ ...current, [index]: value }))}
                keyboardType="decimal-pad"
                placeholder="0.00"
                selectTextOnFocus
                autoFocus={index === 0}
                editable={!busy}
              />
            )))}
          </Row>
        </>
      ) : null}
    </Sheet>
  )
}
