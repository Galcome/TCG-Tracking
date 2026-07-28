import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { api, type NewProduct as NewProductPayload } from '../api'

/**
 * Only name, game and type are required. Everything else sits behind Advanced so
 * the routine path stays short.
 */
export function NewProduct() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const games = useQuery({ queryKey: ['games'], queryFn: api.games })
  const productTypes = useQuery({ queryKey: ['productTypes'], queryFn: api.productTypes })

  const [name, setName] = useState('')
  const [pickedGameId, setGameId] = useState('')
  const [pickedProductTypeId, setProductTypeId] = useState('')
  const [setName_, setSetName] = useState('')
  const [storageLocation, setStorageLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Default to the first option so the common case is one tap fewer. Derived rather
  // than synced into state via an effect, which would cascade renders.
  const gameId = pickedGameId || games.data?.[0]?.id || ''
  const productTypeId = pickedProductTypeId || productTypes.data?.[0]?.id || ''

  const create = useMutation({
    mutationFn: (payload: NewProductPayload) => api.createProduct(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['products'] })
      navigate('/')
    },
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    create.mutate({
      name: name.trim(),
      game_id: gameId,
      product_type_id: productTypeId,
      ...(setName_.trim() ? { set_name: setName_.trim() } : {}),
      ...(storageLocation.trim() ? { storage_location: storageLocation.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    })
  }

  const fieldClass =
    'mt-1 w-full rounded-lg border border-(--color-edge) bg-(--color-surface) px-3 py-3 text-base outline-none focus:border-(--color-accent)'

  return (
    <form onSubmit={onSubmit} className="space-y-4 p-4 pb-28">
      <h1 className="text-xl font-semibold">Add product</h1>

      <label className="block">
        <span className="text-sm text-(--color-muted)">Name</span>
        <input
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Vivid Voltage Booster Box"
          className={fieldClass}
        />
      </label>

      <label className="block">
        <span className="text-sm text-(--color-muted)">Game</span>
        <select
          value={gameId}
          onChange={(e) => setGameId(e.target.value)}
          className={fieldClass}
        >
          {games.data?.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-sm text-(--color-muted)">Product type</span>
        <select
          value={productTypeId}
          onChange={(e) => setProductTypeId(e.target.value)}
          className={fieldClass}
        >
          {productTypes.data?.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={() => setShowAdvanced((open) => !open)}
        className="text-sm text-(--color-accent)"
      >
        {showAdvanced ? 'Hide' : 'Show'} advanced
      </button>

      {showAdvanced && (
        <div className="space-y-4 border-t border-(--color-edge) pt-4">
          <label className="block">
            <span className="text-sm text-(--color-muted)">Set</span>
            <input value={setName_} onChange={(e) => setSetName(e.target.value)} className={fieldClass} />
          </label>
          <label className="block">
            <span className="text-sm text-(--color-muted)">Storage location</span>
            <input
              value={storageLocation}
              onChange={(e) => setStorageLocation(e.target.value)}
              className={fieldClass}
            />
          </label>
          <label className="block">
            <span className="text-sm text-(--color-muted)">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className={fieldClass}
            />
          </label>
        </div>
      )}

      {create.isError && <p className="text-sm text-red-400">{(create.error as Error).message}</p>}

      <div className="fixed inset-x-4 bottom-6 mx-auto flex max-w-md gap-3">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex-1 rounded-xl border border-(--color-edge) px-4 py-4 font-medium"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={create.isPending || !name.trim() || !gameId || !productTypeId}
          className="flex-1 rounded-xl bg-(--color-accent) px-4 py-4 font-medium text-(--color-ink) shadow-lg disabled:opacity-50"
        >
          {create.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
