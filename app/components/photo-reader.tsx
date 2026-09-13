import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useApi } from '../context/AppContext'
import type { ReadCard } from '../lib/api'
import { photoBody } from '../lib/photo'
import { canCapturePhoto, pickPhotos } from '../lib/photo-picker'
import { Button, Card, Copy, ErrorNotice, Row } from './ui'

export function PhotoReader({ disabled, onCards, onBusy }: {
  disabled: boolean; onCards: (cards: ReadCard[]) => void; onBusy: (busy: boolean) => void
}) {
  const api = useApi()
  const status = useQuery({ queryKey: ['visionStatus'], queryFn: api.visionStatus })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [message, setMessage] = useState('')
  const alive = useRef(true)
  const running = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  async function read(camera = false) {
    if (running.current || disabled) return
    running.current = true
    setError(null)
    try {
      const photos = await pickPhotos(camera)
      if (!alive.current || !photos.length) return
      setBusy(true)
      onBusy(true)
      let count = 0
      for (const photo of photos) {
        const result = await api.readCards(photoBody(photo))
        if (!alive.current) return
        if (!result.available) throw new Error('Photo reading is unavailable. Continue with manual entry.')
        onCards(result.cards)
        count += result.cards.length
        setMessage(`${count} identity suggestion${count === 1 ? '' : 's'} added. Review every field and choose Reuse or Create.`)
      }
      if (!count) setMessage('No cards identified. Continue with manual entry or try another photo.')
    } catch (failure) {
      if (alive.current) setError(failure)
    } finally {
      running.current = false
      if (alive.current) { setBusy(false); onBusy(false) }
    }
  }

  return <Card>
    <Copy>Photo-assisted identity</Copy>
    <Copy muted>Up to five photos, 6 MiB each. Suggestions never set prices or save inventory. Manual entry always works.</Copy>
    {status.isError ? <ErrorNotice error={status.error} retry={() => { void status.refetch() }} /> : null}
    {status.data?.available ? <Row>
      <Button label={busy ? 'Reading photos…' : 'Choose photos'} disabled={disabled || busy} onPress={() => { void read() }} />
      {canCapturePhoto ? <Button label="Take photo" disabled={disabled || busy} onPress={() => { void read(true) }} /> : null}
    </Row> : <Copy muted>{status.isPending ? 'Checking photo reader…' : 'Photo reader unavailable; enter hits manually.'}</Copy>}
    {message ? <Copy muted>{message}</Copy> : null}
    {error ? <ErrorNotice error={error} /> : null}
  </Card>
}
