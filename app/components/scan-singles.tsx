import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { useApi } from '../context/AppContext'
import { BUCKETS, BUCKET_LABELS, type Bucket } from '../lib/api'
import { todayIso } from '../lib/format'
import { ripHitProductType } from '../lib/rip-drafts'
import { lineTotal, matchingProduct, scanReadyError, type ScanItem } from '../lib/scan-session'
import { CardScanner } from './card-scanner'
import { Button, Choice, Copy, ErrorNotice, Loading, Sheet } from './ui'

/**
 * Scan a stack of singles into stock, Collectr-style. Each card becomes a purchase at the
 * price shown - the market price unless changed - on the product already on file for that
 * card, or a new raw single mapped to the listing it was priced from so it keeps a value.
 */
export function ScanSinglesDialog({ onClose }: { onClose: () => void }) {
  const api = useApi()
  const queryClient = useQueryClient()
  const games = useQuery({ queryKey: ['games'], queryFn: api.games })
  const types = useQuery({ queryKey: ['productTypes'], queryFn: api.productTypes })
  const [gameId, setGameId] = useState('')
  const [bucket, setBucket] = useState<Bucket>('inventory')
  const [scanning, setScanning] = useState(false)
  const game = gameId || games.data?.[0]?.id || ''
  const singleType = ripHitProductType(types.data)

  async function add(item: ScanItem, purchaseDate: string) {
    const amount = lineTotal(item)
    if (!singleType || amount === null) throw new Error(`Enter a price for ${item.name}.`)
    const purchase = { quantity: item.quantity, amount, bucket, purchase_date: purchaseDate }
    const existing = matchingProduct(await api.productCandidates({
      game_id: game,
      name: item.name,
      ...(item.setName ? { set_name: item.setName } : {}),
      ...(item.collectorNumber ? { collector_number: item.collectorNumber } : {}),
    }), item)
    if (existing) {
      await api.createPurchase({ product_id: existing.id, ...purchase })
      return
    }
    const product = await api.createProduct({
      name: item.name,
      game_id: game,
      product_type_id: singleType.id,
      set_name: item.setName || null,
      collector_number: item.collectorNumber || null,
      variant: item.variant || null,
      language: item.language || null,
      initial_purchase: purchase,
    }) as { id: string }
    if (!item.listing) return
    // The stock is already recorded; a mapping that fails only means no automatic value yet.
    await api.createPricingMapping({
      product_id: product.id,
      external_product_id: String(item.listing.productId),
      external_group_id: String(item.listing.groupId),
      external_category_id: String(item.listing.categoryId),
      subtype_name: item.listing.subtype,
    }).catch(() => undefined)
  }

  async function addAll(items: ScanItem[], settled: (key: string) => void) {
    const purchaseDate = todayIso()
    try {
      for (const item of items) {
        await add(item, purchaseDate)
        settled(item.key)
      }
    } finally {
      await queryClient.invalidateQueries()
    }
    onClose()
  }

  if (scanning) {
    return <CardScanner
      open
      gameId={game}
      title={`Scan singles into ${BUCKET_LABELS[bucket]}`}
      doneLabel="Add to stock"
      validate={scanReadyError}
      onDone={addAll}
      onClose={() => setScanning(false)}
    />
  }

  return <Sheet title="Scan singles" open compact onClose={onClose}>
    {games.isPending || types.isPending ? <Loading /> : null}
    <ErrorNotice error={games.error ?? types.error} retry={() => { void games.refetch(); void types.refetch() }} />
    {games.data ? <>
      <Choice label="Game" value={game} options={games.data.map((item) => ({ value: item.id, label: item.name }))} onChange={setGameId} />
      <Choice label="Add to" value={bucket} options={BUCKETS.map((item) => ({ value: item, label: BUCKET_LABELS[item] }))} onChange={(value) => setBucket(value as Bucket)} />
      <Copy muted>
        Each card is priced from TCGplayer in CAD. That price is what the purchase records unless
        you change it, so set it to what you paid. Cards already on file get another purchase.
      </Copy>
      {!singleType && types.data ? <Copy muted>No single product type is set up, so cards cannot be added.</Copy> : null}
      <Button variant="primary" label="Start scanning" disabled={!game || !singleType} onPress={() => setScanning(true)} />
    </> : null}
  </Sheet>
}
