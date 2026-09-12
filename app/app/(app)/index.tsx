import { useQuery } from '@tanstack/react-query';
import { Card, Copy, ErrorNotice, Loading, Page, Row } from '../../components/ui';
import { PeriodSelector } from '../../components/period-selector';
import { useApi } from '../../context/AppContext';
import { usePeriodPreference } from '../../lib/period-preference';
import { money, percent } from '../../lib/format';
export default function Dashboard() {
  const api = useApi();
  const { period, setPeriod, hydrated } = usePeriodPreference();
  const dashboard = useQuery({ queryKey: ['dashboard', period], queryFn: () => api.dashboard(period), enabled: hydrated });
  const data = dashboard.data;
  return <Page title="Dashboard">
    <PeriodSelector value={period} onChange={setPeriod} />
    <ErrorNotice error={dashboard.error} retry={() => { void dashboard.refetch(); }} />
    {dashboard.isPending && <Loading />}
    {data && <><Row>
      <Card><Copy muted>Realized profit</Copy><Copy>{money(data.realized_profit)}</Copy><Copy>ROI {percent(data.roi)}</Copy></Card>
      <Card><Copy muted>Inventory at cost · all time</Copy><Copy>{money(data.inventory_at_cost)}</Copy><Copy>{data.units_in_stock} units</Copy></Card>
      <Card><Copy muted>Sales in period</Copy><Copy>{money(data.total_sales)}</Copy><Copy>{data.sale_count} sales</Copy></Card>
      <Card><Copy muted>Cash balance · all time</Copy><Copy>{money(data.cash_balance)}</Copy></Card>
    </Row><Card><Copy>{data.sales_missing_cost} sales with unknown cost · {data.products_with_negative_stock} products with negative stock</Copy>
      <Copy muted>Market estimates and manual valuations are separate from cost basis and realized profit.</Copy></Card></>}
  </Page>;
}
