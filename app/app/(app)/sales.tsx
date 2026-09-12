import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'

import { Button, Card, Choice, Copy, ErrorNotice, Field, Loading, Page, Row } from '../../components/ui'
import { PeriodSelector } from '../../components/period-selector'
import { CsvButton } from '../../components/csv-button'
import { EditTransactionDialog, VoidDialog } from '../../components/product-forms'
import { RecordSaleDialog } from '../../components/sale-form'
import { useApi } from '../../context/AppContext'
import {
  MARKETPLACES,
  saleAsTransaction,
  type SaleRow,
} from '../../lib/api'
import { usePeriodPreference } from '../../lib/period-preference'
import { money } from '../../lib/format'
import { collectPages, salesCsv } from '../../lib/csv'

const UNSPECIFIED = 'Unspecified'
const PAGE_SIZE = 50

export interface SalesProps {
  /** A parent shell may provide a global record-sale action. */
  onRecordSale?: () => void
}

function statusLabel(row: SaleRow): string {
  return row.status === 'voided' ? 'Voided' : 'Posted'
}

function marketplaceOptions(names: string[]): { value: string; label: string }[] {
  return [
    { value: '', label: 'All channels' },
    ...names.map((name) => ({ value: name, label: name })),
    { value: UNSPECIFIED, label: UNSPECIFIED },
  ]
}

function SaleRowCard({
  row,
  memberName,
  onEdit,
  onVoid,
}: {
  row: SaleRow
  memberName: string
  onEdit: () => void
  onVoid: () => void
}) {
  const voided = row.status === 'voided'
  return (
    <Card>
      <Row>
        <View style={{ flex: 1, minWidth: 200 }}>
          <Copy>{row.product.name}</Copy>
          <Copy muted>
            {row.product.game.name} · {row.product.product_type.name} · {row.sale_date ?? 'No date'}
          </Copy>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Copy>{money(row.net_proceeds)}</Copy>
          <Copy muted>{row.marketplace ?? UNSPECIFIED}</Copy>
        </View>
      </Row>
      <Row>
        <Copy>Qty {row.quantity}</Copy>
        <Copy>Gross {money(row.amount)}</Copy>
        <Copy>Platform fees {money(row.platform_fees)}</Copy>
        <Copy>Payment fees {money(row.payment_fees)}</Copy>
        <Copy>Shipping {money(row.shipping_paid)}</Copy>
      </Row>
      <Row>
        <Copy>
          Profit {row.has_unknown_cost ? 'Unknown' : money(row.realized_profit)}
        </Copy>
        <Copy muted>Sold by {memberName || 'Unassigned'}</Copy>
        <Copy muted>{statusLabel(row)}</Copy>
      </Row>
      {row.notes ? <Copy muted>{row.notes}</Copy> : null}
      <Row>
        {!voided ? <Button label="Edit" onPress={onEdit} /> : null}
        {!voided ? <Button label="Void" onPress={onVoid} danger /> : null}
        <Button label="Open item" onPress={() => router.push({ pathname: '/products/[productId]', params: { productId: row.product_id } })} />
      </Row>
    </Card>
  )
}

