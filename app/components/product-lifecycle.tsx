import { useMutation, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { useApi } from '../context/AppContext'
import type { Product } from '../lib/api'
import { Button, Card, Copy, ErrorNotice, Field, Row, Sheet } from './ui'

export function ProductLifecycle({ product }: { product: Product }) {
  const api = useApi()
  const queries = useQueryClient()
  const [mode, setMode] = useState<'archive' | 'delete' | null>(null)
  const [confirmation, setConfirmation] = useState('')
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
  function open(next: 'archive' | 'delete') { change.reset(); setConfirmation(''); setMode(next) }
  function submit() {
    if (!mode || running.current || (mode === 'delete' && confirmation !== 'DELETE')) return
    running.current = true
    change.mutate(mode)
  }
  return <Card>
    <Copy>Catalogue management</Copy>
    <Copy muted>Archive hides a product without changing stock or losing financial history. Deletion is only for mistaken products with no history; the API enforces this even for voided transactions.</Copy>
    <Row><Button label={product.is_archived ? 'Restore archived product' : 'Archive product'} onPress={() => open('archive')} />
      <Button label="Delete mistaken product" danger onPress={() => open('delete')} /></Row>
    {mode ? <Sheet title={mode === 'delete' ? 'Delete product permanently' : product.is_archived ? 'Restore product' : 'Archive product'} open dismissDisabled={change.isPending} onClose={() => { if (!running.current) setMode(null) }}>
      <Copy>{product.name}</Copy>
      <Copy muted>{mode === 'delete' ? 'This cannot be undone. Transaction history prevents deletion; archive instead if this product has been used.' : 'Only catalogue visibility changes. Stock, cost, valuations and transaction history remain intact.'}</Copy>
      {mode === 'delete' ? <Field label="Type DELETE to confirm" value={confirmation} onChangeText={setConfirmation} editable={!change.isPending} /> : null}
      <ErrorNotice error={change.error} />
      <Button label={change.isPending ? 'Saving…' : mode === 'delete' ? 'Permanently delete' : product.is_archived ? 'Confirm restore' : 'Confirm archive'} danger={mode === 'delete'} disabled={change.isPending || (mode === 'delete' && confirmation !== 'DELETE')} onPress={submit} />
    </Sheet> : null}
  </Card>
}
