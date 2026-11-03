import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../context/ThemeContext';
import type { Product } from '../lib/api';
import { money, perUnit } from '../lib/format';
import { isManualEstimate, marketPosition, unitPosition } from '../lib/pricing-drafts';
import { Copy, Signed } from './ui';

// One line of the block: a left figure and the right figure it pairs with. Both cells start
// from the same width and shrink alike, so the right-hand figures begin at the same place on
// every line and every card, and a figure that wraps on a phone keeps its pair beside it.
function Pair({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return <View style={styles.pair}><View style={styles.cell}>{left}</View><View style={[styles.cell, { flexGrow: 1 }]}>{right}</View></View>;
}

// What was paid beside what it is estimated to be worth, then the same per unit, then what
// is still held beside what sales made, then the estimated profit each and in total. Every
// figure covers all units on hand, wherever they sit, so Est value lines up with Total paid.
// The stock card and the product page share it.
export function CostSummary({ product: p }: { product: Pick<Product, 'stats' | 'market_estimate'> }) {
  const position = marketPosition(p);
  const unit = unitPosition(p);
  // Once everything is sold the average falls back to what each unit cost when bought.
  const average = unit?.cost ?? (p.stats.quantity_purchased > 0 ? perUnit(p.stats.total_invested, p.stats.quantity_purchased) : null);
  const note = isManualEstimate(p) ? ' · your value' : p.market_estimate?.status === 'stale' ? ' · stale' : '';
  const profit = unit?.profit;
  return <View style={{ gap: 6 }}>
    <Pair left={<Copy>Total paid {money(p.stats.total_invested)}</Copy>}
      right={position ? <Copy>Est value {money(position.value)}</Copy> : null} />
    {average !== null ? <Pair left={<Copy>Avg cost <Text style={{ color: colors.loss }}>{money(average)}</Text> each</Copy>}
      right={unit?.price ? <Copy>Est price <Text style={{ color: colors.gain }}>{money(unit.price)}</Text> each{note}</Copy> : null} /> : null}
    <Pair left={<Copy>Cost on hand {money(p.stats.remaining_cost)}</Copy>}
      right={<Copy>Realized <Signed value={p.stats.realized_profit}>{money(p.stats.realized_profit)}</Signed></Copy>} />
    {profit ? <Pair left={<Copy>Est profit <Signed value={profit}>{money(profit)}</Signed> each</Copy>}
      right={position ? <Copy>Est profit total <Signed value={position.unrealized}>{money(position.unrealized)}</Signed></Copy> : null} /> : null}
  </View>;
}

const styles = StyleSheet.create({ pair: { flexDirection: 'row', columnGap: 20 }, cell: { flexBasis: 180, flexShrink: 1, minWidth: 0 } });
