import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createPeriodPreferenceStore,
  DEFAULT_PERIOD,
  isPeriod,
  PERIOD_STORAGE_KEY,
  readStoredPeriod,
  writeStoredPeriod,
  type PeriodStorage,
} from '../lib/period-preference.ts'

function memoryStorage(initial: string | null = null) {
  let value = initial
  const calls: string[] = []
  const storage: PeriodStorage = {
    async getItem(key) {
      calls.push(`get:${key}`)
      return value
    },
    async setItem(key, next) {
      calls.push(`set:${key}:${next}`)
      value = next
    },
    async removeItem(key) {
      calls.push(`remove:${key}`)
      value = null
    },
  }
  return { storage, calls, get value() { return value } }
}

test('recognizes all supported periods and defaults to 60 days', () => {
  assert.equal(DEFAULT_PERIOD, '60d')
  for (const value of ['all', 'ytd', 'mtd', '30d', '60d', '90d']) {
    assert.equal(isPeriod(value), true)
  }
  assert.equal(isPeriod('not-a-period'), false)
  assert.equal(isPeriod(null), false)
})

test('reads a valid value and removes invalid persisted values', async () => {
  const valid = memoryStorage('90d')
  assert.equal(await readStoredPeriod(valid.storage), '90d')
  assert.deepEqual(valid.calls, [`get:${PERIOD_STORAGE_KEY}`])

  const invalid = memoryStorage('old-format')
  assert.equal(await readStoredPeriod(invalid.storage), DEFAULT_PERIOD)
  assert.deepEqual(invalid.calls, [`get:${PERIOD_STORAGE_KEY}`, `remove:${PERIOD_STORAGE_KEY}`])
  assert.equal(invalid.value, null)
})

test('storage failures fall back and leave writes best effort', async () => {
  const failing: PeriodStorage = {
    async getItem() { throw new Error('read failed') },
    async setItem() { throw new Error('write failed') },
    async removeItem() { throw new Error('remove failed') },
  }
  assert.equal(await readStoredPeriod(failing), DEFAULT_PERIOD)
  await assert.doesNotReject(writeStoredPeriod(failing, '90d'))

  const store = createPeriodPreferenceStore(failing)
  store.setPeriod('30d')
  assert.equal(store.getSnapshot().period, '30d')
  await store.hydrate()
  assert.deepEqual(store.getSnapshot(), { period: '30d', hydrated: true })
})

test('a store synchronizes subscribers and does not let hydration overwrite a local choice', async () => {
  const persisted = memoryStorage('90d')
  const store = createPeriodPreferenceStore(persisted.storage)
  const snapshots: string[] = []
  const unsubscribe = store.subscribe(() => {
    const snapshot = store.getSnapshot()
    snapshots.push(`${snapshot.period}:${snapshot.hydrated}`)
  })

  const hydration = store.hydrate()
  store.setPeriod('30d')
  await hydration
  assert.deepEqual(store.getSnapshot(), { period: '30d', hydrated: true })
  assert.deepEqual(snapshots, ['30d:false', '30d:true'])

  unsubscribe()
  store.setPeriod('60d')
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(persisted.value, '60d')
})

test('a persisted value is applied only after hydration', async () => {
  let resolveRead: ((value: string | null) => void) | undefined
  const storage: PeriodStorage = {
    getItem: async () => new Promise((resolve) => { resolveRead = resolve }),
    setItem: async () => undefined,
    removeItem: async () => undefined,
  }
  const store = createPeriodPreferenceStore(storage)
  const hydration = store.hydrate()
  assert.deepEqual(store.getSnapshot(), { period: DEFAULT_PERIOD, hydrated: false })
  resolveRead?.('90d')
  await hydration
  assert.deepEqual(store.getSnapshot(), { period: '90d', hydrated: true })
})

test('invalid hydration cleanup finishes before rapid local selections are persisted', async () => {
  let resolveRead: (value: string | null) => void = () => undefined
  const calls: string[] = []
  const storage: PeriodStorage = {
    getItem: () => new Promise((resolve) => { resolveRead = resolve }),
    async setItem(_key, value) { calls.push(`set:${value}`) },
    async removeItem() { calls.push('remove') },
  }
  const store = createPeriodPreferenceStore(storage)
  const hydration = store.hydrate()
  store.setPeriod('30d')
  store.setPeriod('90d')
  resolveRead('invalid')
  await hydration
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(calls, ['remove', 'set:30d', 'set:90d'])
  assert.deepEqual(store.getSnapshot(), { period: '90d', hydrated: true })
})
