import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Button, Card, Copy, Disclosure, ErrorNotice, Loading, Page, Row, Signed } from '../../../components/ui';
import { View, Text } from 'react-native';
import { colors } from '../../../context/ThemeContext';
import { ProductForms, type ProductFormsProps } from '../../../components/product-forms';
import { RecordSaleDialog } from '../../../components/sale-form';
import { ProductOperations } from '../../../components/product-operations';
import { LineageReport } from '../../../components/lineage-report';
import { PriceSuggestion, PricingControls } from '../../../components/pricing-controls';
import { ProductLifecycle } from '../../../components/product-lifecycle';
import { RecordValuationDialog } from '../../../components/valuation-form';
import { GameIdentity } from '../../../components/game-identity';
import { useApi } from '../../../context/AppContext';
import type { Transaction } from '../../../lib/api';
import { money } from '../../../lib/format';
import { canCrack, canRip } from '../../../lib/product-types';
/** Active purchases, which are the only rows whose cost can still be corrected. One of them
 *  means "edit the cost" is unambiguous; several means the caller must pick a lot. */
function openPurchases(product: { history: Transaction[] }): Transaction[] {
  return product.history.filter((entry) => entry.kind === 'purchase' && entry.status === 'active');
}

export default function ProductDetail() {
  const { productId } = useLocalSearchParams<{productId:string}>();
  const api = useApi();
  const [form, setForm] = useState<Omit<ProductFormsProps, 'onClose' | 'product'> | null>(null);
  const [selling, setSelling] = useState(false);
  const [valuing, setValuing] = useState(false);
  const product = useQuery({queryKey:['product',productId],queryFn:()=>api.product(productId),enabled:Boolean(productId)});
  const p=product.data;
  return <Page title={p?.name ?? 'Product'}>
    <Button variant="link" label="Back to stock" onPress={() => router.push('/inventory')} />
    <ErrorNotice error={product.error} retry={()=>{void product.refetch();}} />{product.isPending&&<Loading />}
    {p&&<><Card><GameIdentity slug={p.game.slug} name={p.game.name} /><Copy>{p.product_type.name}</Copy>
      <Copy>{[p.set_name && p.name.includes(p.set_name) ? null : p.set_name,p.collector_number,p.variant,p.language,p.condition,p.grading_company,p.grade,p.cert_number].filter(Boolean).join(' · ')}</Copy>
      <Row>{(['inventory', 'store', 'vault'] as const).map(bucket => <View key={bucket} style={{ padding: 8, borderRadius: 8, backgroundColor: colors.raised }}><Text style={{ color: colors[bucket], fontSize: 14 }}>{bucket === 'inventory' ? 'Inventory' : bucket === 'store' ? 'Store' : 'Vault'} {p.stats.by_bucket[bucket]}</Text></View>)}</Row>
      <Copy>On hand {p.stats.quantity_on_hand}</Copy>
      <Row><Copy>Remaining cost {money(p.stats.remaining_cost)}</Copy><Copy>Realized profit <Signed value={p.stats.realized_profit}>{money(p.stats.realized_profit)}</Signed></Copy></Row>
      {openPurchases(p).length === 1 ? <Button variant="link" label="Edit what this cost" onPress={() => setForm({ mode: 'transaction', transaction: openPurchases(p)[0] })} /> : null}
      {p.notes ? <Copy muted>{p.notes}</Copy> : null}</Card>
      <Row><Button variant="primary" label="Record sale" disabled={p.stats.quantity_on_hand <= 0 || p.is_archived} onPress={() => setSelling(true)} /><Button label="Add purchase" disabled={p.is_archived} onPress={() => setForm({ mode: 'purchase' })} /><Button label="Move stock" disabled={p.stats.quantity_on_hand <= 0 || p.is_archived} onPress={() => setForm({ mode: 'move' })} /></Row>
      <Disclosure title="Manage product"><Row>{([{ mode: 'edit', label: 'Edit product' }, { mode: 'adjust', label: 'Adjust stock' }] as const).map(action =>
          <Button key={action.mode} label={action.label} onPress={() => setForm({ mode: action.mode })} />)}</Row>
      <Button label="Record valuation" onPress={() => setValuing(true)} />
      <ProductLifecycle product={p} /></Disclosure>
      {form && <ProductForms {...form} product={p} onClose={() => setForm(null)} />}
      {selling && <RecordSaleDialog product={p} onClose={() => setSelling(false)} />}
      {valuing && <RecordValuationDialog key={p.id} product={p} onClose={() => setValuing(false)} />}
      <Card><Copy muted>Market estimate · CAD / unit</Copy><Copy>{p.market_estimate?.value == null ? 'No market estimate' : money(p.market_estimate.value)}</Copy>{p.market_estimate ? <Copy muted>{p.market_estimate.status} · {p.market_estimate.captured_on ?? 'Date unavailable'}</Copy> : null}</Card>
      <PriceSuggestion product={p} />
      <Disclosure title="Market pricing"><PricingControls product={p} /></Disclosure>
      <Disclosure title="Rip, crack and grading" defaultOpen={p.stats.quantity_on_hand > 0 && (canRip(p.product_type.slug) || canCrack(p.product_type.slug))}><ProductOperations key={p.id} product={p} /></Disclosure>
      <Disclosure title="Cost lineage"><LineageReport productId={p.id} /></Disclosure>
      <Disclosure title="Transaction history" defaultOpen={p.history.length > 0}>{p.history.map(t=><Card key={t.kind+t.id}><Copy>{t.kind} · {t.occurred_on ?? 'No date'} · {t.status}</Copy>
        <Copy>Quantity {t.quantity} · Amount {money(t.amount)} · Cost {money(t.cost)}</Copy><Copy muted>{t.notes}</Copy>
        {t.status === 'active' && <Row>
          {t.kind !== 'move' && <Button label={'Edit ' + t.kind} onPress={() => setForm({ mode: 'transaction', transaction: t })} />}
          <Button label={'Void ' + t.kind} danger onPress={() => setForm({ mode: 'void', transaction: t })} />
        </Row>}</Card>)}</Disclosure></>}
  </Page>;
}
