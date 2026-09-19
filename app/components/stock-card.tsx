import { Text, View } from 'react-native';
import { colors } from '../context/ThemeContext';
import { useTypography } from '../context/TypographyContext';
import { BUCKETS, BUCKET_LABELS, type Bucket, type Product } from '../lib/api';
import { money } from '../lib/format';
import { canUseFreeMarketPricing, marketPosition } from '../lib/pricing-drafts';
import { GameIdentity } from './game-identity';
import { Button, Card, Copy, Row, Signed } from './ui';

// Edit lives on the product page: it is rare from a list, and a fourth equal-weight button
// crowded the actions that are not.
export function StockCard({ product: p, bucket, dense, onDetails, onSell, onMove, onRip }: {
  product: Product; bucket: Bucket | ''; dense: boolean;
  onDetails: () => void; onSell: () => void; onMove: () => void; onRip?: () => void;
}) {
  const fonts = useTypography();
  const noStock = p.is_archived || p.stats.quantity_on_hand <= 0;
  const position = marketPosition(p);
  const setRepeatsName = Boolean(p.set_name && p.name.toLocaleLowerCase().includes(p.set_name.toLocaleLowerCase()));
  return <Card><View role="group" accessibilityLabel={'Stock product: ' + p.name} style={{ flexDirection: dense ? 'row' : 'column', flexWrap: 'wrap', alignItems: dense ? 'center' : 'stretch', gap: 16 }}>
    <View style={{ flexGrow: 1, flexBasis: dense ? 260 : undefined, gap: 8 }}>
      <Row><View style={{ flex: 1, minWidth: 160 }}>
        <Button variant="link" label={p.name} onPress={onDetails} />
        <GameIdentity slug={p.game.slug} name={p.game.name} />
        <Copy muted>{p.product_type.name}{p.set_name && !setRepeatsName ? ' · ' + p.set_name : ''}</Copy>
      </View><View style={{ minWidth: 80, alignItems: 'center' }}>
        <Copy>{bucket ? p.stats.by_bucket[bucket] : p.stats.quantity_on_hand}</Copy>
        <Copy muted>{bucket ? 'In ' + BUCKET_LABELS[bucket] : 'In stock'}</Copy>
      </View></Row>
      <Row>{BUCKETS.map(b => <Text key={b} style={{ fontFamily: fonts.medium, fontSize: 12, color: colors[b], backgroundColor: colors.raised, padding: 8, borderRadius: 8 }}>{BUCKET_LABELS[b]} {p.stats.by_bucket[b]}</Text>)}</Row>
      {p.is_archived ? <Copy muted>Archived · history retained</Copy> : null}
    </View>
    <View style={{ flexGrow: 1, flexBasis: dense ? 250 : undefined, gap: 6 }}>
      <Row><Copy>Cost {money(p.stats.remaining_cost)}</Copy><Copy>Profit <Signed value={p.stats.realized_profit}>{money(p.stats.realized_profit)}</Signed></Copy></Row>
      {position ? <Row><Copy>Value {money(position.value)}</Copy><Copy>Unrealized <Signed value={position.unrealized}>{money(position.unrealized)}</Signed></Copy></Row> : null}
      {position ? <Copy muted>{money(p.market_estimate?.value)} / unit{p.market_estimate?.status === 'stale' ? ' · stale' : ''}</Copy> : null}
      {!position && !noStock && !p.market_estimate?.value && canUseFreeMarketPricing(p) ? <Button variant="link" label="Set up price" onPress={onDetails} /> : null}
    </View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button variant="primary" style={{ flexGrow: 1, paddingHorizontal: 10 }} label="Sell" disabled={noStock} onPress={onSell} />
      <Button style={{ flexGrow: 1, paddingHorizontal: 10 }} label="Move" disabled={noStock} onPress={onMove} />
      {onRip ? <Button style={{ flexGrow: 1, paddingHorizontal: 10 }} label="Rip" disabled={noStock} onPress={onRip} /> : null}</View>
  </View></Card>;
}
