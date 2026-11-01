import { useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Copy, ErrorNotice, Loading, Page, Row, Signed, toneColor } from '../../components/ui';
import { PeriodSelector } from '../../components/period-selector';
import { SpendRevenue, ValueChart } from '../../components/dashboard-charts';
import { useApi } from '../../context/AppContext';
import { colors, useResponsiveLayout } from '../../context/ThemeContext';
import { useTypography } from '../../context/TypographyContext';
import { usePeriodPreference } from '../../lib/period-preference';
import { lastChange } from '../../lib/charts';
import { money, percent } from '../../lib/format';
import { minus, tradingDeductions } from '../../lib/reports';
import type { Dashboard as DashboardData, Performance, Period } from '../../lib/api';

/** Shrink unusually long figures to fit a phone card; normal values keep a large headline. */
function Headline({ value, color, width }: { value: string; color?: string; width: number }) {
  const fonts = useTypography();
  const base = width < 360 ? 32 : 40;
  const size = Math.max(20, Math.min(base, Math.floor(Math.max(220, width - 64) / Math.max(value.length * 0.58, 1))));
  return <Text style={{ color: color ?? colors.text, fontFamily: fonts.display, fontSize: size, lineHeight: size + 8, fontWeight: '700', fontVariant: ['tabular-nums'], flexShrink: 1, maxWidth: '100%' }} allowFontScaling>{value}</Text>;
}

function InventoryValue({ data, history, width }: { data: DashboardData; history: Performance['value_history'] | undefined; width: number }) {
  if (data.units_in_stock === 0) return null;
  if (data.priced_units === 0) return <Card accent>
    <Copy muted>Inventory value</Copy>
    <Copy>No market prices yet. Match your stock to the price catalog once and it keeps itself up to date.</Copy>
    <Button variant="primary" label="Set up prices" onPress={() => router.push('/pricing')} />
  </Card>;
  const partial = data.priced_units < data.units_in_stock;
  const change = history ? lastChange(history) : null;
  return <Card accent>
    <Copy muted>Inventory value</Copy>
    <Headline value={money(data.market_value)} width={width} />
    {change ? <Copy><Signed value={change.amount}>{(change.amount.startsWith('-') ? '' : '+') + money(change.amount)}</Signed> since {change.since}</Copy> : null}
    <Row><Copy>Unrealized <Signed value={data.unrealized_gain}>{money(data.unrealized_gain)}</Signed></Copy><Copy muted>vs {money(data.priced_cost)} cost</Copy></Row>
    {history ? <ValueChart points={history} /> : null}
    <Copy muted>Priced {data.priced_units} of {data.units_in_stock} unit{data.units_in_stock === 1 ? '' : 's'}{data.stale_units > 0 ? ` · ${data.stale_units} on stale quotes` : ''}</Copy>
    {partial ? <Button variant="link" label="Price the rest" onPress={() => router.push('/pricing')} /> : null}
  </Card>;
}

function SumLine({ label, value, color, total }: { label: string; value: string; color?: string; total?: boolean }) {
  const fonts = useTypography();
  const font = total ? fonts.strong : fonts.body;
  return <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingTop: total ? 6 : 0, borderTopWidth: total ? 1 : 0, borderColor: colors.edge }}>
    <Text style={{ color: colors.text, fontFamily: font, fontSize: 14, flexShrink: 1 }}>{label}</Text>
    <Text style={{ color: color ?? colors.text, fontFamily: font, fontSize: 14, fontVariant: ['tabular-nums'], flexShrink: 1 }}>{value}</Text>
  </View>;
}

/** The sum behind the headline, top to bottom, so every figure shows where it comes from. The
 * return sits on the trading line because it is trading-only: expenses come off after it.
 * The reporting period sits in this card because it is the only one the period changes. */
function Profit({ data, width, period, setPeriod }: { data: DashboardData; width: number; period: Period; setPeriod: (period: Period) => void }) {
  return <Card>
    <Copy muted>Net profit</Copy>
    <PeriodSelector compact value={period} onChange={setPeriod} />
    <Headline value={money(data.net_profit)} color={toneColor(data.net_profit)} width={width} />
    <View style={{ gap: 6 }}>
      <SumLine label={`Revenue · ${data.sale_count} sale${data.sale_count === 1 ? '' : 's'}`} value={money(data.total_sales)} />
      {tradingDeductions(data).map(line => <SumLine key={line.label} label={line.label} value={money(minus('0.00', line.amount))} />)}
      <SumLine total label={`Trading profit${data.roi === null ? '' : ` · ${percent(data.roi)} on cost`}`} value={money(data.realized_profit)} color={toneColor(data.realized_profit)} />
      <SumLine label="Expenses" value={money(minus('0.00', data.expenses))} />
      <SumLine total label="Net profit" value={money(data.net_profit)} color={toneColor(data.net_profit)} />
    </View>
  </Card>;
}

export default function Dashboard() {
  const api = useApi();
  const { period, setPeriod, hydrated } = usePeriodPreference();
  const { width } = useResponsiveLayout();
  const dashboard = useQuery({ queryKey: ['dashboard', period], queryFn: () => api.dashboard(period), enabled: hydrated });
  const performance = useQuery({ queryKey: ['performance'], queryFn: api.performance, enabled: hydrated });
  const months = useQuery({ queryKey: ['reports', 'byMonth'], queryFn: api.byMonth, enabled: hydrated });
  const attention = useQuery({ queryKey: ['attention'], queryFn: api.attention, enabled: hydrated });
  const data = dashboard.data;
  const story = performance.data;
  const issues = data ? [
    data.sales_missing_cost > 0 ? `${data.sales_missing_cost} unknown-cost sale${data.sales_missing_cost === 1 ? '' : 's'}` : null,
    data.products_with_negative_stock > 0 ? `${data.products_with_negative_stock} negative-stock product${data.products_with_negative_stock === 1 ? '' : 's'}` : null,
    data.undated_sales > 0 ? `${data.undated_sales} undated sale${data.undated_sales === 1 ? '' : 's'}` : null,
  ].filter(Boolean) : [];
  return <Page title="Dashboard">
    <ErrorNotice error={dashboard.error} retry={() => { void dashboard.refetch(); }} />
    <ErrorNotice error={performance.error} retry={() => { void performance.refetch(); }} />
    {dashboard.isPending && <Loading />}
    {data ? <InventoryValue data={data} history={story?.value_history} width={width} /> : null}
    {data ? <Profit data={data} width={width} period={period} setPeriod={setPeriod} /> : null}
    <Card>
      <ErrorNotice error={months.error} retry={() => { void months.refetch(); }} />
      {months.isPending || performance.isPending ? <Loading /> : <SpendRevenue months={months.data ?? []} years={story?.years ?? []} trackedFrom={story?.tracked_from} />}
    </Card>
    {issues.length > 0 ? <Card>
      <Copy>Data attention · {issues.join(' · ')}</Copy>
      <Button label="Review data attention" onPress={() => router.push('/reports')} />
    </Card> : null}
    <ErrorNotice error={attention.error} retry={() => { void attention.refetch(); }} />
    {attention.data?.negative_stock_products.slice(0, 3).map(product => <Button key={product.id} variant="link" label={`Correct negative stock: ${product.name}`} onPress={() => router.push({ pathname: '/products/[productId]', params: { productId: product.id } })} />)}
  </Page>;
}
