import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Copy, Disclosure, ErrorNotice, Heading, Loading, Page, Row } from '../../components/ui';
import { router } from 'expo-router';
import { PeriodSelector } from '../../components/period-selector';
import { MonthlyTrend } from '../../components/monthly-trend';
import { useApi } from '../../context/AppContext';
import { colors, useResponsiveLayout } from '../../context/ThemeContext';
import { useTypography } from '../../context/TypographyContext';
import { usePeriodPreference } from '../../lib/period-preference';
import { money, percent } from '../../lib/format';
import { EditTransactionDialog } from '../../components/product-forms';
import { saleAsTransaction, type SaleRow } from '../../lib/api';

type MetricSlotProps = {
  isDesktop: boolean;
  width: number;
  fontScale: number;
};

function slotStyle({ isDesktop, width, fontScale }: MetricSlotProps) {
  if (isDesktop) return { flex: 1, minWidth: 0 };
  if (fontScale > 1.35) return { width: '100%' as const };
  return { width: width < 360 ? '47.5%' as const : '48%' as const };
}

function MetricTile({
  label,
  value,
  detail,
  slot,
}: {
  label: string;
  value: string;
  detail: string;
  slot: MetricSlotProps;
}) {
  const fonts = useTypography();
  return <View style={slotStyle(slot)}><Card style={{ flex: 1 }}>
    <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: 12 }} allowFontScaling>{label}</Text>
    <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 22, lineHeight: 28, fontWeight: '700', fontVariant: ['tabular-nums'], flexShrink: 1 }} allowFontScaling>{value}</Text>
    <Copy muted>{detail}</Copy>
  </Card></View>;
}

function DetailMetric({
  label,
  value,
  detail,
  slot,
}: {
  label: string;
  value: string;
  detail?: string;
  slot: MetricSlotProps;
}) {
  return <View style={slotStyle(slot)}><Card style={{ flex: 1 }}>
    <Copy muted>{label}</Copy>
    <Copy>{value}</Copy>
    {detail ? <Copy muted>{detail}</Copy> : null}
  </Card></View>;
}

function MetricGrid({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>{children}</View>;
}

function HeroProfit({
  realizedProfit,
  roi,
  costOfSales,
  saleCount,
  width,
}: {
  realizedProfit: string;
  roi: number | null;
  costOfSales: string;
  saleCount: number;
  width: number;
}) {
  const fonts = useTypography();
  const displayValue = money(realizedProfit);
  // Keep unusually large exact-CAD values inside a phone card while preserving a
  // genuinely large headline for normal values. Text scaling remains enabled.
  const baseSize = width < 360 ? 32 : 40;
  const availableWidth = Math.max(220, width - 64);
  const heroSize = Math.max(20, Math.min(baseSize, Math.floor(availableWidth / Math.max(displayValue.length * 0.58, 1))));
  return <Card accent>
    <Copy muted>Realized profit</Copy>
    <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: heroSize, lineHeight: heroSize + 8, fontWeight: '700', fontVariant: ['tabular-nums'], flexShrink: 1, maxWidth: '100%' }} allowFontScaling>{displayValue}</Text>
    <Row><Copy>ROI {percent(roi)}</Copy><Copy muted>{saleCount} sale{saleCount === 1 ? '' : 's'} · {money(costOfSales)} sold cost</Copy></Row>
  </Card>;
}

