import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { useApi } from '../context/AppContext'
import type { ProductDetail, Valuation } from '../lib/api'
import { money } from '../lib/format'
import { Button, Card, Copy, ErrorNotice, Field, Row, Sheet } from './ui'
import { RecordValuationDialog } from './valuation-form'

/** Every valuation recorded for a product, newest first, each one correctable or removable. */
export function ProductValuations({ product }: { product: ProductDetail }) {
  const api = useApi()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Valuation | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const valuations = useQuery({
    queryKey: ['valuations', product.id],
    queryFn: () => api.valuations(product.id),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteValuation(id),
    onSuccess: async () => {
      setRemoving(null)
      await queryClient.invalidateQueries()
    },
  })

  if (!valuations.data?.length) {
    return valuations.error ? <ErrorNotice error={valuations.error} retry={() => { void valuations.refetch() }} /> : null
  }
  return (
    <>
      <Copy muted>Recorded valuations</Copy>
      <ErrorNotice error={remove.error} />
      {valuations.data.map((valuation) => (
        <Card key={valuation.id}>
          <Copy>{money(valuation.value)} / unit · {valuation.captured_on}</Copy>
          {valuation.notes ? <Copy muted>{valuation.notes}</Copy> : null}
          <Row>
            <Button label="Edit" disabled={remove.isPending} onPress={() => setEditing(valuation)} />
            <Button
              label={removing === valuation.id ? 'Tap again to remove' : 'Remove'}
              danger
              disabled={remove.isPending}
              onPress={() => (removing === valuation.id ? remove.mutate(valuation.id) : setRemoving(valuation.id))}
            />
          </Row>
        </Card>
      ))}
      {editing ? (
        <RecordValuationDialog key={editing.id} product={product} editing={editing} onClose={() => setEditing(null)} />
      ) : null}
    </>
  )
}

interface Renaming {
  title: string
  /** Said under the field, because a rename reaches every product that uses the name. */
  reach: string
  current: string
  run: (name: string) => Promise<unknown>
}

function RenameDialog({ renaming, onClose }: { renaming: Renaming; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(renaming.current)
  const rename = useMutation({
    mutationFn: (next: string) => renaming.run(next),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      onClose()
    },
  })
  const trimmed = name.trim()

  function submit() {
    if (rename.isPending || !trimmed) return
    if (trimmed === renaming.current) {
      onClose()
      return
    }
    rename.mutate(trimmed)
  }

  return (
    <Sheet title={renaming.title} open onClose={onClose} dismissDisabled={rename.isPending} compact>
      <Field label="Name" value={name} onChangeText={setName} editable={!rename.isPending} autoFocus onSubmitEditing={submit} />
      <Copy muted>{renaming.reach}</Copy>
      <ErrorNotice error={rename.error} />
      <Button label={rename.isPending ? 'Saving…' : 'Save name'} variant="primary" disabled={rename.isPending || !trimmed} onPress={submit} />
    </Sheet>
  )
}

/** Rename the game, product type or set this product belongs to, everywhere it is used. */
export function RenameActions({ product }: { product: ProductDetail }) {
  const api = useApi()
  const [renaming, setRenaming] = useState<Renaming | null>(null)
  const setId = product.set_id
  return (
    <>
      <Row>
        <Button
          label="Rename game"
          onPress={() => setRenaming({
            title: 'Rename game',
            reach: 'Changes the name on every product in this game.',
            current: product.game.name,
            run: (name) => api.renameGame(product.game.id, name),
          })}
        />
        <Button
          label="Rename type"
          onPress={() => setRenaming({
            title: 'Rename product type',
            reach: 'Changes the name on every product of this type.',
            current: product.product_type.name,
            run: (name) => api.renameProductType(product.product_type.id, name),
          })}
        />
        {setId && product.set_name ? (
          <Button
            label="Rename set"
            onPress={() => setRenaming({
              title: 'Rename set',
              reach: 'Changes the set on every product in it. Product names are left as they are.',
              current: product.set_name ?? '',
              run: (name) => api.renameSet(setId, name),
            })}
          />
        ) : null}
      </Row>
      {renaming ? <RenameDialog key={renaming.title} renaming={renaming} onClose={() => setRenaming(null)} /> : null}
    </>
  )
}
