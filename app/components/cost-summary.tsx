import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../context/ThemeContext';
import type { Product } from '../lib/api';
import { money, perUnit } from '../lib/format';
import { isManualEstimate, marketPosition, unitPosition } from '../lib/pricing-drafts';
import { Copy, Signed } from './ui';

// What was paid beside what it is estimated to be worth, then the same per unit, then what
// is still held beside what sales made, then the estimated profit each and in total. Every
// figure covers all units on hand, wherever they sit, so Est value lines up with Total paid.
// Laid out as two columns, so the right-hand figures start at the same place on every line
// and, with the left column's floor width, on every card.
// The stock card and the product page share it.
export function CostSummary({ product: p }: { product: Pick<Product, 'stats' | 'market_estimate'> }) {
  const position = marketPosition(p);
  const unit = unitPosition(p);
  // Once everything is sold the average falls back to what each unit cost when bought.
  const average = unit?.cost ?? (p.stats.quantity_purchased > 0 ? perUnit(p.stats.total_invested, p.stats.quantity_purchased) : null);
  const note = isManualEstimate(p) ? ' · your value' : p.market_estimate?.status === 'stale' ? ' · stale' : '';
  const profit = unit?.profit;
  // A missing right-hand figure keeps its line, so the ones below it stay beside their pair.
  const blank = <Copy>{' '}</Copy>;
  return <View style={{ flexDirection: 'row', columnGap: 20 }}>
    <View style={[styles.column, { minWidth: 180 }]}>
      <Copy>Total paid {money(p.stats.total_invested)}</Copy>
      {average !== null ? <Copy>Avg cost <Text style={{ color: colors.loss }}>{money(average)}</Text> each</Copy> : null}
      <Copy>Cost on hand {money(p.stats.remaining_cost)}</Copy>
      {profit ? <Copy>Est profit <Signed value={profit}>{money(profit)}</Signed> each</Copy> : null}
    </View>
    <View style={styles.column}>
      {position ? <Copy>Est value {money(position.value)}</Copy> : blank}
      {average !== null ? unit?.price ? <Copy>Est price <Text style={{ color: colors.gain }}>{money(unit.price)}</Text> each{note}</Copy> : blank : null}
      <Copy>Realized <Signed value={p.stats.realized_profit}>{money(p.stats.realized_profit)}</Signed></Copy>
      {profit ? position ? <Copy>Est profit total <Signed value={position.unrealized}>{money(position.unrealized)}</Signed></Copy> : blank : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({ column: { gap: 6, flexShrink: 1 } });