export default function Dashboard() {
  const api = useApi();
  const { period, setPeriod, hydrated } = usePeriodPreference();
  const { isDesktop, width, fontScale } = useResponsiveLayout();
  const slot = { isDesktop, width, fontScale };
  const [editing, setEditing] = useState<SaleRow | null>(null);
  const dashboard = useQuery({ queryKey: ['dashboard', period], queryFn: () => api.dashboard(period), enabled: hydrated });
  const recent = useQuery({ queryKey: ['dashboardSales', period], queryFn: () => api.sales({ period, limit: 5 }), enabled: hydrated });
  const games = useQuery({ queryKey: ['dashboardGames', period], queryFn: () => api.byGame(period), enabled: hydrated });
  const channels = useQuery({ queryKey: ['dashboardChannels', period], queryFn: () => api.group('marketplace', period), enabled: hydrated });
  const attention = useQuery({ queryKey: ['attention'], queryFn: api.attention, enabled: hydrated });
  const data = dashboard.data;
  return <Page title="Dashboard">
    {editing ? <EditTransactionDialog transaction={saleAsTransaction(editing)} onClose={() => setEditing(null)} /> : null}
    <PeriodSelector compact value={period} onChange={setPeriod} />
    <ErrorNotice error={dashboard.error} retry={() => { void dashboard.refetch(); }} />
    {dashboard.isPending && <Loading />}
    {data && <><HeroProfit realizedProfit={data.realized_profit} roi={data.roi} costOfSales={data.cost_of_sales} saleCount={data.sale_count} width={width} />
    <MetricGrid>
      <MetricTile label="Stock at cost" value={money(data.inventory_at_cost)} detail={`${data.units_in_stock} unit${data.units_in_stock === 1 ? '' : 's'} · all time`} slot={slot} />
      <MetricTile label="Sales" value={money(data.total_sales)} detail={`${data.sale_count} recorded · selected period`} slot={slot} />
      <MetricTile label="Cash" value={money(data.cash_balance)} detail="all time" slot={slot} />
      <MetricTile label="Invested" value={money(data.total_invested)} detail="all time" slot={slot} />
    </MetricGrid>
    <Card><Disclosure title="Period cost and trading"><MetricGrid>
      <DetailMetric label="Purchases in period" value={money(data.purchases_in_period)} slot={slot} />
      <DetailMetric label="Cost of sold units" value={money(data.cost_of_sales)} slot={slot} />
      <DetailMetric label="Average sale" value={money(data.average_sale)} slot={slot} />
    </MetricGrid></Disclosure></Card>
    <Card><Disclosure title="Lifetime cash context"><MetricGrid>
      <DetailMetric label="Bulk cost written off · lifetime, not cash" value={money(data.cost_written_off)} slot={slot} />
      <DetailMetric label="Total invested" value={money(data.total_invested)} slot={slot} />
      <DetailMetric label="Cash received · excludes store credit" value={money(data.cash_received)} slot={slot} />
      <DetailMetric label="Store credit received · not cash" value={money(data.store_credit)} slot={slot} />
      <DetailMetric label="Fees paid · lifetime" value={money(data.fees_paid)} slot={slot} />
    </MetricGrid><Copy muted>Negative cash can mean money is held in stock, not a trading loss. Store credit is not cash; market estimates and manual valuations are separate from cost basis and realized profit.</Copy></Disclosure></Card>
    {(data.sales_missing_cost > 0 || data.products_with_negative_stock > 0 || data.undated_sales > 0) ? <Card>
      <Copy>Data attention · {[data.sales_missing_cost > 0 ? `${data.sales_missing_cost} unknown-cost sale${data.sales_missing_cost === 1 ? '' : 's'}` : null, data.products_with_negative_stock > 0 ? `${data.products_with_negative_stock} negative-stock product${data.products_with_negative_stock === 1 ? '' : 's'}` : null, data.undated_sales > 0 ? `${data.undated_sales} undated sale${data.undated_sales === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}</Copy>
      <Button label="Review data attention" onPress={() => router.push('/reports')} />
    </Card> : null}</>}
    <ErrorNotice error={attention.error} retry={() => { void attention.refetch(); }} />
    {attention.data?.negative_stock_products.slice(0, 3).map(product => <Button key={product.id} variant="link" label={`Correct negative stock: ${product.name}`} onPress={() => router.push({ pathname: '/products/[productId]', params: { productId: product.id } })} />)}
    <Card><Disclosure title="Sales insights">
      <Heading>Where it sold</Heading>
      <ErrorNotice error={channels.error} retry={() => { void channels.refetch(); }} />
      {channels.isPending ? <Loading /> : null}
      {channels.data?.length === 0 ? <Copy muted>No sales in this period.</Copy> : null}
      {channels.data?.map(channel => <Card key={channel.key}><Copy>{channel.label}</Copy><Copy>{money(channel.revenue)} gross</Copy></Card>)}
      <Heading>Game performance</Heading>
      <ErrorNotice error={games.error} retry={() => { void games.refetch(); }} />
      {games.isPending ? <Loading /> : null}
      {games.data?.length === 0 ? <Copy muted>No game activity in this period.</Copy> : null}
      {games.data?.map(game => <Card key={game.key}><Copy>{game.label}</Copy><Row>
        <Copy>Profit {money(game.realized_profit)}</Copy><Copy>ROI {percent(game.roi)}</Copy>
        <Copy>{game.sale_count} sales</Copy></Row></Card>)}
    </Disclosure></Card>
    <Card><Disclosure title="Recent sales">
      <ErrorNotice error={recent.error} retry={() => { void recent.refetch(); }} />
      {recent.isPending ? <Loading /> : null}
      {recent.data?.items.length === 0 ? <Copy muted>No sales in this period.</Copy> : null}
      {recent.data?.items.map(sale => <Card key={sale.id}><Copy>{sale.product.name}</Copy><Row>
        <Copy>{sale.sale_date ?? 'Undated'} · {sale.quantity} units</Copy><Copy>Gross {money(sale.amount)}</Copy>
        <Copy>Profit {money(sale.realized_profit)}</Copy></Row>
        {sale.has_unknown_cost ? <Copy muted>Unknown cost: profit may be incomplete.</Copy> : null}
        <Button label={`View ${sale.product.name}`} onPress={() => router.push({ pathname: '/products/[productId]', params: { productId: sale.product_id } })} />
        <Button label={`Edit sale: ${sale.product.name}`} disabled={sale.status === 'voided'} onPress={() => setEditing(sale)} />
      </Card>)}
      <Button label="Open sales ledger" onPress={() => router.push('/sales')} />
    </Disclosure></Card>
    <Card><Disclosure title="Monthly trend"><MonthlyTrend /></Disclosure></Card>
  </Page>;
}
