import { Choice } from './ui'
import {
  DEFAULT_PERIOD,
  isPeriod,
  PERIODS,
  type Period,
} from '../lib/period-preference'

export interface PeriodSelectorProps {
  value: Period
  onChange: (period: Period) => void
}

/**
 * Accessible shared period control for Dashboard, Sales, and Reports. Choice exposes the
 * current value through its labelled button and each option with its exact visible label.
 */
export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  const safeValue = isPeriod(value) ? value : DEFAULT_PERIOD
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
