import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { Text, View } from 'react-native'

import { useApi } from '../context/AppContext'
import { colors } from '../context/ThemeContext'
import type { LineageNode, LineageRollup } from '../lib/api'
import {
  flattenLineageNodes,
  lineageHasActivity,
  lineageIndent,
  lineageNodeLabel,
} from '../lib/lineage-report'
import { percent } from '../lib/format'
import { reportMoney } from '../lib/reports'
import { Button, Card, Copy, ErrorNotice, Loading, Row } from './ui'

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View style={styles.metric}>
      <Copy muted>{label}</Copy>
      <Copy>{value}</Copy>
    </View>
  )
}

function SummaryMetric({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <View style={styles.summaryMetric}>
      <Copy muted>{label}</Copy>
      <Copy>{value}</Copy>
      {hint ? <Copy muted>{hint}</Copy> : null}
    </View>
  )
}

function plural(value: number, singular: string, pluralForm = `${singular}s`) {
  return `${value} ${value === 1 ? singular : pluralForm}`
}

function LineageNodeRow({ node }: { node: LineageNode }) {
  return (
    <View
      role="group"
      accessibilityLabel={lineageNodeLabel(node)}
      style={[styles.node, { marginLeft: lineageIndent(node.depth) }]}
    >
      <Card>
        <Row>
          <View style={styles.primary}>
            <Button
              label={node.product_name}
              onPress={() => router.push({ pathname: '/products/[productId]', params: { productId: node.product_id } })}
            />
            <Copy muted>{plural(node.quantity_produced, 'unit')} produced</Copy>
          </View>
          <Metric label="Cost" value={reportMoney(node.cost)} />
        </Row>
      </Card>
    </View>
  )
}

function LineageSummary({ report }: { report: LineageRollup }) {
  const nodes = useMemo(() => flattenLineageNodes(report.tree), [report.tree])

  return (
    <Card>
      <Copy>{report.product_name}</Copy>
      <Copy muted>Root cost and all descendant outcomes, kept separate from Tier totals.</Copy>
      <View style={styles.summary}>
        <SummaryMetric
          label="Root cost"
          value={reportMoney(report.cost)}
        />
        <SummaryMetric
          label="Realized profit"
          value={reportMoney(report.realized_profit)}
        />
        <SummaryMetric
          label="Remaining cost"
          value={reportMoney(report.remaining_cost)}
          hint={plural(report.units_remaining, 'unit') + ' remaining'}
        />
        <SummaryMetric
          label="Written off"
          value={reportMoney(report.written_off)}
        />
        <SummaryMetric
          label="ROI"
          value={percent(report.roi)}
          hint={plural(report.units_sold, 'unit') + ' sold'}
        />
      </View>
      {nodes.length > 0 ? (
        <View style={styles.tree}>
          {nodes.map((node, index) => (
            <LineageNodeRow key={`${node.product_id}-${index}`} node={node} />
          ))}
        </View>
      ) : null}
      <Copy muted>Measured against what the root cost across everything it became. This is not an additional Tier total; adding both would count the same money twice.</Copy>
    </Card>
  )
}

/** One product, all-in, across everything it became. */
export function LineageReport({ productId }: { productId: string }) {
  const api = useApi()
  const query = useQuery({
    queryKey: ['lineage', productId],
    queryFn: () => api.lineage(productId),
    enabled: Boolean(productId),
  })
  const data = query.data

  return (
    <View role="group" accessibilityLabel="Lineage report" style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>All-in lineage</Text>
      <Copy muted>Recursive cost and return for this product chain, independent of Reports rollups.</Copy>
      {query.isPending && data === undefined ? <Loading /> : null}
      {query.error ? <ErrorNotice error={query.error} retry={() => { void query.refetch() }} /> : null}
      {query.error && data !== undefined ? <Copy muted>Showing last loaded data; refresh failed.</Copy> : null}
      {data !== undefined && !query.error && !lineageHasActivity(data) ? (
        <Card><Copy muted>No lineage activity yet.</Copy></Card>
      ) : null}
      {data !== undefined && lineageHasActivity(data) ? <LineageSummary report={data} /> : null}
    </View>
  )
}

const styles = {
  section: { gap: 10 } as const,
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700' as const },
  summary: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 14 },
  summaryMetric: { flexGrow: 1, minWidth: 135, gap: 3 } as const,
  metric: { flexGrow: 1, minWidth: 125, gap: 3 } as const,
  primary: { flex: 1, minWidth: 180, gap: 3 } as const,
  tree: { gap: 10, borderTopWidth: 1, borderTopColor: colors.edge, paddingTop: 12 } as const,
  node: { gap: 8 } as const,
}
