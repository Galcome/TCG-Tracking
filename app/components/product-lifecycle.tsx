import { useMutation, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { useApi } from '../context/AppContext'
import type { Product } from '../lib/api'
import { Button, Card, Copy, ErrorNotice, Row, Sheet } from './ui'

export function ProductLifecycle({ product }: { product: Product }) {
  const api = useApi()
  const queries = useQueryClient()
  const [mode, setMode] = useState<'archive' | 'delete' | null>(null)
  const running = useRef(false)
  const change = useMutation({
    mutationFn: async (action: 'archive' | 'delete') => {
      if (action === 'delete') await api.deleteProduct(product.id)
      else await api.updateProduct(product.id, { is_archived: !product.is_archived })
    },
    onSuccess: (_, action) => {
      setMode(null)
      void queries.invalidateQueries()
      if (action === 'delete' || !product.is_archived) router.replace('/inventory')
    },
    onSettled: () => { running.current = false },
  })
  // No confirmation: hiding changes nothing but visibility and is one tap to undo.
  const hide = useMutation({
    mutationFn: () => api.updateProduct(product.id, { is_hidden: !product.is_hidden }),
    onSuccess: () => { void queries.invalidateQueries() },
  })
  function open(next: 'archive' | 'delete') { change.reset(); setMode(next) }
  function submit() {
    if (!mode || running.current) return
    running.current = true
    change.mutate(mode)
  }
  return <Card>
    <Copy>Catalogue management</Copy>
    <Copy muted>Archive hides a product and keeps its numbers. Delete is for tests and mistakes: it removes the product and everything recorded against it.</Copy>
    <Copy muted>{product.is_hidden ? 'Hidden: left off the stock list and the on-shelf totals. Still owned and sellable.' : 'Hide keeps the stock but leaves it off the stock list and the on-shelf totals.'}</Copy>
    <ErrorNotice error={hide.error} />
    <Row><Button label={product.is_hidden ? 'Unhide product' : 'Hide product'} disabled={hide.isPending} onPress={() => hide.mutate()} />
      <Button label={product.is_archived ? 'Restore archived product' : 'Archive product'} onPress={() => open('archive')} />
      <Button label="Delete product" danger onPress={() => open('delete')} /></Row>
    {mode ? <Sheet title={mode === 'delete' ? 'Delete product' : product.is_archived ? 'Restore product' : 'Archive product'} open dismissDisabled={change.isPending} onClose={() => { if (!running.current) setMode(null) }}>
      <Copy>{product.name}</Copy>
      <Copy muted>{mode === 'delete' ? 'Removes it along with every purchase, sale and move recorded against it, voided ones included, and the money those moved. A log of what was removed is kept. This cannot be undone.' : 'Only catalogue visibility changes. Stock, cost, valuations and transaction history remain intact.'}</Copy>
      <ErrorNotice error={change.error} />
      <Button label={change.isPending ? 'Saving…' : mode === 'delete' ? 'Delete' : product.is_archived ? 'Confirm restore' : 'Confirm archive'} danger={mode === 'delete'} disabled={change.isPending} onPress={submit} />
    </Sheet> : null}
  </Card>
}
