import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { Text, View } from 'react-native'

import { RecordValuationDialog } from '../../components/valuation-form'
import { Button, Card, Copy, Disclosure, ErrorNotice, Field, Loading, Page, Row } from '../../components/ui'
import { useApi } from '../../context/AppContext'
import { colors, useResponsiveLayout } from '../../context/ThemeContext'
import { useTypography } from '../../context/TypographyContext'
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

function manualStatus(holding: VaultHolding): string {
  if (holding.value === null) return 'Manual valuation not recorded yet'
  if (
    holding.days_since_valued !== null &&
    holding.days_since_valued > MANUAL_REVIEW_DAYS
  ) {
    return `Manual valuation is ${holding.days_since_valued} days old · review after ${MANUAL_REVIEW_DAYS} days`
  }
  return holding.days_since_valued === null
    ? 'Manual valuation age unavailable'
    : `Manual valuation age: ${holding.days_since_valued} day${holding.days_since_valued === 1 ? '' : 's'}`
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
      <Copy muted>Manual valuation · per-unit estimate, separate from cost and profit</Copy>
      {holding.value === null ? (
        <Copy>Not valued yet</Copy>
      ) : (
        <Row>
          <Metric label="Value per unit">{money(holding.value)}</Metric>
          <Metric label="Valued on">
            {holding.valued_on === null ? 'Date unavailable' : shortDate(holding.valued_on)}
          </Metric>
        </Row>
      )}
      <Copy muted>{manualStatus(holding)}</Copy>
    </Card>
  )
}

function MarketEstimate({ holding }: { holding: VaultHolding }) {
  const estimate = holding.market_estimate
  return (
    <Card>
      <Copy muted>Market quote · separate from manual valuation and appreciation</Copy>
      {!estimate || estimate.value === null ? <Copy>Market quote unavailable</Copy> : (
        <>
          <Metric label="Estimated value per unit">{money(estimate.value)}</Metric>
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

function summarySlot({ isDesktop, width, fontScale }: MetricSlotProps) {
  if (isDesktop) return { flex: 1, minWidth: 0 }
  if (fontScale > 1.35) return { width: '100%' as const }
  return { width: width < 360 ? '47.5%' as const : '48%' as const }
}

type MetricSlotProps = {
  isDesktop: boolean
  width: number
  fontScale: number
}

function SummaryMetric({
  label,
  value,
  detail,
  slot,
}: {
  label: string
  value: string
  detail?: string
  slot: MetricSlotProps
}) {
  const fonts = useTypography()
  return (
    <View style={[summarySlot(slot), { gap: 3, paddingVertical: 3 }]}>
      <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: 12 }} allowFontScaling>
        {label}
      </Text>
      <Text
        style={{
          color: colors.text,
          fontFamily: fonts.display,
          fontSize: 21,
          lineHeight: 27,
          fontWeight: '700',
          fontVariant: ['tabular-nums'],
          flexShrink: 1,
        }}
        allowFontScaling
      >
        {value}
      </Text>
      {detail ? <Copy muted>{detail}</Copy> : null}
    </View>
  )
}

function HoldingCard({
  holding,
  onValue,
}: {
  holding: VaultHolding
  onValue: () => void
}) {
  const { isDesktop, width, fontScale } = useResponsiveLayout()
  const slot = { isDesktop, width, fontScale }
  return (
    <View role="group" accessibilityLabel={holding.product_name}>
      <Card>
        <Row>
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Copy>{holding.product_name}</Copy>
            <Copy muted>
              {daysLabel(holding.days_held, 'Held for', 'Held age unknown')}
            </Copy>
          </View>
        </Row>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <SummaryMetric label="Cost" value={money(holding.cost)} detail="total holding cost" slot={slot} />
          <SummaryMetric label="Units" value={String(holding.units)} detail="in Vault" slot={slot} />
          <SummaryMetric label="Manual value · per unit" value={holding.value === null ? 'Unknown' : money(holding.value)} detail={holding.value === null ? 'Record a valuation when ready' : 'estimate, not cost'} slot={slot} />
          <SummaryMetric label="Appreciation · unrealized" value={holding.appreciation === null ? 'Unknown' : signedMoney(holding.appreciation)} detail={holding.appreciation_pct === null ? undefined : percent(holding.appreciation_pct)} slot={slot} />
        </View>

        <Disclosure title="Valuation details">
          <ManualValuation holding={holding} />
          <MarketEstimate holding={holding} />
          <Card>
            <Copy muted>Holding context</Copy>
            <Copy>
              {holding.days_in_store_first === null
                ? 'Store move history unavailable'
                : `Moved to Vault after ${holding.days_in_store_first} day${holding.days_in_store_first === 1 ? '' : 's'} in the Store`}
            </Copy>
            <Copy muted>
              Annualised appreciation:{' '}
              {holding.annualised === null ? 'Unknown' : percent(holding.annualised)}
            </Copy>
          </Card>
        </Disclosure>

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
      <Copy muted>Held on purpose; estimates stay separate from cost and profit. Search loaded holdings.</Copy>
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
