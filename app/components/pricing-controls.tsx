import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Text, View } from 'react-native'

import { useApi } from '../context/AppContext'
import { colors } from '../context/ThemeContext'
import type {
  CatalogMapping,
  CatalogMappingDraft,
  MarketEstimate as MarketEstimateData,
  ProductDetail,
  TCGCSVCategory,
  TCGCSVGroup,
  TCGCSVProduct,
} from '../lib/api'
import { reportMoney } from '../lib/reports'
import {
  canUseFreeMarketPricing,
  catalogId,
  isCertainSuggestion,
  pricingEligibilityMessage,
  preferredSubtype,
  pricingMappingDraft,
  pricingRefreshSummary,
  validatePricingMappingDraft,
} from '../lib/pricing-drafts'
import { Button, Card, Choice, Copy, ErrorNotice, Field, Loading, Row } from './ui'

function statusLabel(status: MarketEstimateData['status']) {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

type QueryState<T> = Pick<
  UseQueryResult<T>,
  'data' | 'error' | 'isPending' | 'isFetching' | 'refetch'
>

function CatalogChoice({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  disabled: boolean
}) {
  const selected = options.find((option) => option.value === value)?.label ?? 'Choose'
  if (!disabled) {
    return <Choice label={label} value={value} options={options} onChange={onChange} />
  }
  return (
    <View style={styles.choice}>
      <Copy muted>{label}</Copy>
      <Button label={`${label}: ${selected}`} disabled onPress={() => undefined} />
    </View>
  )
}

function optionsWithCurrent(
  current: string | null | undefined,
  currentLabel: string,
  options: { value: string; label: string }[],
) {
  if (!current || options.some((option) => option.value === current)) return options
  return [{ value: current, label: `${currentLabel} (${current})` }, ...options]
}

function LocalIdentity({ product }: { product: ProductDetail }) {
  return (
    <View style={styles.identity}>
      <Copy>{product.name}</Copy>
      <Copy muted>Local identity used for human confirmation</Copy>
      <Row>
        <Copy muted>Variant: {product.variant ?? 'not recorded'}</Copy>
        <Copy muted>Condition: {product.condition ?? 'not recorded'}</Copy>
        <Copy muted>Language: {product.language ?? 'not recorded'}</Copy>
      </Row>
    </View>
  )
}

function MarketEstimate({ product }: { product: ProductDetail }) {
  const estimate = product.market_estimate
  if (!estimate) {
    return <Copy muted>No confirmed free-source estimate.</Copy>
  }

  return (
    <Card>
      <Copy muted>Current market estimate · per unit · display only</Copy>
      <Copy>{reportMoney(estimate.value)}</Copy>
      <Copy>{statusLabel(estimate.status)}</Copy>
      <Copy muted>Source: {estimate.provider}</Copy>
      <Copy muted>
        {estimate.captured_on ? `Captured ${estimate.captured_on}` : 'No capture date'}
      </Copy>
      {estimate.source_revision ? <Copy muted>Source revision: {estimate.source_revision}</Copy> : null}
      <Copy muted>This estimate never changes cost, inventory, Vault value, or profit.</Copy>
    </Card>
  )
}

function CatalogDiscovery({
  draft,
  discoveryEnabled,
  setDiscoveryEnabled,
  updateCategory,
  updateGroup,
  selectProduct,
  categoryId,
  groupId,
  categories,
  groups,
  catalogProducts,
  search,
  setSearch,
  submittedSearch,
  setSubmittedSearch,
  disabled,
}: {
  draft: CatalogMappingDraft
  discoveryEnabled: boolean
  setDiscoveryEnabled: (enabled: boolean) => void
  updateCategory: (value: string) => void
  updateGroup: (value: string) => void
  selectProduct: (product: TCGCSVProduct) => void
  categoryId: number | null
  groupId: number | null
  categories: QueryState<TCGCSVCategory[]>
  groups: QueryState<TCGCSVGroup[]>
  catalogProducts: QueryState<TCGCSVProduct[]>
  search: string
  setSearch: (value: string) => void
  submittedSearch: string | null
  setSubmittedSearch: (value: string) => void
  disabled: boolean
}) {
  if (!discoveryEnabled) {
    return <Button label="Load free catalog options" disabled={disabled} onPress={() => setDiscoveryEnabled(true)} />
  }

  const categoryOptions = optionsWithCurrent(
    draft.external_category_id,
    'Current category',
    [
      { value: '', label: 'Choose a category' },
      ...(categories.data ?? [])
        .map((category) => ({ value: String(category.category_id), label: `${category.display_name} (${category.category_id})` })),
    ],
  )
  const groupOptions = optionsWithCurrent(
    draft.external_group_id,
    'Current group',
    [
      { value: '', label: 'Choose a group' },
      ...(groups.data ?? [])
        .map((group) => ({ value: String(group.group_id), label: `${group.name} (${group.group_id})` })),
    ],
  )
  const products = catalogProducts.data ?? []

  return (
    <View style={styles.discovery}>
      <Copy muted>Search the provider catalog to fill an exact identity. Selection never confirms the mapping.</Copy>
      {categories.isPending && !categories.data ? <Loading /> : null}
      <CatalogChoice
        label="Catalog category"
        value={draft.external_category_id ?? ''}
        options={categoryOptions}
        onChange={updateCategory}
        disabled={disabled}
      />
      <ErrorNotice error={categories.error} retry={disabled ? undefined : () => { void categories.refetch() }} />
      {groups.isPending && !groups.data && categoryId !== null ? <Loading /> : null}
      <CatalogChoice
        label="Catalog group"
        value={draft.external_group_id ?? ''}
        options={groupOptions}
        onChange={updateGroup}
        disabled={disabled}
      />
      <ErrorNotice error={groups.error} retry={disabled ? undefined : () => { void groups.refetch() }} />
      <Field
        label="Search catalog products"
        value={search}
        onChangeText={setSearch}
        placeholder="Product or set name"
        editable={!disabled}
      />
      <Button
        label={catalogProducts.isFetching ? 'Searching…' : 'Find products'}
        disabled={disabled || categoryId === null || groupId === null || catalogProducts.isFetching}
        onPress={() => {
          const next = search.trim()
          setSubmittedSearch(next)
          if (submittedSearch === next) void catalogProducts.refetch()
        }}
      />
      {catalogProducts.isPending && !catalogProducts.data ? <Loading /> : null}
      <ErrorNotice error={catalogProducts.error} retry={disabled ? undefined : () => { void catalogProducts.refetch() }} />
      {catalogProducts.data && products.length === 0 ? (
        <Copy muted>No products matched. Try a shorter search or enter numeric IDs manually below.</Copy>
      ) : null}
      {products.length > 0 ? (
        <View style={styles.discoveryResults}>
          {products.map((product) => (
            <View key={product.product_id} style={styles.discoveryResult}>
              <View style={styles.primary}>
                <Copy>{product.name}</Copy>
                <Copy muted>
                  {product.product_id} · {product.subtypes.length > 0 ? product.subtypes.join(', ') : 'Normal'}
                </Copy>
              </View>
              <Button label="Use this listing" disabled={disabled} onPress={() => selectProduct(product)} />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}

function listingLabel(listing: TCGCSVProduct) {
  return listing.number ? `${listing.name} · #${listing.number}` : listing.name
}

/**
 * The catalog listing this product most likely is, one tap from a market value. Shown only
 * while the product has no mapping: asking may cost a cheap model call, so it is asked once.
 * Tapping a listing is the human confirmation; nothing is mapped before that.
 */
export function PriceSuggestion({ product }: { product: ProductDetail }) {
  const api = useApi()
  const queryClient = useQueryClient()
  const eligible = canUseFreeMarketPricing(product)
  const mappings = useQuery({
    queryKey: ['pricingMappings', product.id],
    queryFn: () => api.pricingMappings(product.id),
    enabled: eligible,
  })
  const unmapped = mappings.data?.length === 0
  const suggestion = useQuery({
    queryKey: ['pricingSuggestion', product.id],
    queryFn: () => api.pricingSuggestion(product.id),
    enabled: eligible && unmapped,
    staleTime: Infinity,
    retry: false,
  })
  const confirm = useMutation({
    mutationFn: async (listing: TCGCSVProduct) => {
      await api.createPricingMapping({
        product_id: product.id,
        external_product_id: String(listing.product_id),
        external_category_id: String(listing.category_id),
        external_group_id: String(listing.group_id),
        subtype_name: preferredSubtype(listing.subtypes, product.variant),
      })
      // The value shows now rather than tomorrow. If a refresh is already running, the
      // mapping is saved regardless and the nightly job prices it.
      try {
        await api.refreshPricing()
        return true
      } catch {
        return false
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pricingMappings', product.id] }),
        queryClient.invalidateQueries({ queryKey: ['product', product.id] }),
        queryClient.invalidateQueries({ queryKey: ['products'] }),
      ])
    },
  })

  // One certain listing is not a choice, so it is not worth a tap. Mapping it is
  // reversible from the controls below, and a quote still never touches cost or profit.
  const certain = isCertainSuggestion(suggestion.data)
  const autoConfirmed = useRef(false)
  useEffect(() => {
    if (!certain || autoConfirmed.current) return
    autoConfirmed.current = true
    confirm.mutate(suggestion.data!.candidates[0])
    // Only the arrival of a certain suggestion starts this; the ref makes it run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [certain])

  if (confirm.data === false) {
    return <Card><Copy>Price listing saved. Its value appears after the nightly refresh.</Copy></Card>
  }
  if (!eligible || !unmapped) return null
  if (certain) {
    return <Card><Copy muted>Matching this to its catalog listing…</Copy><Loading /></Card>
  }

  const data = suggestion.data
  const suggested = data?.suggested_index == null ? null : data.candidates[data.suggested_index] ?? null
  const others = data?.candidates.filter((listing) => listing !== suggested) ?? []

  return (
    <Card accent>
      <Text accessibilityRole="header" style={styles.sectionTitle}>Give this a market value</Text>
      {suggestion.isPending ? <><Loading /><Copy muted>Finding it in the price catalog…</Copy></> : null}
      <ErrorNotice error={suggestion.error} retry={() => { void suggestion.refetch() }} />
      {data?.message ? <Copy muted>{data.message} You can also find it by hand under Market pricing.</Copy> : null}
      {suggested ? (
        <View style={styles.identity}>
          <Copy>{listingLabel(suggested)}</Copy>
          <Copy muted>
            {data?.method === 'exact' ? 'Exact catalog match' : 'Picked by AI from close listings. Check it.'}
          </Copy>
          <Button
            variant="primary"
            label={confirm.isPending ? 'Saving…' : 'Confirm match'}
            disabled={confirm.isPending}
            onPress={() => confirm.mutate(suggested)}
          />
        </View>
      ) : null}
      {others.length > 0 ? (
        <View style={styles.discoveryResults}>
          <Copy muted>{suggested ? 'Not it? Other close listings:' : data?.message ? 'Closest listings, in case one is it:' : 'Which of these is it? If none, find it by hand under Market pricing.'}</Copy>
          {others.map((listing) => (
            <View key={listing.product_id} style={styles.discoveryResult}>
              <View style={styles.primary}><Copy>{listingLabel(listing)}</Copy></View>
              <Button label="This one" disabled={confirm.isPending} onPress={() => confirm.mutate(listing)} />
            </View>
          ))}
        </View>
      ) : null}
      {confirm.error ? <Text accessibilityRole="alert" style={styles.error}>{confirm.error.message}</Text> : null}
    </Card>
  )
}

export function PricingControls({ product }: { product: ProductDetail }) {
  const api = useApi()
  const queryClient = useQueryClient()
  const eligible = canUseFreeMarketPricing(product)
  const mappings = useQuery({
    queryKey: ['pricingMappings', product.id],
    queryFn: () => api.pricingMappings(product.id),
    enabled: eligible,
  })
  const mapping = mappings.data?.[0] ?? null
  const [draftOverride, setDraftOverride] = useState<CatalogMappingDraft | null>(null)
  const [discoveryEnabled, setDiscoveryEnabled] = useState(false)
  const [catalogSearch, setCatalogSearch] = useState('')
  const [submittedSearch, setSubmittedSearch] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [refreshResult, setRefreshResult] = useState<string | null>(null)
  const mutationBusy = useRef(false)
  const draft = draftOverride ?? pricingMappingDraft(mapping)
  const categoryId = catalogId(draft.external_category_id)
  const groupId = catalogId(draft.external_group_id)

  const categories = useQuery({
    queryKey: ['pricingCatalogCategories'],
    queryFn: api.pricingCatalogCategories,
    enabled: eligible && discoveryEnabled,
  })
  const groups = useQuery({
    queryKey: ['pricingCatalogGroups', categoryId],
    queryFn: () => api.pricingCatalogGroups(categoryId!),
    enabled: eligible && discoveryEnabled && categoryId !== null,
  })
  const catalogProducts = useQuery({
    queryKey: ['pricingCatalogProducts', categoryId, groupId, submittedSearch],
    queryFn: () => api.pricingCatalogProducts({
      category_id: categoryId!,
      group_id: groupId!,
      ...(submittedSearch ? { q: submittedSearch } : {}),
      limit: 50,
    }),
    enabled: eligible && submittedSearch !== null && categoryId !== null && groupId !== null,
  })

  const invalidatePricing = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pricingMappings', product.id] }),
      queryClient.invalidateQueries({ queryKey: ['product', product.id] }),
      queryClient.invalidateQueries({ queryKey: ['products'] }),
      queryClient.invalidateQueries({ queryKey: ['vaultHoldings'] }),
    ])
  }

  const releaseMutation = () => { mutationBusy.current = false }
  const save = useMutation({
    mutationFn: ({ draft: submittedDraft, currentMapping }: {
      draft: CatalogMappingDraft
      currentMapping: CatalogMapping | null
    }) => currentMapping
      ? api.updatePricingMapping(currentMapping.id, { ...submittedDraft, match_status: 'confirmed' })
      : api.createPricingMapping({ product_id: product.id, ...submittedDraft }),
    onSuccess: async () => {
      setDraftOverride(null)
      await invalidatePricing()
    },
    onSettled: releaseMutation,
  })
  const toggle = useMutation({
    mutationFn: (currentMapping: CatalogMapping) => api.updatePricingMapping(currentMapping.id, {
      match_status: currentMapping.match_status === 'disabled' ? 'confirmed' : 'disabled',
    }),
    onSuccess: invalidatePricing,
    onSettled: releaseMutation,
  })
  const refresh = useMutation({
    mutationFn: api.refreshPricing,
    onSuccess: async (result) => {
      setRefreshResult(pricingRefreshSummary(result))
      await invalidatePricing()
    },
    onSettled: releaseMutation,
  })

  const pending = save.isPending || toggle.isPending || refresh.isPending
  const mutationError = save.error ?? toggle.error ?? refresh.error
  const resetMutationFeedback = () => {
    save.reset()
    toggle.reset()
    refresh.reset()
    setValidationError(null)
    setRefreshResult(null)
  }
  const updateDraft = (field: keyof CatalogMappingDraft, value: string) => {
    resetMutationFeedback()
    setDraftOverride((current) => ({ ...(current ?? draft), [field]: value }))
  }
  const updateCategory = (value: string) => {
    resetMutationFeedback()
    setDraftOverride((current) => ({
      ...(current ?? draft),
      external_category_id: value,
      external_group_id: '',
      external_product_id: '',
    }))
    setSubmittedSearch(null)
  }
  const updateGroup = (value: string) => {
    resetMutationFeedback()
    setDraftOverride((current) => ({
      ...(current ?? draft),
      external_group_id: value,
      external_product_id: '',
    }))
    setSubmittedSearch(null)
  }
  const selectProduct = (catalogProduct: TCGCSVProduct) => {
    resetMutationFeedback()
    setDraftOverride((current) => ({
      ...(current ?? draft),
      external_product_id: String(catalogProduct.product_id),
      external_category_id: String(catalogProduct.category_id),
      external_group_id: String(catalogProduct.group_id),
      subtype_name: preferredSubtype(catalogProduct.subtypes, product.variant),
    }))
  }
  const runMutation = (run: () => void) => {
    if (mutationBusy.current) return
    mutationBusy.current = true
    run()
  }
  const submit = () => {
    const error = validatePricingMappingDraft(draft)
    if (error) {
      setValidationError(error)
      return
    }
    // Snapshot the confirmed values so a picker update or query refetch cannot make this
    // write use a later or stale render's draft.
    runMutation(() => save.mutate({ draft: { ...draft }, currentMapping: mapping }))
  }
  const toggleMapping = () => {
    if (!mapping) return
    runMutation(() => toggle.mutate(mapping))
  }
  const refreshPricing = () => {
    if (!mapping || mapping.match_status !== 'confirmed') return
    setRefreshResult(null)
    runMutation(() => refresh.mutate())
  }

  if (!eligible) return null

  return (
    <View role="group" accessibilityLabel="Pricing controls" style={styles.section}>
      <Row>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Free-source market estimate</Text>
        <Copy muted>per unit · display only · CAD</Copy>
      </Row>
      <LocalIdentity product={product} />
      <MarketEstimate product={product} />
      {mappings.isPending && !mappings.data ? <Loading /> : null}
      <ErrorNotice error={mappings.error} retry={() => { void mappings.refetch() }} />
      {mappings.data && !mappings.error ? (
        <Card>
          <Copy>Confirm the exact TCGCSV printing before refreshing.</Copy>
          <Copy muted>Catalog selection only fills this form; a human must confirm the mapping. Mapping confirmation never changes ledger cost, stock, manual Vault values, or profit; refresh records separate display-only quotes.</Copy>
          <CatalogDiscovery
            draft={draft}
            discoveryEnabled={discoveryEnabled}
            setDiscoveryEnabled={setDiscoveryEnabled}
            updateCategory={updateCategory}
            updateGroup={updateGroup}
            selectProduct={selectProduct}
            categoryId={categoryId}
            groupId={groupId}
            categories={categories}
            groups={groups}
            catalogProducts={catalogProducts}
            search={catalogSearch}
            setSearch={setCatalogSearch}
            submittedSearch={submittedSearch}
            setSubmittedSearch={setSubmittedSearch}
            disabled={pending}
          />
          <Copy muted>Provider: TCGCSV</Copy>
          <Field label="Subtype / printing" value={draft.subtype_name} onChangeText={(value) => updateDraft('subtype_name', value)} editable={!pending} />
          <Field label="Category ID" value={draft.external_category_id ?? ''} onChangeText={(value) => updateDraft('external_category_id', value)} keyboardType="number-pad" editable={!pending} />
          <Field label="Group ID" value={draft.external_group_id ?? ''} onChangeText={(value) => updateDraft('external_group_id', value)} keyboardType="number-pad" editable={!pending} />
          <Field label="Product ID" value={draft.external_product_id} onChangeText={(value) => updateDraft('external_product_id', value)} keyboardType="number-pad" editable={!pending} />
          {mapping ? <Copy muted>Mapping is {mapping.match_status}. Saving confirms the identity again.</Copy> : null}
          {validationError ? <Text accessibilityRole="alert" style={styles.error}>{validationError}</Text> : null}
          {mutationError ? <Text accessibilityRole="alert" style={styles.error}>{mutationError instanceof Error ? mutationError.message : 'Something went wrong'}</Text> : null}
          {refreshResult ? <Copy muted>{refreshResult}</Copy> : null}
          <Row>
            <Button label={save.isPending ? 'Saving…' : mapping ? 'Save and confirm' : 'Confirm mapping'} disabled={pending} onPress={submit} />
            {mapping ? (
              <Button
                label={toggle.isPending ? 'Updating…' : mapping.match_status === 'disabled' ? 'Re-enable mapping' : 'Disable mapping'}
                disabled={pending}
                onPress={toggleMapping}
              />
            ) : null}
            <Button
              label={refresh.isPending ? 'Refreshing…' : 'Refresh all confirmed estimates'}
              disabled={pending || !mapping || mapping.match_status !== 'confirmed'}
              onPress={refreshPricing}
            />
          </Row>
        </Card>
      ) : null}
      {!mappings.isPending && !mappings.error && !mappings.data ? <Copy muted>{pricingEligibilityMessage(product)}</Copy> : null}
    </View>
  )
}

const styles = {
  section: { gap: 10 } as const,
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700' as const },
  identity: { gap: 4 } as const,
  choice: { gap: 7 } as const,
  discovery: { gap: 8, borderColor: colors.edge, borderWidth: 1, borderRadius: 10, padding: 12 } as const,
  discoveryResults: { gap: 8 } as const,
  discoveryResult: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, alignItems: 'center' as const, gap: 8, borderTopColor: colors.edge, borderTopWidth: 1, paddingTop: 8 },
  primary: { flex: 1, minWidth: 160, gap: 3 } as const,
  error: { color: colors.loss, fontSize: 14, lineHeight: 21 } as const,
}
