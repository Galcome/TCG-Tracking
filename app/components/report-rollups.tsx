import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { router } from 'expo-router'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { Text, View } from 'react-native'

import { Button, Card, Copy, ErrorNotice, Loading, Row } from './ui'
import { useApi } from '../context/AppContext'
import { colors } from '../context/ThemeContext'
import type { AgingLot, Attention, SetRollupRow, TierRow } from '../lib/api'
import {
  agingDescription,
  groupAgingLots,
  purchaseDateDescription,
} from '../lib/report-rollups'
import { reportMoney } from '../lib/reports'
import { percent } from '../lib/format'

type RollupQuery<T> = Pick<UseQueryResult<T>, 'data' | 'error' | 'isPending' | 'refetch'>

interface RollupSectionProps<T> {
  title: string
  description: string
  query: RollupQuery<T>
  emptyMessage: string
  isEmpty: (data: T) => boolean
  children: (data: T) => ReactNode
}

function RollupSection<T>({
  title,
  description,
  query,
  emptyMessage,
  isEmpty,
  children,
}: RollupSectionProps<T>) {
  const data = query.data

  return (
    <View role="group" accessibilityLabel={title} style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      <Copy muted>{description}</Copy>
      {query.isPending && data === undefined ? <Loading /> : null}
      {query.error ? <ErrorNotice error={query.error} retry={() => { void query.refetch() }} /> : null}
      {query.error && data !== undefined ? <Copy muted>Showing last loaded data; refresh failed.</Copy> : null}
      {data !== undefined && !query.error && isEmpty(data) ? (
        <Card><Copy muted>{emptyMessage}</Copy></Card>
      ) : null}
      {data !== undefined && !isEmpty(data) ? children(data) : null}
    </View>
  )
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View style={styles.metric}>
      <Copy muted>{label}</Copy>
      <Copy>{value}</Copy>
    </View>
  )
}

function plural(value: number, singular: string, pluralForm = `${singular}s`) {
  return `${value} ${value === 1 ? singular : pluralForm}`
}

function TierRowCard({ row }: { row: TierRow }) {
  return (
    <View role="group" accessibilityLabel={`Tier: ${row.label}`}>
      <Card>
        <Row>
          <View style={styles.primary}>
            <Copy>{row.label}</Copy>
            <Copy muted>{plural(row.products_traded, 'product')} · {plural(row.units_sold, 'unit')} sold</Copy>
          </View>
          <Metric label="Realized profit" value={reportMoney(row.realized_profit)} />
          <Metric label="ROI" value={percent(row.roi)} />
        </Row>
        <Row>
          <Metric label="Cost of sales" value={reportMoney(row.cost_of_sales)} />
          <Metric label="Typical (median)" value={percent(row.median_roi)} />
          <Metric label="Worst → best" value={`${percent(row.worst_roi)} → ${percent(row.best_roi)}`} />
          <Metric label="Average days held" value={row.avg_days_held === null ? 'Unknown' : `${row.avg_days_held}d`} />
        </Row>
      </Card>
    </View>
  )
}

/** Lifetime strategy outcomes. This report is deliberately separate from lineage totals. */
export function TierReport() {
  const api = useApi()
  const query = useQuery({ queryKey: ['reports', 'byTier'], queryFn: api.byTier })

  return (
    <RollupSection
      title="Tier performance"
      description="Lifetime realized results, independent of the selected period and filters."
      query={query}
      emptyMessage="No tier sales yet."
      isEmpty={(rows) => rows.length === 0}
    >
      {(rows) => (
        <>
          <View style={styles.list}>{rows.map((row) => <TierRowCard key={row.key} row={row} />)}</View>
          <Copy muted>Compare each tier against its own history. The worst-to-best range keeps one memorable win from reading as the typical outcome.</Copy>
        </>
      )}
    </RollupSection>
  )
}

function SetRowCard({ row }: { row: SetRollupRow }) {
  return (
    <View role="group" accessibilityLabel={`Set: ${row.name}`}>
      <Card>
        <Copy>{row.name}</Copy>
        <Copy muted>{row.game_slug} · lifetime, not period-scoped</Copy>
        <View style={styles.setColumns}>
          <View style={styles.setColumn}>
            <Text style={styles.columnTitle}>Sold</Text>
            <Metric label="Realized profit" value={reportMoney(row.realized_profit)} />
            <Metric label="Cost of sales" value={reportMoney(row.cost_of_sales)} />
            <Metric label="ROI" value={percent(row.sold_roi)} />
            <Metric label="Units sold" value={row.units_sold} />
          </View>
          <View style={styles.setColumn}>
            <Text style={styles.columnTitle}>In the Store</Text>
            <Copy muted>Store at cost</Copy>
            <Metric label="Cost" value={reportMoney(row.store_cost)} />
            <Metric label="Units" value={row.units_in_store} />
            <Metric
              label="Oldest"
              value={row.oldest_store_days === null ? 'Unknown' : `${row.oldest_store_days}d`}
            />
          </View>
          <View style={styles.setColumn}>
            <Text style={styles.columnTitle}>In the Vault</Text>
            <Copy muted>Vault at cost · held on purpose</Copy>
            <Metric label="Cost" value={reportMoney(row.vault_cost)} />
            <Metric label="Units" value={row.units_in_vault} />
          </View>
        </View>
      </Card>
    </View>
  )
}

