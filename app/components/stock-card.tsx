import { Pressable, Text, View } from 'react-native';
import { colors } from '../context/ThemeContext';
import { useTypography } from '../context/TypographyContext';
import { BUCKETS, BUCKET_LABELS, type Bucket, type Product, type VaultHolding } from '../lib/api';
import { money } from '../lib/format';
import { canUseFreeMarketPricing, marketPosition } from '../lib/pricing-drafts';
import { GameIdentity } from './game-identity';
import { Button, Card, Copy, Row, Signed } from './ui';
import { VaultDetails, VaultSummary } from './vault-valuation';

// The app ships no icon font, so the row shortcuts are glyphs with a one-word caption,
// named in full for screen readers.
function IconButton({ glyph, caption, label, onPress }: { glyph: string; caption: string; label: string; onPress: () => void }) {
  const fonts = useTypography();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={4}
    style={({ pressed }) => ({ minWidth: 52, height: 52, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: colors.edge, backgroundColor: colors.raised, opacity: pressed ? 0.7 : 1 })}>
    <Text accessible={false} style={{ color: colors.accent, fontSize: 18, lineHeight: 22 }}>{glyph}</Text>
    <Text accessible={false} style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: 11 }}>{caption}</Text>
  </Pressable>;
}

// Editing is rare from a list, so it is small captioned icons rather than a fourth
// equal-weight button. Edit and Cost open their forms in place, so fixing a wrong type or
// an imported $0.00 cost is not two screens away; the name still opens the product page.
// On the Vault tab the row carries the Vault holding, so manual worth and appreciation
// replace the market position: the Vault is valued, not priced.
export function StockCard({ product: p, bucket, dense, vault, onDetails, onEdit, onSell, onMove, onRip, onValue, onEditCost, onToggleHidden }: {
  product: Product; bucket: Bucket | ''; dense: boolean; vault?: VaultHolding;
  onDetails: () => void; onEdit: () => void; onSell: () => void; onMove: () => void; onRip?: () => void; onValue?: () => void;
  onEditCost?: () => void; onToggleHidden?: () => void;
}) {
  const fonts = useTypography();
  const noStock = p.is_archived || p.stats.quantity_on_hand <= 0;
  const position = marketPosition(p);
  const setRepeatsName = Boolean(p.set_name && p.name.toLocaleLowerCase().includes(p.set_name.toLocaleLowerCase()));
  return <View role="group" accessibilityLabel={'Stock product: ' + p.name}><Card><View style={{ flexDirection: dense ? 'row' : 'column', flexWrap: 'wrap', alignItems: dense ? 'center' : 'stretch', gap: 16 }}>
    <View style={{ flexGrow: 1, flexBasis: dense ? 260 : undefined, gap: 8 }}>
      <Row><View style={{ flex: 1, minWidth: 160 }}>
        <Button variant="link" label={p.name} onPress={onDetails} />
        <GameIdentity slug={p.game.slug} name={p.game.name} />
        <Copy muted>{p.product_type.name}{p.set_name && !setRepeatsName ? ' · ' + p.set_name : ''}</Copy>
      </View><View style={{ minWidth: 80, alignItems: 'center' }}>
        <Copy>{bucket ? p.stats.by_bucket[bucket] : p.stats.quantity_on_hand}</Copy>
        <Copy muted>{bucket ? 'In ' + BUCKET_LABELS[bucket] : 'In stock'}</Copy>
      </View><View style={{ flexDirection: 'row', gap: 8 }}>
        <IconButton glyph="✎" caption="Edit" label="Edit product" onPress={onEdit} />
        {onEditCost ? <IconButton glyph="$" caption="Cost" label="Edit cost" onPress={onEditCost} /> : null}
        {onToggleHidden ? <IconButton glyph={p.is_hidden ? '◉' : '⊘'} caption={p.is_hidden ? 'Unhide' : 'Hide'} label={p.is_hidden ? 'Unhide product' : 'Hide product'} onPress={onToggleHidden} /> : null}
      </View></Row>
      <Row>{BUCKETS.map(b => <Text key={b} style={{ fontFamily: fonts.medium, fontSize: 12, color: colors[b], backgroundColor: colors.raised, padding: 8, borderRadius: 8 }}>{BUCKET_LABELS[b]} {p.stats.by_bucket[b]}</Text>)}</Row>
      {p.is_archived ? <Copy muted>Archived · history retained</Copy> : null}
      {p.is_hidden ? <Copy muted>Hidden · left out of stock totals</Copy> : null}
    </View>
    <View style={{ flexGrow: 1, flexBasis: dense ? 250 : undefined, gap: 6 }}>
      {vault ? <VaultSummary holding={vault} /> : <>
      <Row><Copy>Cost {money(p.stats.remaining_cost)}</Copy><Copy>Profit <Signed value={p.stats.realized_profit}>{money(p.stats.realized_profit)}</Signed></Copy></Row>
      {position ? <Row><Copy>{bucket && p.stats.by_bucket[bucket] !== p.stats.quantity_on_hand ? `Value of all ${p.stats.quantity_on_hand}` : 'Value'} {money(position.value)}</Copy><Copy>Unrealized <Signed value={position.unrealized}>{money(position.unrealized)}</Signed></Copy></Row> : null}
      {position ? <Copy muted>{money(p.market_estimate?.value)} / unit{p.market_estimate?.status === 'stale' ? ' · stale' : ''}</Copy> : null}
      {!position && !noStock && !p.market_estimate?.value && canUseFreeMarketPricing(p) ? <Button variant="link" label="Set up price" onPress={onDetails} /> : null}</>}
    </View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button variant="primary" style={{ flexGrow: 1, paddingHorizontal: 10 }} label="Sell" disabled={noStock} onPress={onSell} />
      <Button style={{ flexGrow: 1, paddingHorizontal: 10 }} label="Move" disabled={noStock} onPress={onMove} />
      {onRip ? <Button style={{ flexGrow: 1, paddingHorizontal: 10 }} label="Rip" disabled={noStock} onPress={onRip} /> : null}
      {onValue ? <Button style={{ flexGrow: 1, paddingHorizontal: 10 }} label="Record valuation" onPress={onValue} /> : null}</View>
  </View>{vault ? <VaultDetails holding={vault} /> : null}</Card></View>;
}
