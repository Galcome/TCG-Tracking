import { Text } from 'react-native';
import { colors } from '../context/ThemeContext';
import type { Product } from '../lib/api';
import { money, perUnit } from '../lib/format';
import { isManualEstimate, marketPosition, unitPosition } from '../lib/pricing-drafts';
import { Copy, Row, Signed } from './ui';

// What was paid beside what it is estimated to be worth, then the same per unit, then what
// is still held beside what sales made. Every figure covers all units on hand, wherever they
// sit, so Est value lines up with Total paid. The stock card and the product page share it.
export function CostSummary({ product: p }: { product: Pick<Product, 'stats' | 'market_estimate'> }) {
  const position = marketPosition(p);
  const unit = unitPosition(p);
  // Once everything is sold the average falls back to what each unit cost when bought.
  const average = unit?.cost ?? (p.stats.quantity_purchased > 0 ? perUnit(p.stats.total_invested, p.stats.quantity_purchased) : null);
  const note = isManualEstimate(p) ? ' · your value' : p.market_estimate?.status === 'stale' ? ' · stale' : '';
  return <>
    <Row><Copy>Total paid {money(p.stats.total_invested)}</Copy>
      {position ? <Copy>Est value {money(position.value)}</Copy> : null}</Row>
    {average !== null ? <Row><Copy>Avg cost <Text style={{ color: colors.loss }}>{money(average)}</Text> each</Copy>
      {unit?.price ? <Copy>Est price <Text style={{ color: colors.gain }}>{money(unit.price)}</Text> each{note}</Copy> : null}</Row> : null}
    <Row><Copy>Cost on hand {money(p.stats.remaining_cost)}</Copy>
      <Copy>Realized <Signed value={p.stats.realized_profit}>{money(p.stats.realized_profit)}</Signed></Copy></Row>
    {unit?.profit ? <Row><Copy>Est profit <Signed value={unit.profit}>{money(unit.profit)}</Signed> each</Copy></Row> : null}
  </>;
}
