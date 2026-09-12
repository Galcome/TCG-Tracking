import { useQuery } from '@tanstack/react-query';
import { Button, Card, Copy, ErrorNotice, Heading, Loading, Page, Row } from '../../components/ui';
import { router } from 'expo-router';
import { PeriodSelector } from '../../components/period-selector';
import { useApi } from '../../context/AppContext';
import { usePeriodPreference } from '../../lib/period-preference';
import { money, percent } from '../../lib/format';
export default function Dashboard() {
  const api = useApi();
  const { period, setPeriod, hydrated } = usePeriodPreference();
  const dashboard = useQuery({ queryKey: ['dashboard', period], queryFn: () => api.dashboard(period), enabled: hydrated });
  const recent = useQuery({ queryKey: ['dashboardSales', period], queryFn: () => api.sales({ period, limit: 5 }), enabled: hydrated });
  const games = useQuery({ queryKey: ['dashboardGames', period], queryFn: () => api.byGame(period), enabled: hydrated });
  const data = dashboard.data;
  return <Page title="Dashboard">
    <PeriodSelector value={period} onChange={setPeriod} />
    <Copy muted>Profit and sales follow the selected period. Holdings and cash figures below are lifetime; estimates are never profit.</Copy>
    <ErrorNotice error={dashboard.error} retry={() => { void dashboard.refetch(); }} />
    {dashboard.isPending && <Loading />}
    {data && <><Row>
      <Card><Copy muted>Realized profit</Copy><Copy>{money(data.realized_profit)}</Copy><Copy>ROI {percent(data.roi)}</Copy></Card>
      <Card><Copy muted>Inventory at cost · all time</Copy><Copy>{money(data.inventory_at_cost)}</Copy><Copy>{data.units_in_stock} units</Copy></Card>
      <Card><Copy muted>Sales in period</Copy><Copy>{money(data.total_sales)}</Copy><Copy>{data.sale_count} sales</Copy></Card>
      <Card><Copy muted>Cash balance · all time</Copy><Copy>{money(data.cash_balance)}</Copy></Card>
    </Row><Heading>Period cost and trading</Heading><Row>
      <Card><Copy muted>Purchases in period</Copy><Copy>{money(data.purchases_in_period)}</Copy></Card>
      <Card><Copy muted>Cost of sold units</Copy><Copy>{money(data.cost_of_sales)}</Copy></Card>
      <Card><Copy muted>Average sale</Copy><Copy>{money(data.average_sale)}</Copy></Card>
    </Row><Heading>Lifetime cash context</Heading><Row>
      <Card><Copy muted>Bulk cost written off · lifetime, not cash</Copy><Copy>{money(data.cost_written_off)}</Copy></Card>
      <Card><Copy muted>Total invested</Copy><Copy>{money(data.total_invested)}</Copy></Card>
      <Card><Copy muted>Cash received · excludes store credit</Copy><Copy>{money(data.cash_received)}</Copy></Card>
      <Card><Copy muted>Store credit received · not cash</Copy><Copy>{money(data.store_credit)}</Copy></Card>
      <Card><Copy muted>Fees paid · lifetime</Copy><Copy>{money(data.fees_paid)}</Copy></Card>
    </Row><Card><Copy>{data.sales_missing_cost} sales with unknown cost · {data.products_with_negative_stock} products with negative stock · {data.undated_sales} undated sales</Copy>
      <Copy muted>A negative cash balance can mean money is held in stock, not a trading loss. Store credit is not cash. Market estimates and manual valuations are separate from cost basis and realized profit.</Copy>
      <Button label="Review data attention" onPress={() => router.push('/reports')} /></Card></>}
    <Heading>Game performance · selected period</Heading>
    <ErrorNotice error={games.error} retry={() => { void games.refetch(); }} />
    {games.isPending ? <Loading /> : null}
    {games.data?.length === 0 ? <Copy muted>No game activity in this period.</Copy> : null}
    {games.data?.map(game => <Card key={game.key}><Copy>{game.label}</Copy><Row>
      <Copy>Realized profit {money(game.realized_profit)}</Copy><Copy>ROI {percent(game.roi)}</Copy>
      <Copy>{game.sale_count} sales</Copy></Row></Card>)}
    <Heading>Recent sales · selected period</Heading>
    <ErrorNotice error={recent.error} retry={() => { void recent.refetch(); }} />
    {recent.isPending ? <Loading /> : null}
    {recent.data?.items.length === 0 ? <Copy muted>No sales in this period.</Copy> : null}
    {recent.data?.items.map(sale => <Card key={sale.id}><Copy>{sale.product.name}</Copy><Row>
      <Copy>{sale.sale_date ?? 'Undated'} · {sale.quantity} units</Copy><Copy>Gross {money(sale.amount)}</Copy>
      <Copy>Realized profit {money(sale.realized_profit)}</Copy></Row>
      {sale.has_unknown_cost ? <Copy muted>Unknown cost: profit may be incomplete.</Copy> : null}
      <Button label={`View ${sale.product.name}`} onPress={() => router.push({ pathname: '/products/[productId]', params: { productId: sale.product_id } })} />
    </Card>)}
    <Button label="Open sales ledger" onPress={() => router.push('/sales')} />
  </Page>;
}
