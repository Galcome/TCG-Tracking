import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { PeriodSelector } from '../../components/period-selector'
import { AgingReport, AttentionReport, SetReport, TierReport } from '../../components/report-rollups'
import { Button, Card, Choice, Copy, ErrorNotice, Loading, Page, Row } from '../../components/ui'
import { useApi } from '../../context/AppContext'
import { colors } from '../../context/ThemeContext'
import {
  REPORT_GROUPS,
  REPORT_SORTS,
  monthLabel,
  reportMoney as money,
  sortGroupRows,
  type ReportSort,
} from '../../lib/reports'
import { percent } from '../../lib/format'
import { usePeriodPreference } from '../../lib/period-preference'
import type { GroupBy, GroupRow, ReportFilters, Taxonomy } from '../../lib/api'

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text accessibilityRole="header" style={styles.sectionTitle}>{children}</Text>
}

function Toggle({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.toggle,
        selected && styles.toggleSelected,
        pressed && styles.togglePressed,
      ]}
    >
      <Text style={[styles.toggleText, selected && styles.toggleTextSelected]}>{label}</Text>
    </Pressable>
  )
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.metric}>
      <Copy muted>{label}</Copy>
      <Copy>{children}</Copy>
    </View>
  )
}

function GroupSelector({ value, onChange }: { value: GroupBy; onChange: (value: GroupBy) => void }) {
  return (
    <View style={styles.controlBlock}>
      <Copy muted>Group by</Copy>
      <View style={styles.toggleGroup}>
        {REPORT_GROUPS.map((option) => (
          <Toggle
            key={option.value}
            label={option.label}
            selected={value === option.value}
            onPress={() => onChange(option.value)}
          />
        ))}
      </View>
    </View>
  )
}

function SortSelector({ value, onChange }: { value: ReportSort; onChange: (value: ReportSort) => void }) {
  return (
    <View style={styles.controlBlock}>
      <Copy muted>Sort</Copy>
      <View style={styles.toggleGroup}>
        {REPORT_SORTS.map((option) => (
          <Toggle
            key={option.value}
            label={option.label}
            selected={value === option.value}
            onPress={() => onChange(option.value)}
          />
        ))}
      </View>
    </View>
  )
}

function taxonomyOptions(items: Taxonomy[], emptyLabel: string) {
  return [{ value: '', label: emptyLabel }, ...items.map((item) => ({ value: item.id, label: item.name }))]
}

function ReportFilterBar({ value, onChange }: { value: ReportFilters; onChange: (value: ReportFilters) => void }) {
  const api = useApi()
  const games = useQuery({ queryKey: ['games'], queryFn: api.games })
  const types = useQuery({ queryKey: ['productTypes'], queryFn: api.productTypes })
  const gameSlug = games.data?.find((game) => game.id === value.game_id)?.slug
  const sets = useQuery({
    queryKey: ['sets', gameSlug],
    enabled: Boolean(gameSlug),
    queryFn: () => api.sets({ game: gameSlug! }),
  })
  const active = Object.values(value).some(Boolean)

  return (
    <View style={styles.filterBlock}>
      <Copy muted>Filter</Copy>
      <Row>
        <Choice
          label="Filter by game"
          value={value.game_id ?? ''}
          options={taxonomyOptions(games.data ?? [], 'All games')}
          onChange={(gameId) => onChange({ ...value, game_id: gameId || undefined, set_id: undefined })}
        />
        {gameSlug ? (
          <Choice
            label="Filter by set"
            value={value.set_id ?? ''}
            options={[
              { value: '', label: 'All sets' },
              ...(sets.data?.items ?? []).map((set) => ({ value: set.id, label: set.name })),
            ]}
            onChange={(setId) => onChange({ ...value, set_id: setId || undefined })}
          />
        ) : (
          <View style={styles.disabledChoice}>
            <Copy muted>Filter by set</Copy>
            <Button label="Filter by set: All sets — pick a game" disabled onPress={() => undefined} />
          </View>
        )}
        <Choice
          label="Filter by product type"
          value={value.product_type_id ?? ''}
          options={taxonomyOptions(types.data ?? [], 'All types')}
          onChange={(typeId) => onChange({ ...value, product_type_id: typeId || undefined })}
        />
      </Row>
      <ErrorNotice
        error={games.error ?? types.error ?? sets.error}
        retry={() => { void games.refetch(); void types.refetch(); if (gameSlug) void sets.refetch() }}
      />
      {active ? <Button label="Clear" onPress={() => onChange({})} /> : null}
    </View>
  )
}

