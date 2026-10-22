import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../context/ThemeContext';
import { useTypography } from '../context/TypographyContext';
import { linePaths, plotValue, stackHeights } from '../lib/charts';
import { money } from '../lib/format';
import { monthLabel } from '../lib/reports';
import type { MonthRow, ValuePoint, YearRow } from '../lib/api';
import { Button, Copy, Row, toneColor } from './ui';

function Swatch({ color, label }: { color: string; label: string }) {
  const fonts = useTypography();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
    <View accessible={false} style={{ width: 14, height: 8, borderRadius: 2, backgroundColor: color }} />
    <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: 12 }}>{label}</Text>
  </View>;
}

const VALUE_HEIGHT = 120;

/** Market value over time, scaled to its own range so a day's move is visible. Cost sits
 * far below and barely moves, so on the same scale it flattened the value line; the
 * headline states it instead. */
export function ValueChart({ points }: { points: ValuePoint[] }) {
  const fonts = useTypography();
  const [width, setWidth] = useState(0);
  const [value] = linePaths([points.map(point => plotValue(point.market_value))], width, VALUE_HEIGHT);
  const first = points[0];
  return <View style={{ gap: 8 }}>
    <View accessibilityLabel={`Value over ${points.length} day${points.length === 1 ? '' : 's'}`} onLayout={event => setWidth(Math.floor(event.nativeEvent.layout.width))} style={{ height: VALUE_HEIGHT }}>
      {width > 0 ? <Svg width={width} height={VALUE_HEIGHT}>
        <Path d={value} stroke={colors.accent} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" fill="none" />
      </Svg> : null}
    </View>
    <Row><Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12, marginLeft: 'auto' }}>{points.length > 1 && first ? `Since ${first.captured_on}` : 'A point is added every day'}</Text></Row>
  </View>;
}

interface Bucket {
  key: string
  /** Under the bar. */
  label: string
  /** Above the figures. */
  title: string
  spent: string
  house_spent: string
  own_spent: string
  untracked_spent: string
  revenue: string
  realized_profit: string
  expenses: string | null
}

function fromMonth(row: MonthRow): Bucket {
  const title = new Date(`${row.month}T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return { ...row, key: row.month, label: monthLabel(row.month), title, expenses: null };
}

function fromYear(row: YearRow & { year: number }): Bucket {
  return { ...row, key: String(row.year), label: String(row.year), title: String(row.year) };
}

const BAR_HEIGHT = 120;
type Grouping = 'month' | 'year';

function Figure({ label, value, color }: { label: string; value: string; color?: string }) {
  const fonts = useTypography();
  return <View style={{ gap: 2, minWidth: 0, flexShrink: 1 }}>
    <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: 12 }}>{label}</Text>
    <Text style={{ color: color ?? colors.text, fontFamily: fonts.strong, fontSize: 22, fontVariant: ['tabular-nums'] }} allowFontScaling>{value}</Text>
  </View>;
}

/**
 * What went out against what came in, by month or by year. Spend stacks into partners' own
 * money and house money (the joint account and store credit); spend from before that split
 * was tracked sits on top in grey. Tap a bar for its exact figures; the latest is shown first.
 */
export function SpendRevenue({ months, years, trackedFrom }: { months: MonthRow[]; years: YearRow[]; trackedFrom: string | undefined }) {
  const fonts = useTypography();
  const [grouping, setGrouping] = useState<Grouping>('month');
  const [picked, setPicked] = useState<string | null>(null);
  const buckets = grouping === 'month'
    ? months.map(fromMonth)
    : years.filter((row): row is YearRow & { year: number } => row.year !== null).map(fromYear).reverse();
  const undated = grouping === 'year' ? years.find(row => row.year === null) : undefined;
  const selected = buckets.find(bucket => bucket.key === picked) ?? buckets[buckets.length - 1];
  const heights = stackHeights(buckets.flatMap(bucket => [
    [plotValue(bucket.untracked_spent), plotValue(bucket.house_spent), plotValue(bucket.own_spent)],
    [plotValue(bucket.revenue)],
  ]), BAR_HEIGHT);
  const untracked = buckets.some(bucket => plotValue(bucket.untracked_spent) > 0);
  const choose = (next: Grouping) => { setGrouping(next); setPicked(null); };

  return <View style={{ gap: 12 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: 14, flex: 1 }}>Spent vs revenue</Text>
      <Button variant={grouping === 'month' ? 'primary' : 'secondary'} label="Month" onPress={() => choose('month')} />
      <Button variant={grouping === 'year' ? 'primary' : 'secondary'} label="Year" onPress={() => choose('year')} />
    </View>
    {selected ? <View style={{ gap: 8 }}>
      <Text style={{ color: colors.text, fontFamily: fonts.strong, fontSize: 16 }}>{selected.title}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 20 }}>
        <Figure label="Spent" value={money(selected.spent)} />
        <Figure label="Revenue" value={money(selected.revenue)} color={colors.gain} />
        <Figure label="Trading profit" value={money(selected.realized_profit)} color={toneColor(selected.realized_profit)} />
      </View>
      <Copy muted>{[
        `House ${money(selected.house_spent)}`,
        `Own ${money(selected.own_spent)}`,
        plotValue(selected.untracked_spent) > 0 ? `Before tracking ${money(selected.untracked_spent)}` : null,
        selected.expenses !== null && plotValue(selected.expenses) !== 0 ? `Expenses ${money(selected.expenses)}` : null,
      ].filter(Boolean).join(' · ')}</Copy>
    </View> : <Copy muted>No dated activity yet.</Copy>}
    {buckets.length > 0 ? <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-end' }}>
      {buckets.map((bucket, index) => {
        const spent = heights[index * 2];
        const revenue = heights[index * 2 + 1];
        const active = bucket.key === selected?.key;
        return <Pressable key={bucket.key} onPress={() => setPicked(bucket.key)} accessibilityRole="button" accessibilityState={{ selected: active }}
          accessibilityLabel={`${bucket.title}: spent ${money(bucket.spent)}, revenue ${money(bucket.revenue)}`}
          style={{ flex: 1, minWidth: 0, gap: 4, alignItems: 'center', opacity: active ? 1 : 0.5 }}>
          <View style={{ height: BAR_HEIGHT, width: '100%', maxWidth: 48, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
            <View style={{ flex: 1, borderTopLeftRadius: 3, borderTopRightRadius: 3, overflow: 'hidden' }}>
              <View style={{ height: spent[0], backgroundColor: colors.muted }} />
              <View style={{ height: spent[1], backgroundColor: colors.vault }} />
              <View style={{ height: spent[2], backgroundColor: colors.accent }} />
            </View>
            <View style={{ flex: 1, height: revenue[0], backgroundColor: colors.gain, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
          </View>
          <Text numberOfLines={1} style={{ color: active ? colors.text : colors.muted, fontFamily: active ? fonts.strong : fonts.body, fontSize: 11 }}>{bucket.label}</Text>
        </Pressable>;
      })}
    </View> : null}
    <Row>
      <Swatch color={colors.accent} label="Own money" />
      <Swatch color={colors.vault} label="House money" />
      {untracked ? <Swatch color={colors.muted} label="Before tracking" /> : null}
      <Swatch color={colors.gain} label="Revenue" />
    </Row>
    {trackedFrom ? <Copy muted>{`House money is the joint account and store credit, plus whatever the joint account paid back. Split from ${trackedFrom}.`}</Copy> : null}
    {undated ? <Copy muted>{`Plus ${money(undated.spent)} of stock with no purchase date, not shown.`}</Copy> : null}
  </View>;
}
