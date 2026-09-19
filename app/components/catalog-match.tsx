import { useMutation } from '@tanstack/react-query'

import { useApi } from '../context/AppContext'
import type { CardLookupInput, PricedListing } from '../lib/api'
import { money } from '../lib/format'
import { Button, Card, Copy, ErrorNotice } from './ui'

function describe(row: PricedListing): string {
  const printing = row.subtype === 'Normal' ? null : row.subtype
  const number = row.listing.number ? '#' + row.listing.number : null
  return [row.listing.name, number, printing].filter(Boolean).join(' · ')
}

/**
 * Look the product up in the free price catalog before saving it. Picking a listing fills
 * the identity and, once saved, maps the product so the daily refresh prices it. Nothing is
 * written here, and the market figure is shown for reference only - never used as cost.
 */
export function CatalogMatch({ input, picked, onPick }: {
  /** Null until a game, set and name are known. */
  input: CardLookupInput | null
  picked: PricedListing | null
  onPick: (row: PricedListing | null) => void
}) {
  const api = useApi()
  const lookup = useMutation({ mutationFn: api.lookupCard })
  if (picked) {
    return <Card>
      <Copy>Catalog match: {describe(picked)}</Copy>
      <Copy muted>Market {picked.market == null ? 'unavailable today' : money(picked.market)} · priced daily once saved</Copy>
      <Button variant="link" label="Clear catalog match" onPress={() => { onPick(null); lookup.reset() }} />
    </Card>
  }
  const found = lookup.data
  return <>
    <Button label="Find in price catalog" disabled={!input || lookup.isPending}
      onPress={() => { if (input) lookup.mutate(input) }} />
    {!input ? <Copy muted>Pick a set and name to look it up.</Copy> : null}
    <ErrorNotice error={lookup.error} />
    {found?.message ? <Copy muted>{found.message}</Copy> : null}
    {found?.candidates.map((row, index) => <Button key={row.listing.product_id + row.subtype}
      variant={index === found.suggested_index ? 'primary' : 'secondary'}
      label={`Use ${describe(row)}${row.market == null ? '' : ' · ' + money(row.market)}`}
      onPress={() => onPick(row)} />)}
  </>
}