function AgeBar({ units }: { units: GroupRow['units_by_age'] }) {
  const bands = [
    { label: '0–30d', value: units.d0_30, colour: colors.gain },
    { label: '31–90d', value: units.d31_90, colour: '#e5c36a' },
    { label: '91–180d', value: units.d91_180, colour: colors.accent },
    { label: '180d+', value: units.d180_plus, colour: colors.loss },
  ]
  const total = bands.reduce((sum, band) => sum + band.value, 0)
  if (total === 0) return <Copy muted>No stock age to show</Copy>

  return (
    <View style={styles.ageBlock}>
      <Copy muted>Stock age</Copy>
      <View accessibilityLabel={bands.map((band) => `${band.label}: ${band.value}`).join(' · ')} style={styles.ageBar}>
        {bands.map((band) => band.value > 0 ? (
          <View key={band.label} style={{ flex: band.value, backgroundColor: band.colour }} />
        ) : null)}
      </View>
      <View style={styles.ageLegend}>
        {bands.map((band) => <Copy key={band.label} muted>{band.label} {band.value}</Copy>)}
      </View>
    </View>
  )
}

function GroupRowCard({ row, groupBy }: { row: GroupRow; groupBy: GroupBy }) {
  return (
    <View role="group" accessibilityLabel={row.label}>
      <Card>
        <Row>
          <View style={styles.groupName}>
            {groupBy === 'product' ? (
              <Button
                label={row.label}
                onPress={() => router.push({ pathname: '/products/[productId]', params: { productId: row.key } })}
              />
            ) : <Copy>{row.label}</Copy>}
            <Copy muted>{row.units_sold} sold · {row.units_in_stock} on hand</Copy>
          </View>
          <View style={styles.profit}>
            <Copy>{money(row.realized_profit)}</Copy>
            <Copy muted>Realized profit</Copy>
          </View>
        </Row>
        <Row>
          <Metric label="ROI">{percent(row.roi)}</Metric>
          <Metric label="Revenue">{money(row.revenue)}</Metric>
          <Metric label="Cost of sales">{money(row.cost_of_sales)}</Metric>
          <Metric label="Inventory at cost">{money(row.inventory_at_cost)}</Metric>
        </Row>
        <Row>
          <Metric label="Purchased">{row.units_purchased}</Metric>
          <Metric label="Sold">{row.units_sold}</Metric>
          <Metric label="Average days held">{row.avg_days_held === null ? 'Unknown' : `${row.avg_days_held}d`}</Metric>
          <Metric label="Sell-through">{percent(row.sell_through)}</Metric>
          <Metric label="Profit per day">{money(row.profit_per_day)}</Metric>
        </Row>
        {row.sales_missing_cost > 0 ? (
          <Copy muted>{row.sales_missing_cost} sale{row.sales_missing_cost === 1 ? '' : 's'} with unknown cost</Copy>
        ) : <Copy muted>All sales have known cost</Copy>}
        <AgeBar units={row.units_by_age} />
      </Card>
    </View>
  )
}

function ReturnByTime({ rows, noun }: { rows: GroupRow[]; noun: string }) {
  const plotted = rows
    .filter((row) => row.avg_days_held !== null && row.roi !== null)
    .slice()
    .sort((left, right) => (right.roi ?? 0) - (left.roi ?? 0))

  return (
    <View style={styles.section}>
      <SectionTitle>Return vs. time held</SectionTitle>
      <Copy muted>
        {plotted.length === 0
          ? `No ${noun} has both a sale and a known hold time yet.`
          : `Return per ${noun}, ranked by server-calculated ROI.`}
      </Copy>
      {plotted.length > 0 ? (
        <Card>
          {plotted.map((row) => (
            <View key={row.key} style={styles.rankRow}>
              <View style={styles.groupName}>
                <Copy>{row.label}</Copy>
                <Copy muted>{row.units_sold} sold · {row.avg_days_held}d held</Copy>
              </View>
              <Copy>{percent(row.roi)}</Copy>
            </View>
          ))}
        </Card>
      ) : null}
    </View>
  )
}

function PerformanceReport({ rows, groupBy, noun }: { rows: GroupRow[]; groupBy: GroupBy; noun: string }) {
  return (
    <View style={styles.section}>
      <SectionTitle>Performance by {noun}</SectionTitle>
      {rows.length === 0 ? (
        <Card><Copy muted>No {noun} has anything to report for this period.</Copy></Card>
      ) : rows.map((row) => <GroupRowCard key={row.key} row={row} groupBy={groupBy} />)}
    </View>
  )
}

