import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { Button, ErrorNotice } from './ui'
import type { CsvDocument } from '../lib/csv'
import { exportCsv } from '../lib/csv-export'

export function CsvButton({ label, create, disabled = false }: {
  label: string; create: () => CsvDocument | Promise<CsvDocument>; disabled?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const running = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  async function run() {
    if (running.current || disabled) return
    running.current = true
    setBusy(true)
    setError(null)
    try {
      const csv = await create()
      if (alive.current) await exportCsv(csv)
    } catch (failure) {
      if (alive.current) setError(failure)
    } finally {
      running.current = false
      if (alive.current) setBusy(false)
    }
  }
  return <View style={{ gap: 8 }}>
    <Button label={busy ? 'Collecting CSV…' : label} disabled={disabled || busy} onPress={() => { void run() }} />
    <ErrorNotice error={error} />
  </View>
}