export default function Sales({ onRecordSale }: SalesProps = {}) {
  const api = useApi()
  const { period, setPeriod, hydrated } = usePeriodPreference()
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [marketplace, setMarketplace] = useState('')
  const [seller, setSeller] = useState('')
  const [offset, setOffset] = useState(0)
  const [recording, setRecording] = useState(false)
  const [editing, setEditing] = useState<SaleRow | null>(null)
  const [voiding, setVoiding] = useState<SaleRow | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim())
      setOffset(0)
    }, 250)
    return () => clearTimeout(timer)
  }, [searchInput])

  const members = useQuery({ queryKey: ['members'], queryFn: api.members })
  const channelReport = useQuery({
    queryKey: ['byMarketplace', 'all'],
    queryFn: () => api.group('marketplace', 'all'),
  })
  const sales = useQuery({
    queryKey: ['sales', period, search, marketplace, seller, offset],
    queryFn: () => api.sales({
      period,
      q: search || undefined,
      marketplace: marketplace || undefined,
      sold_by_member_id: seller || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    enabled: hydrated,
  })

  const rows = sales.data?.items ?? []
  const channels = useMemo(() => {
    const values = new Set<string>(MARKETPLACES.map((item) => item.name))
    for (const row of channelReport.data ?? []) {
      if (row.label !== UNSPECIFIED) values.add(row.label)
    }
    return [...values].sort((a, b) => a.localeCompare(b))
  }, [channelReport.data])
  const memberNames = useMemo(() => new Map((members.data ?? []).map((member) => [member.id, member.display_name])), [members.data])

  return (
    <Page title="Sales">
      <Row>
        {onRecordSale ? <Button label="Record sale" onPress={onRecordSale} /> : <Button label="Record sale" onPress={() => setRecording(true)} />}
        <CsvButton label="Export sales CSV" disabled={!hydrated || sales.isFetching || Boolean(sales.error) || searchInput.trim() !== search}
          create={async () => salesCsv(await collectPages((pageOffset, limit) => api.sales({ period,
            q: search || undefined, marketplace: marketplace || undefined, sold_by_member_id: seller || undefined,
            offset: pageOffset, limit })), memberNames)} />
        <PeriodSelector
          value={period}
          onChange={(value) => {
            setPeriod(value)
            setOffset(0)
          }}
        />
      </Row>
      <Field label="Search by product" value={searchInput} onChangeText={setSearchInput} autoCapitalize="none" />
      <Row>
        <Choice
          label="Marketplace"
          value={marketplace}
          options={marketplaceOptions(channels)}
          onChange={(value) => {
            setMarketplace(value)
            setOffset(0)
          }}
        />
        <Choice
          label="Sold by"
          value={seller}
          options={[{ value: '', label: 'All sellers' }, ...(members.data ?? []).map((member) => ({ value: member.id, label: member.display_name }))]}
          onChange={(value) => {
            setSeller(value)
            setOffset(0)
          }}
        />
      </Row>
      <Copy muted>{sales.data ? `${rows.length} sale${rows.length === 1 ? '' : 's'} shown${sales.data.total > rows.length ? ` of ${sales.data.total}` : ''}.` : 'Loading sales…'}</Copy>
      <ErrorNotice error={sales.error ?? members.error ?? channelReport.error} retry={() => { void sales.refetch(); void members.refetch(); void channelReport.refetch(); }} />
      {sales.isPending ? <Loading /> : null}
      {sales.data && rows.length === 0 ? <Card><Copy muted>{search || marketplace || seller ? 'No sales match those filters.' : 'Nothing sold yet. Record your first sale.'}</Copy></Card> : null}
      {rows.map((row) => (
        <SaleRowCard
          key={row.id}
          row={row}
          memberName={row.sold_by_member_id ? memberNames.get(row.sold_by_member_id) ?? 'Unassigned' : 'Unassigned'}
          onEdit={() => setEditing(row)}
          onVoid={() => setVoiding(row)}
        />
      ))}
      {sales.data && sales.data.total > PAGE_SIZE ? (
        <Row>
          <Button
            label="Previous"
            disabled={offset === 0 || sales.isFetching}
            onPress={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          />
          <Copy muted>
            {offset + 1}-{Math.min(offset + rows.length, sales.data.total)} of {sales.data.total}
          </Copy>
          <Button
            label="Next"
            disabled={offset + PAGE_SIZE >= sales.data.total || sales.isFetching}
            onPress={() => setOffset(offset + PAGE_SIZE)}
          />
        </Row>
      ) : null}
      {recording ? <RecordSaleDialog onClose={() => setRecording(false)} /> : null}
      {editing ? <EditTransactionDialog transaction={saleAsTransaction(editing)} onClose={() => setEditing(null)} /> : null}
      {voiding ? <VoidDialog transaction={saleAsTransaction(voiding)} onClose={() => setVoiding(null)} /> : null}
    </Page>
  )
}
