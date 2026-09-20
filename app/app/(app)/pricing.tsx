import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'

import { Button, Card, Copy, ErrorNotice, Loading, Page, Row } from '../../components/ui'
import { useApi } from '../../context/AppContext'
import type { Product, TCGCSVProduct } from '../../lib/api'
import {
  isCertainSuggestion,
  needsPricingSetup,
  preferredSubtype,
  pricingSetupSummary,
  type PricingSetupOutcome,
} from '../../lib/pricing-drafts'

/** The whole shelf at once: the list endpoints page, and nobody holds more than this. */
const MAX_STOCK = 200

function listingLabel(listing: TCGCSVProduct) {
  return listing.number ? `${listing.name} · #${listing.number}` : listing.name
}

/**
 * Price everything that has no catalog listing yet, in one pass instead of one visit per
 * product. A listing code is certain of is taken without asking; anything a person has to
 * judge stops the walk and asks. Nothing here changes cost, stock, or profit.
 */
export default function PricingSetup() {
  const api = useApi()
  const queryClient = useQueryClient()
  const [index, setIndex] = useState(0)
  const [outcomes, setOutcomes] = useState<PricingSetupOutcome[]>([])

  // Both snapshots are held for the whole walk: writing a mapping must not reshuffle the
  // queue or shorten it under the person part-way through. They are refreshed at the end.
  const products = useQuery({
    queryKey: ['products', { pricingSetup: true }],
    queryFn: () => api.products({ limit: MAX_STOCK }),
    staleTime: Infinity,
  })
  const mappings = useQuery({
    queryKey: ['pricingMappings', 'setup'],
    queryFn: () => api.pricingMappings(undefined, MAX_STOCK),
    staleTime: Infinity,
  })
  const queue: Product[] | null = useMemo(
    () =>
      products.data && mappings.data
        ? needsPricingSetup(products.data.items, mappings.data)
        : null,
    [products.data, mappings.data],
  )

  const current = queue?.[index] ?? null
  const suggestion = useQuery({
    queryKey: ['pricingSuggestion', current?.id],
    queryFn: () => api.pricingSuggestion(current!.id),
    enabled: current !== null,
    staleTime: Infinity,
    retry: false,
  })

  const advance = (outcome: PricingSetupOutcome) => {
    setOutcomes((done) => [...done, outcome])
    setIndex((at) => at + 1)
  }
  const confirm = useMutation({
    mutationFn: (listing: TCGCSVProduct) =>
      api.createPricingMapping({
        product_id: current!.id,
        external_product_id: String(listing.product_id),
        external_category_id: String(listing.category_id),
        external_group_id: String(listing.group_id),
        subtype_name: preferredSubtype(listing.subtypes, current!.variant),
      }),
  })

  // One certain listing is not a choice, so it is not worth a tap. The walk moves on from
  // the mutation's own callback; a mapping stays editable from the product page.
  const certain = isCertainSuggestion(suggestion.data)
  const matched = useRef<string | null>(null)
  useEffect(() => {
    if (!current || !certain || matched.current === current.id) return
    matched.current = current.id
    confirm.mutate(suggestion.data!.candidates[0], {
      onSuccess: () => advance('matched'),
      onError: () => advance('failed'),
    })
    // Only the arrival of a certain suggestion starts this; `confirm` is stable enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, certain])

  const done = queue !== null && index >= queue.length
  // One refresh for the whole run rather than one per mapping, so the values are there
  // when the walk ends. The nightly job prices anything this misses.
  const priced = outcomes.some((outcome) => outcome === 'matched' || outcome === 'chosen')
  const refresh = useMutation({
    mutationFn: api.refreshPricing,
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['pricingMappings'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['vaultHoldings'] }),
      ]),
  })
  const refreshed = useRef(false)
  useEffect(() => {
    if (!done || !priced || refreshed.current) return
    refreshed.current = true
    refresh.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, priced])

  const loadError = products.error ?? mappings.error
  if (loadError) {
    return (
      <Page title="Set up prices">
        <ErrorNotice
          error={loadError}
          retry={() => {
            void products.refetch()
            void mappings.refetch()
          }}
        />
      </Page>
    )
  }
  if (queue === null) {
    return <Page title="Set up prices"><Loading /></Page>
  }
  // Checked before `done`: the refresh at the end re-reads both lists, so by then the queue
  // is empty on purpose. What a run did is the answer then, not "there was nothing to do".
  if (queue.length === 0 && outcomes.length === 0) {
    return (
      <Page title="Set up prices">
        <Card><Copy>Everything that can carry a market value already has a listing.</Copy></Card>
      </Page>
    )
  }
  if (done) {
    return (
      <Page title="Set up prices">
        <Card accent>
          <Copy>{pricingSetupSummary(outcomes)}</Copy>
          {refresh.isPending ? <Copy muted>Fetching today&apos;s values…</Copy> : null}
          {refresh.isError ? (
            <Copy muted>Values could not be fetched now; the nightly refresh will price them.</Copy>
          ) : null}
          <Button variant="primary" label="Done" onPress={() => router.push('/inventory')} />
        </Card>
      </Page>
    )
  }

  const data = suggestion.data
  const suggested = data?.suggested_index == null ? null : data.candidates[data.suggested_index] ?? null
  const others = data?.candidates.filter((listing) => listing !== suggested) ?? []
  const busy = confirm.isPending || certain
  const deadEnd = !suggestion.error && data?.candidates.length === 0
  const choose = (listing: TCGCSVProduct) =>
    confirm.mutate(listing, { onSuccess: () => advance('chosen'), onError: () => advance('failed') })

  return (
    <Page title="Set up prices">
      <Copy muted>
        {queue.length - index} of {queue.length} left · a listing is confirmed, never guessed
      </Copy>
      <Card accent>
        <Copy>{current!.name}</Copy>
        <Copy muted>
          {current!.set_name ?? 'No set'} · {current!.product_type.name}
          {current!.collector_number ? ` · #${current!.collector_number}` : ''}
        </Copy>
        {suggestion.isPending || busy ? <Loading /> : null}
        <ErrorNotice error={suggestion.error} />
        {data?.message ? <Copy muted>{data.message}</Copy> : null}
        {suggested ? (
          <View style={styles.choice}>
            <Copy>{listingLabel(suggested)}</Copy>
            <Copy muted>Picked by AI from close listings. Check it.</Copy>
            <Button variant="primary" label="Confirm match" disabled={busy} onPress={() => choose(suggested)} />
          </View>
        ) : null}
        {others.length > 0 ? (
          <Copy muted>{suggested ? 'Not it? Other close listings:' : 'Which of these is it?'}</Copy>
        ) : null}
        {others.map((listing) => (
          <Row key={listing.product_id}>
            <View style={styles.primary}><Copy>{listingLabel(listing)}</Copy></View>
            <Button label="This one" disabled={busy} onPress={() => choose(listing)} />
          </Row>
        ))}
        {confirm.error ? <ErrorNotice error={confirm.error} /> : null}
        <Button
          label={deadEnd ? 'Next' : 'Skip this one'}
          disabled={busy}
          onPress={() => advance(suggestion.error ? 'failed' : deadEnd ? 'none' : 'skipped')}
        />
      </Card>
    </Page>
  )
}

const styles = {
  choice: { gap: 4 } as const,
  primary: { flex: 1, minWidth: 160, gap: 3 } as const,
}