function MonthByMonth() {
  const api = useApi()
  const months = useQuery({ queryKey: ['reports', 'byMonth'], queryFn: api.byMonth })

  return (
    <View style={styles.section}>
      <SectionTitle>Month by month</SectionTitle>
      <Copy muted>What went out against what came back. This trend is independent of the selected reporting period.</Copy>
      <ErrorNotice error={months.error} retry={() => { void months.refetch() }} />
      {months.isPending ? <Loading /> : null}
      {months.data && months.data.length === 0 ? <Card><Copy muted>No monthly activity yet.</Copy></Card> : null}
      {months.data?.map((month) => (
        <Card key={month.month}>
          <Row>
            <View style={styles.monthName}><Copy>{monthLabel(month.month)}</Copy><Copy muted>{month.month}</Copy></View>
            <Metric label="Spent">{money(month.spent)}</Metric>
            <Metric label="Realized profit">{money(month.realized_profit)}</Metric>
            <Metric label="Revenue">{money(month.revenue)}</Metric>
            <Metric label="Units sold">{month.units_sold}</Metric>
            <Metric label="Units bought">{month.units_bought}</Metric>
          </Row>
        </Card>
      ))}
    </View>
  )
}

export default function Reports() {
  const api = useApi()
  const { period, setPeriod, hydrated } = usePeriodPreference()
  const [groupBy, setGroupBy] = useState<GroupBy>('game')
  const [sort, setSort] = useState<ReportSort>('profit')
  const [filters, setFilters] = useState<ReportFilters>({})
  const rows = useQuery({
    queryKey: ['reports', 'group', groupBy, period, filters],
    queryFn: () => api.group(groupBy, period, filters),
    enabled: hydrated,
  })
  const sorted = useMemo(() => sortGroupRows(rows.data ?? [], sort), [rows.data, sort])
  const group = REPORT_GROUPS.find((option) => option.value === groupBy) ?? REPORT_GROUPS[0]

  return (
    <Page title="Reports">
      <Row><PeriodSelector value={period} onChange={setPeriod} /></Row>
      <ReportFilterBar value={filters} onChange={setFilters} />
      <GroupSelector value={groupBy} onChange={setGroupBy} />
      <SortSelector value={sort} onChange={setSort} />
      <ErrorNotice error={rows.error} retry={() => { void rows.refetch() }} />
      {rows.isPending ? <Loading /> : null}
      {rows.data ? <PerformanceReport rows={sorted} groupBy={groupBy} noun={group.noun} /> : null}
      {rows.data ? <ReturnByTime rows={sorted} noun={group.noun} /> : null}
      <MonthByMonth />
      <TierReport />
      <SetReport />
      <AgingReport />
      <AttentionReport />
      <Card>
        <Copy muted>Financial calculations, decimal amounts, and unknown-versus-zero values come from the API. Tier results show lifetime trading; set holdings, stock aging, and data attention include current positions. These sections are independent of the selected period and filters. Lineage and CSV remain follow-on work.</Copy>
      </Card>
    </Page>
  )
}

const styles = {
  section: { gap: 10 } as const,
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700' as const },
  controlBlock: { gap: 8 } as const,
  toggleGroup: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6 },
  toggle: { backgroundColor: colors.surface, borderColor: colors.edge, borderWidth: 1, borderRadius: 8, minHeight: 44, justifyContent: 'center' as const, paddingHorizontal: 14, paddingVertical: 10 },
  toggleSelected: { backgroundColor: colors.raised, borderColor: colors.accent },
  togglePressed: { opacity: 0.7 },
  toggleText: { color: colors.muted, fontWeight: '600' as const },
  toggleTextSelected: { color: colors.text },
  filterBlock: { gap: 8 } as const,
  disabledChoice: { flexGrow: 1, gap: 7, minWidth: 160 } as const,
  metric: { flexGrow: 1, minWidth: 125, gap: 3 } as const,
  groupName: { flex: 1, minWidth: 190, gap: 3 } as const,
  profit: { alignItems: 'flex-end' as const, minWidth: 125, gap: 3 },
  ageBlock: { gap: 5 } as const,
  ageBar: { flexDirection: 'row' as const, height: 8, width: '100%' as const, overflow: 'hidden' as const, borderRadius: 4, backgroundColor: colors.background },
  ageLegend: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 10 },
  rankRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.edge },
  monthName: { minWidth: 125, flexGrow: 1, gap: 3 } as const,
}
