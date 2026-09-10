import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { View } from 'react-native'

import { RecordValuationDialog } from '../../components/valuation-form'
import { Button, Card, Copy, ErrorNotice, Field, Loading, Page, Row } from '../../components/ui'
import { useApi } from '../../context/AppContext'
import { type VaultHolding } from '../../lib/api'
import { money, percent } from '../../lib/format'

/** The manual Vault workbook cadence: review estimates after a year. */
const MANUAL_REVIEW_DAYS = 365

function statusLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function shortDate(value: string | null): string {
  if (!value) return 'No date'
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function signedMoney(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('-')) return money(trimmed)
  if (/^[+]?0(?:\.0+)?$/.test(trimmed)) return money(trimmed)
  return `+${money(trimmed)}`
}

function daysLabel(value: number | null, known: string, unknown: string): string {
  return value === null
    ? unknown
    : `${known ? `${known} ` : ''}${value} day${value === 1 ? '' : 's'}`
}

function manualAttention(holding: VaultHolding): string {
  if (holding.value === null) return 'Attention: no manual valuation recorded'
  if (
    holding.days_since_valued !== null &&
    holding.days_since_valued > MANUAL_REVIEW_DAYS
  ) {
    return `Attention: manual valuation is ${holding.days_since_valued} days old · annual review after ${MANUAL_REVIEW_DAYS} days`
  }
  return `Manual valuation age: ${daysLabel(holding.days_since_valued, '', 'unknown')}`
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, minWidth: 130, gap: 3 }}>
      <Copy muted>{label}</Copy>
      <Copy>{children}</Copy>
    </View>
  )
}

function ManualValuation({ holding }: { holding: VaultHolding }) {
  return (
    <Card>
      <Copy muted>Manual valuation · an estimate, not cost or profit</Copy>
      <Row>
        <Metric label="Value per unit">
          {holding.value === null ? 'Not valued' : money(holding.value)}
        </Metric>
        <Metric label="Valued on">
          {holding.valued_on === null ? 'No date' : shortDate(holding.valued_on)}
        </Metric>
      </Row>
      <Copy muted>{manualAttention(holding)}</Copy>
    </Card>
  )
}

function MarketEstimate({ holding }: { holding: VaultHolding }) {
  const estimate = holding.market_estimate
  return (
    <Card>
      <Copy muted>Market estimate · separate provider quote</Copy>
      {!estimate ? (
        <>
          <Copy>Unavailable</Copy>
          <Row>
            <Metric label="Source">No provider quote</Metric>
            <Metric label="Captured on">No date</Metric>
            <Metric label="Status">Unavailable</Metric>
          </Row>
        </>
      ) : (
        <>
          <Metric label="Estimated value per unit">
            {estimate.value === null ? 'Unavailable' : money(estimate.value)}
          </Metric>
          <Row>
            <Metric label="Source">{estimate.provider || 'Unknown'}</Metric>
            <Metric label="Captured on">
              {estimate.captured_on === null ? 'No date' : shortDate(estimate.captured_on)}
            </Metric>
            <Metric label="Status">{statusLabel(estimate.status)}</Metric>
          </Row>
        </>
      )}
    </Card>
  )
}

function HoldingCard({
  holding,
  onValue,
}: {
  holding: VaultHolding
  onValue: () => void
}) {
  return (
    <View role="group" accessibilityLabel={holding.product_name}>
      <Card>
        <Row>
          <View style={{ flex: 1, minWidth: 190, gap: 3 }}>
            <Copy>{holding.product_name}</Copy>
            <Copy muted>
              {daysLabel(holding.days_held, 'Held for', 'Held age unknown')}
              {' · '}
              {holding.days_in_store_first === null
                ? 'No Store history'
                : `Moved to Vault after ${holding.days_in_store_first} day${holding.days_in_store_first === 1 ? '' : 's'} in the Store`}
            </Copy>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 3 }}>
            <Copy>{holding.units} unit{holding.units === 1 ? '' : 's'}</Copy>
            <Copy muted>Quantity in Vault</Copy>
          </View>
        </Row>

        <Row>
          <Metric label="Cost">{money(holding.cost)}</Metric>
          <Metric label="Appreciation · not realized profit">
            {holding.appreciation === null ? 'Unknown' : signedMoney(holding.appreciation)}
            {holding.appreciation_pct === null ? '' : ` · ${percent(holding.appreciation_pct)}`}
          </Metric>
          <Metric label="Annualised appreciation">
            {holding.annualised === null ? 'Unknown' : percent(holding.annualised)}
          </Metric>
        </Row>

        <ManualValuation holding={holding} />
        <MarketEstimate holding={holding} />

        <Row>
          <Button
            label="View product"
            onPress={() =>
              router.push({ pathname: '/products/[productId]', params: { productId: holding.product_id } })
            }
          />
          <Button label="Record valuation" onPress={onValue} />
        </Row>
      </Card>
    </View>
  )
}

export default function Vault() {
  const api = useApi()
  const [searchInput, setSearchInput] = useState('')
  const [valuing, setValuing] = useState<VaultHolding | null>(null)
  const holdings = useQuery({ queryKey: ['vaultHoldings'], queryFn: api.vaultHoldings })

  const search = searchInput.trim().toLocaleLowerCase()
  const rows = useMemo(
    () =>
      (holdings.data ?? []).filter((holding) =>
        search ? holding.product_name.toLocaleLowerCase().includes(search) : true,
      ),
    [holdings.data, search],
  )

  return (
    <Page title="Vault">
      <Copy muted>
        Held on purpose and measured on appreciation. Search is local to the loaded Vault
        report; the API does not provide a server-side Vault filter.
      </Copy>
      <Field
        label="Search Vault holdings"
        value={searchInput}
        onChangeText={setSearchInput}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Product name"
      />

      <ErrorNotice error={holdings.error} retry={() => { void holdings.refetch() }} />
      {holdings.isPending ? <Loading /> : null}

      {holdings.data && holdings.data.length === 0 ? (
        <Card>
          <Copy muted>Nothing in the Vault yet. Move something here when you mean to hold it.</Copy>
        </Card>
      ) : null}

      {holdings.data && holdings.data.length > 0 && rows.length === 0 ? (
        <Card>
          <Copy muted>No Vault holdings match that search.</Copy>
        </Card>
      ) : null}

      {rows.map((holding) => (
        <HoldingCard key={holding.product_id} holding={holding} onValue={() => setValuing(holding)} />
      ))}

      {holdings.data && holdings.data.length > 0 ? (
        <Copy muted>
          {rows.length} of {holdings.data.length} holding{holdings.data.length === 1 ? '' : 's'} shown.
          {' '}Vault appreciation is an unrealized estimate, distinct from realized profit.
        </Copy>
      ) : null}

      {valuing ? (
        <RecordValuationDialog
          key={valuing.product_id}
          product={{ id: valuing.product_id, name: valuing.product_name }}
          onClose={() => setValuing(null)}
        />
      ) : null}
    </Page>
  )
}
