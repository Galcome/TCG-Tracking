import { useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../context/ThemeContext';
import { useTypography } from '../context/TypographyContext';
import { barHeights, linePaths, plotValue, shares } from '../lib/charts';
import { money } from '../lib/format';
import { monthLabel } from '../lib/reports';
import type { MonthRow, Performance, ValuePoint, YearRow } from '../lib/api';
import { Copy, Row, Signed } from './ui';

function Swatch({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
  const fonts = useTypography();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
    <View accessible={false} style={{ width: 14, height: dashed ? 0 : 8, borderRadius: 2, backgroundColor: dashed ? undefined : color, borderTopWidth: dashed ? 2 : 0, borderStyle: dashed ? 'dashed' : 'solid', borderColor: color }} />
    <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: 12 }}>{label}</Text>
  </View>;
}

const VALUE_HEIGHT = 120;

/** Market value over time, with what the same stock cost underneath. */
export function ValueChart({ points }: { points: ValuePoint[] }) {
  const fonts = useTypography();
  const [width, setWidth] = useState(0);
  const [value, cost] = linePaths([points.map(point => plotValue(point.market_value)), points.map(point => plotValue(point.priced_cost))], width, VALUE_HEIGHT);
  const first = points[0];
  return <View style={{ gap: 8 }}>
    <View accessibilityLabel={`Value over ${points.length} day${points.length === 1 ? '' : 's'}`} onLayout={event => setWidth(Math.floor(event.nativeEvent.layout.width))} style={{ height: VALUE_HEIGHT }}>
      {width > 0 ? <Svg width={width} height={VALUE_HEIGHT}>
        <Path d={cost} stroke={colors.muted} strokeWidth={1.5} strokeDasharray="4 4" fill="none" />
        <Path d={value} stroke={colors.accent} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" fill="none" />
      </Svg> : null}
    </View>
    <Row><Swatch color={colors.accent} label="Market value" /><Swatch color={colors.muted} label="Cost" dashed />
      <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12, marginLeft: 'auto' }}>{points.length > 1 && first ? `Since ${first.captured_on}` : 'A point is added every day'}</Text></Row>
  </View>;
}

/** Who paid for what the business holds: partners' own money, or money sales brought in. */
export function FundingBar({ data }: { data: Performance }) {
  const [personal, sales] = shares(plotValue(data.personal_money), plotValue(data.from_sales));
  const behind = plotValue(data.from_sales) < 0;
  const held = [
    `stock ${money(data.stock_at_cost)}`,
    plotValue(data.cash) !== 0 ? `cash ${money(data.cash)}` : null,
    plotValue(data.store_credit) !== 0 ? `store credit ${money(data.store_credit)}` : null,
  ].filter(Boolean).join(' · ');
  return <View style={{ gap: 10 }}>
    <View accessible={false} style={{ flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', backgroundColor: colors.raised }}>
      <View style={{ flex: personal, backgroundColor: colors.accent }} />
      <View style={{ flex: sales, backgroundColor: colors.gain }} />
    </View>
    <Row><Swatch color={colors.accent} label={`Our own money ${money(data.personal_money)}`} /><Swatch color={colors.gain} label={`Paid by sales ${money(data.from_sales)}`} /></Row>
    <Copy muted>Held at cost: {held}</Copy>
    <Copy muted>{behind
      ? 'Trading is behind what partners put in.'
      : 'Stock bought with sales money is reinvested, not lost: it is still on the shelf.'}</Copy>
  </View>;
}

const BAR_HEIGHT = 96;

/** Spend against revenue, one pair of bars per month. */
export function SpendRevenueChart({ months }: { months: MonthRow[] }) {
  const fonts = useTypography();
  const heights = barHeights(months.flatMap(month => [plotValue(month.spent), plotValue(month.revenue)]), BAR_HEIGHT);
  return <View style={{ gap: 8 }}>
    <View style={{ flexDirection: 'row', gap: 4, alignItems: 'flex-end' }}>
      {months.map((month, index) => <View key={month.month} accessible accessibilityLabel={`${monthLabel(month.month)}: spent ${money(month.spent)}, revenue ${money(month.revenue)}`} style={{ flex: 1, minWidth: 0, gap: 4, alignItems: 'center' }}>
        <View style={{ height: BAR_HEIGHT, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
          <View style={{ width: 8, height: heights[index * 2], backgroundColor: colors.inventory, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
          <View style={{ width: 8, height: heights[index * 2 + 1], backgroundColor: colors.gain, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
        </View>
        <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 10 }}>{monthLabel(month.month)}</Text>
      </View>)}
    </View>
    <Row><Swatch color={colors.inventory} label="Spent" /><Swatch color={colors.gain} label="Revenue" /></Row>
  </View>;
}

/** Year over year, newest first. The undated row is stock from before the app kept dates. */
export function YearTable({ years }: { years: YearRow[] }) {
  const fonts = useTypography();
  return <View role="table" accessibilityLabel="Year over year" style={{ gap: 0 }}>
    {years.map(year => <View key={year.year ?? 'undated'} role="row" style={{ paddingVertical: 10, borderTopWidth: 1, borderColor: colors.edge, gap: 4 }}>
      <Text style={{ color: colors.text, fontFamily: fonts.strong, fontSize: 16 }}>{year.year ?? 'Before dates'}</Text>
      <Row>
        <Copy>Spent {money(year.spent)}</Copy>
        <Copy>Revenue {money(year.revenue)}</Copy>
        <Copy>Profit <Signed value={year.realized_profit}>{money(year.realized_profit)}</Signed></Copy>
        {plotValue(year.expenses) !== 0 ? <Copy muted>Expenses {money(year.expenses)}</Copy> : null}
      </Row>
    </View>)}
  </View>;
}
