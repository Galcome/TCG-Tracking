import { useCallback, useState } from 'react'

import type { Period } from '../api'

export const PERIODS: { value: Period; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'ytd', label: 'Year' },
  { value: 'mtd', label: 'Month' },
  { value: '30d', label: '30 days' },
  { value: '60d', label: '60 days' },
  { value: '90d', label: '90 days' },
]

export const DEFAULT_PERIOD: Period = '60d'
export const PERIOD_STORAGE_KEY = 'tcg-tracking:period'

export function isPeriod(value: string | null): value is Period {
  return PERIODS.some((option) => option.value === value)
}

function readStoredPeriod(): Period {
  if (typeof window === 'undefined') return DEFAULT_PERIOD

  try {
    const stored = window.localStorage.getItem(PERIOD_STORAGE_KEY)
    if (isPeriod(stored)) return stored
    if (stored !== null) window.localStorage.removeItem(PERIOD_STORAGE_KEY)
  } catch {
    // Browser storage can be unavailable in private browsing or restrictive webviews. The
    // dashboard still works with the default and the in-memory selection in that case.
  }

  return DEFAULT_PERIOD
}

/** One preference keeps the dashboard, reports, and sales period controls in sync. */
export function usePeriodPreference(): [Period, (period: Period) => void] {
  const [period, setPeriod] = useState<Period>(readStoredPeriod)

  const choosePeriod = useCallback((next: Period) => {
    setPeriod(next)
    try {
      window.localStorage.setItem(PERIOD_STORAGE_KEY, next)
    } catch {
      // Keep the current page usable when storage is blocked; persistence is best effort.
    }
  }, [])

  return [period, choosePeriod]
}

export function PeriodSelector({
  value,
  onChange,
}: {
  value: Period
  onChange: (period: Period) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="reporting-period"
        className="text-xs font-semibold uppercase tracking-wide text-(--color-faint) sm:hidden"
      >
        Period
      </label>

      <select
        id="reporting-period"
        aria-label="Reporting period"
        value={value}
        onChange={(event) => {
          if (isPeriod(event.target.value)) onChange(event.target.value)
        }}
        className="w-36 rounded-full border border-(--color-edge) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text) outline-none focus:border-(--color-accent) sm:hidden"
      >
        {PERIODS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <div
        role="group"
        aria-label="Reporting period"
        className="hidden gap-1 rounded-full border border-(--color-edge) bg-(--color-surface)/70 p-[3px] sm:flex"
      >
        {PERIODS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`rounded-full px-3.5 py-1.5 text-[0.8125rem] transition-colors ${
              value === option.value
                ? 'bg-(--color-accent) font-medium text-(--color-ink)'
                : 'text-(--color-muted) hover:text-(--color-text)'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
