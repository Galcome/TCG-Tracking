import { useState } from 'react'
import { View } from 'react-native'
import { Button, Choice, Sheet } from './ui'
import {
  DEFAULT_PERIOD,
  isPeriod,
  PERIODS,
  type Period,
} from '../lib/period-preference'

export interface PeriodSelectorProps {
  value: Period
  onChange: (period: Period) => void
  compact?: boolean
}

/**
 * Accessible shared period control for Dashboard, Sales, and Reports. Choice exposes the
 * current value through its labelled button and each option with its exact visible label.
 */
export function PeriodSelector({ value, onChange, compact = false }: PeriodSelectorProps) {
  const [open, setOpen] = useState(false)
  const safeValue = isPeriod(value) ? value : DEFAULT_PERIOD
  if (compact) return <View style={{ alignSelf: 'flex-start' }}>
    <Button label={`Reporting period: ${PERIODS.find(period => period.value === safeValue)?.label ?? safeValue}`} onPress={() => setOpen(true)} />
    <Sheet title="Reporting period" open={open} onClose={() => setOpen(false)}>{PERIODS.map(period => <Button key={period.value} label={period.label} onPress={() => { if (isPeriod(period.value)) onChange(period.value); setOpen(false) }} />)}</Sheet>
  </View>
  return (
    <Choice
      label="Reporting period"
      value={safeValue}
      options={PERIODS}
      onChange={(next) => {
        if (isPeriod(next)) onChange(next)
      }}
    />
  )
}

export { DEFAULT_PERIOD, isPeriod, PERIODS }
export type { Period }