/** Set holdings stay as sold, Store, and Vault facts; there is no blended set return. */
export function SetReport() {
  const api = useApi()
  const query = useQuery({ queryKey: ['reports', 'bySet'], queryFn: api.bySet })

  return (
    <RollupSection
      title="Set holdings"
      description="Lifetime set holdings are split into realized sales, Store at cost, and Vault at cost; they are independent of the selected period and filters."
      query={query}
      emptyMessage="No set holdings or sales yet."
      isEmpty={(rows) => rows.length === 0}
    >
      {(rows) => <View style={styles.list}>{rows.map((row) => <SetRowCard key={row.set_id} row={row} />)}</View>}
    </RollupSection>
  )
}

function AgingRowCard({ lot }: { lot: AgingLot }) {
  return (
    <View role="group" accessibilityLabel={`Aging lot: ${lot.product_name}`}>
      <Card>
        <Row>
          <View style={styles.primary}>
            <Button
              label={lot.product_name}
              onPress={() => router.push({ pathname: '/products/[productId]', params: { productId: lot.product_id } })}
            />
            <Copy muted>{plural(lot.units, 'unit')} · {lot.game_slug}</Copy>
          </View>
          <Metric label="Remaining cost" value={reportMoney(lot.cost)} />
        </Row>
        <Copy muted>{agingDescription(lot.days_held)} · {purchaseDateDescription(lot.purchase_date)}</Copy>
      </Card>
    </View>
  )
}

function AgingRows({ lots }: { lots: AgingLot[] }) {
  const groups = useMemo(() => groupAgingLots(lots), [lots])

  return (
    <View style={styles.ageGroups}>
      {groups.map((group) => (
        <View key={group.key} style={styles.ageGroup}>
          <Text style={styles.columnTitle}>{group.label}</Text>
          {group.lots.map((lot) => <AgingRowCard key={lot.purchase_id} lot={lot} />)}
        </View>
      ))}
    </View>
  )
}

/** Current non-Vault stock by remaining purchase lot. The API subtracts Vault units. */
export function AgingReport() {
  const api = useApi()
  const query = useQuery({ queryKey: ['reports', 'aging'], queryFn: api.aging })

  return (
    <RollupSection
      title="Stock aging"
      description="Current unsold non-Vault stock (Inventory and Store), independent of the selected period and filters. Vault stock is excluded because it is held on purpose."
      query={query}
      emptyMessage="No remaining purchase lots."
      isEmpty={(rows) => rows.length === 0}
    >
      {(lots) => <AgingRows lots={lots} />}
    </RollupSection>
  )
}

function AttentionCard({ attention }: { attention: Attention }) {
  return (
    <Card>
      {attention.sales_missing_cost > 0 ? (
        <Text accessibilityRole="alert" style={styles.warning}>
          {plural(attention.sales_missing_cost, 'sale')} with unknown cost
        </Text>
      ) : null}
      {attention.products_with_negative_stock > 0 ? (
        <Text accessibilityRole="alert" style={styles.warning}>
          {plural(attention.products_with_negative_stock, 'product')} showing negative stock
        </Text>
      ) : null}
      {attention.negative_stock_products.length > 0 ? (
        <View style={styles.list}>
          {attention.negative_stock_products.map((product) => (
            <Row key={product.id}>
              <Button
                label={product.name}
                onPress={() => router.push({ pathname: '/products/[productId]', params: { productId: product.id } })}
              />
              <Copy muted>{product.quantity} on hand</Copy>
            </Row>
          ))}
        </View>
      ) : null}
    </Card>
  )
}

/** Only current data-quality problems belong here; selling out is not an error. */
export function AttentionReport() {
  const api = useApi()
  const query = useQuery({ queryKey: ['reports', 'attention'], queryFn: api.attention })

  return (
    <RollupSection
      title="Data attention"
      description="Current ledger warnings, independent of the selected period and filters."
      query={query}
      emptyMessage="No data issues found."
      isEmpty={(attention) => (
        attention.sales_missing_cost === 0 &&
        attention.products_with_negative_stock === 0 &&
        attention.negative_stock_products.length === 0
      )}
    >
      {(attention) => <AttentionCard attention={attention} />}
    </RollupSection>
  )
}

const styles = {
  section: { gap: 10 } as const,
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700' as const },
  list: { gap: 10 } as const,
  primary: { flex: 1, minWidth: 180, gap: 3 } as const,
  metric: { flexGrow: 1, minWidth: 125, gap: 3 } as const,
  setColumns: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 14 },
  setColumn: { flexGrow: 1, minWidth: 155, gap: 5 } as const,
  columnTitle: { color: colors.text, fontSize: 15, fontWeight: '700' as const },
  ageGroups: { gap: 14 } as const,
  ageGroup: { gap: 8 } as const,
  warning: { color: colors.loss, fontSize: 15, lineHeight: 22 } as const,
}
