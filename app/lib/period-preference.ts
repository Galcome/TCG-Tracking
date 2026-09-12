import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useSyncExternalStore } from 'react'

import type { Period as ApiPeriod } from './api'

/** The single persisted key shared by the native and Expo web builds. */
export const PERIOD_STORAGE_KEY = 'tcg-tracking:period'

/**
 * Keep the supported values and labels aligned with the web client and API contract.
 */
const PERIOD_VALUES = ['all', 'ytd', 'mtd', '30d', '60d', '90d'] as const
export type Period = ApiPeriod
export const DEFAULT_PERIOD: Period = '60d'

export const PERIODS: { value: Period; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'ytd', label: 'Year' },
  { value: 'mtd', label: 'Month' },
  { value: '30d', label: '30 days' },
  { value: '60d', label: '60 days' },
  { value: '90d', label: '90 days' },
]

/** AsyncStorage's small interface makes the state machine straightforward to test. */
export interface PeriodStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export interface PeriodPreferenceSnapshot {
  period: Period
  /** False until the persisted value has been read (or storage has failed). */
  hydrated: boolean
}

export interface PeriodPreferenceStore {
  getSnapshot(): PeriodPreferenceSnapshot
  subscribe(listener: () => void): () => void
  hydrate(): Promise<void>
  setPeriod(period: Period): void
}

/** Runtime validation also protects callers that receive untyped values from a UI adapter. */
export function isPeriod(value: unknown): value is Period {
  return typeof value === 'string' && (PERIOD_VALUES as readonly string[]).includes(value)
}

/**
 * Read the persisted period. A malformed value is removed so it cannot poison the next
 * launch; either kind of storage failure falls back to the default without affecting UI
 * state. AsyncStorage itself is the browser adapter on Expo web, so no window access is
 * needed here.
 */
export async function readStoredPeriod(
  storage: PeriodStorage,
  key = PERIOD_STORAGE_KEY,
): Promise<Period> {
  try {
    const stored = await storage.getItem(key)
    if (isPeriod(stored)) return stored
    if (stored !== null) {
      try {
        await storage.removeItem(key)
      } catch {
        // A failed cleanup must not make the report screens unusable.
      }
    }
  } catch {
    // Private/restricted storage and native bridge failures are best-effort only.
  }
  return DEFAULT_PERIOD
}

/** Best-effort persistence. The caller has already updated its in-memory state. */
export async function writeStoredPeriod(
  storage: PeriodStorage,
  period: Period,
  key = PERIOD_STORAGE_KEY,
): Promise<void> {
  if (!isPeriod(period)) return
  try {
    await storage.setItem(key, period)
  } catch {
    // Keep the selected period in memory when storage is unavailable.
  }
}

/**
 * Create an injectable preference store. A store is deliberately module-local rather than
 * tied to navigation: Dashboard and Sales subscribe to this same instance as they mount
 * and unmount, so changing one screen is visible on the other in the same JS session.
 */
export function createPeriodPreferenceStore(
  storage: PeriodStorage,
  key = PERIOD_STORAGE_KEY,
): PeriodPreferenceStore {
  let snapshot: PeriodPreferenceSnapshot = { period: DEFAULT_PERIOD, hydrated: false }
  let hydration: Promise<void> | undefined
  let localSelection = false
  let writes = Promise.resolve()
  const listeners = new Set<() => void>()

  const notify = () => {
    for (const listener of listeners) listener()
  }

  const setPeriod = (period: Period) => {
    if (!isPeriod(period)) return
    localSelection = true
    if (snapshot.period !== period) {
      snapshot = { ...snapshot, period }
      notify()
    }

    // Serialize writes so a rapid sequence of taps cannot leave an older value on disk.
    writes = writes.then(async () => {
      // Finish invalid-value cleanup before a local selection is persisted, otherwise a
      // late removeItem from hydration could delete the user's newly saved preference.
      await hydrate()
      await writeStoredPeriod(storage, period, key)
    })
  }

  const hydrate = (): Promise<void> => {
    if (snapshot.hydrated) return Promise.resolve()
    if (hydration) return hydration

    hydration = (async () => {
      const hadLocalSelection = localSelection
      const stored = await readStoredPeriod(storage, key)
      if (!hadLocalSelection && !localSelection && snapshot.period !== stored) {
        snapshot = { ...snapshot, period: stored }
      }
      if (!snapshot.hydrated) {
        snapshot = { ...snapshot, hydrated: true }
        notify()
      }
    })()
    return hydration
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    hydrate,
    setPeriod,
  }
}

const defaultStore = createPeriodPreferenceStore(AsyncStorage)

export interface UsePeriodPreferenceResult {
  period: Period
  setPeriod: (period: Period) => void
  hydrated: boolean
}

/**
 * Shared hook for Dashboard, Sales, and the future Reports route. Do not issue a period
 * query until `hydrated` is true; the initial 60-day snapshot is display-only while the
 * persisted value is being loaded.
 *
 * A store argument is optional for unit tests and embedded consumers. Production screens
 * omit it and use the shared app-wide store above.
 */
export function usePeriodPreference(
  store: PeriodPreferenceStore = defaultStore,
): UsePeriodPreferenceResult {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  )

  useEffect(() => {
    void store.hydrate()
  }, [store])

  return { ...snapshot, setPeriod: store.setPeriod }
}
