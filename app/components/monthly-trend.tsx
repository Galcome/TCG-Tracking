import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { useApi } from '../context/AppContext';
import { monthLabel, reportMoney } from '../lib/reports';
import { Card, Copy, ErrorNotice, Heading, Loading, Row, Signed } from './ui';

/** Calendar-month server totals, never recomputed from filtered client transactions. */
export function MonthlyTrend() {
  const api = useApi();
  const months = useQuery({ queryKey: ['reports', 'byMonth'], queryFn: api.byMonth });
  return <View style={{ gap: 14 }} accessibilityLabel="Monthly trading trend" role="group">
    <Heading>Month by month</Heading>
    <Copy muted>Last twelve calendar months, oldest first. Independent of the selected reporting period. Spending, revenue and realized profit are distinct server totals; estimates are excluded.</Copy>
    <ErrorNotice error={months.error} retry={() => { void months.refetch(); }} />
    {months.isPending ? <Loading /> : null}
    {months.data?.length === 0 ? <Card><Copy muted>No monthly activity yet.</Copy></Card> : null}
    {months.data?.map(month => <Card key={month.month}>
      <Copy>{monthLabel(month.month)}</Copy><Copy muted>{month.month}</Copy>
      <Row>
        <Copy>Spent {reportMoney(month.spent)}</Copy>
        <Copy>Revenue {reportMoney(month.revenue)}</Copy>
        <Copy>Realized profit <Signed value={month.realized_profit}>{reportMoney(month.realized_profit)}</Signed></Copy>
      </Row>
      <Copy>{month.units_bought} units bought · {month.units_sold} units sold</Copy>
    </Card>)}
  </View>;
}
