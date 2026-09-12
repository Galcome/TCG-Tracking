import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Button, Card, Copy, ErrorNotice, Loading, Page, Row } from '../../../components/ui';
import { ProductForms, type ProductFormsProps } from '../../../components/product-forms';
import { RecordSaleDialog } from '../../../components/sale-form';
import { ProductOperations } from '../../../components/product-operations';
import { LineageReport } from '../../../components/lineage-report';
import { PricingControls } from '../../../components/pricing-controls';
import { ProductLifecycle } from '../../../components/product-lifecycle';
import { RecordValuationDialog } from '../../../components/valuation-form';
import { useApi } from '../../../context/AppContext';
import { money } from '../../../lib/format';
export default function ProductDetail() {
  const { productId } = useLocalSearchParams<{productId:string}>();
  const api = useApi();
  const [form, setForm] = useState<Omit<ProductFormsProps, 'onClose' | 'product'> | null>(null);
  const [selling, setSelling] = useState(false);
  const [valuing, setValuing] = useState(false);
  const product = useQuery({queryKey:['product',productId],queryFn:()=>api.product(productId),enabled:Boolean(productId)});
  const p=product.data;
  return <Page title={p?.name ?? 'Product'}>
    <ErrorNotice error={product.error} retry={()=>{void product.refetch();}} />{product.isPending&&<Loading />}
    {p&&<><Card><Copy>{p.game.name} · {p.product_type.name}</Copy>
      <Copy>{[p.set_name,p.collector_number,p.variant,p.language,p.condition,p.grading_company,p.grade,p.cert_number].filter(Boolean).join(' · ')}</Copy>
      <Row><Copy>On hand {p.stats.quantity_on_hand}</Copy><Copy>Cost {money(p.stats.remaining_cost)}</Copy><Copy>Profit {money(p.stats.realized_profit)}</Copy></Row>
      <Copy muted>{p.notes ?? 'No notes'}</Copy></Card>
      <Row>{([{ mode: 'edit', label: 'Edit product' }, { mode: 'purchase', label: 'Add purchase' },
        { mode: 'move', label: 'Move stock' }, { mode: 'adjust', label: 'Adjust stock' }] as const).map(action =>
          <Button key={action.mode} label={action.label} onPress={() => setForm({ mode: action.mode })} />)}</Row>
      {form && <ProductForms {...form} product={p} onClose={() => setForm(null)} />}
      <Button label="Record sale" onPress={() => setSelling(true)} />
      {selling && <RecordSaleDialog product={p} onClose={() => setSelling(false)} />}
      <Button label="Record valuation" onPress={() => setValuing(true)} />
      {valuing && <RecordValuationDialog key={p.id} product={p} onClose={() => setValuing(false)} />}
      <PricingControls product={p} />
      <ProductLifecycle product={p} />
      <ProductOperations key={p.id} product={p} />
      <LineageReport productId={p.id} />
      {p.history.map(t=><Card key={t.kind+t.id}><Copy>{t.kind} · {t.occurred_on ?? 'No date'} · {t.status}</Copy>
        <Copy>Quantity {t.quantity} · Amount {money(t.amount)} · Cost {money(t.cost)}</Copy><Copy muted>{t.notes}</Copy>
        {t.status === 'active' && <Row>
          {t.kind !== 'move' && <Button label={'Edit ' + t.kind} onPress={() => setForm({ mode: 'transaction', transaction: t })} />}
          <Button label={'Void ' + t.kind} danger onPress={() => setForm({ mode: 'void', transaction: t })} />
        </Row>}</Card>)}</>}
  </Page>;
}
