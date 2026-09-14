import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { Button, Card, Choice, Copy, ErrorNotice, Field, Loading, Page, Row } from '../../components/ui';
import { useApi } from '../../context/AppContext';
import { colors, useResponsiveLayout } from '../../context/ThemeContext';
import { BUCKETS, BUCKET_LABELS, type Bucket, type Product } from '../../lib/api';
import { ProductForms } from '../../components/product-forms';
import { RecordSaleDialog } from '../../components/sale-form';
import { StockCard } from '../../components/stock-card';
export default function Inventory() {
  const { isDesktop } = useResponsiveLayout();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const api = useApi();
  const params = useLocalSearchParams<{ bucket?: string }>();
  const bucket = BUCKETS.includes(params.bucket as Bucket) ? params.bucket as Bucket : '';
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [game, setGame] = useState('');
  const [stock, setStock] = useState('in');
  const [type, setType] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState(false);
  const [operation, setOperation] = useState<{ product: Product; mode: 'move' | 'edit' } | null>(null);
  const [selling, setSelling] = useState<Product | null>(null);
  useEffect(() => { const t = setTimeout(() => { setQ(search); setOffset(0); }, 250); return () => clearTimeout(t); }, [search]);
  const games = useQuery({ queryKey: ['games'], queryFn: api.games });
  const types = useQuery({ queryKey: ['productTypes'], queryFn: api.productTypes });
  const products = useQuery({ queryKey: ['products', q, game, stock, bucket, type, includeArchived, offset],
    queryFn: () => api.products({ q, game, stock, bucket, product_type: type, include_archived: includeArchived, limit: 30, offset }) });
  return <Page title={bucket ? BUCKET_LABELS[bucket] : 'All stock'}>
    <Button label="Add product" onPress={() => setAdding(true)} />
    {adding && <ProductForms mode="add" onClose={() => setAdding(false)} />}
    {operation ? <ProductForms product={operation.product} mode={operation.mode} onClose={() => setOperation(null)} /> : null}
    {selling ? <RecordSaleDialog product={selling} onClose={() => setSelling(null)} /> : null}
    <Row><Button label="All stock" onPress={() => { router.setParams({ bucket: '' }); setOffset(0); }} />
      {BUCKETS.map(b => <Pressable key={b} accessibilityRole="button" accessibilityLabel={BUCKET_LABELS[b] + ' ' + (products.data?.bucket_totals[b] ?? '')} accessibilityState={{ selected: bucket === b }} style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 8, backgroundColor: bucket === b ? colors.raised : 'transparent', borderWidth: 1, borderColor: bucket === b ? colors[b] : colors.edge }}
        onPress={() => { router.setParams({ bucket: b }); setOffset(0); }}><Text style={{ color: colors[b], fontSize: 14 }}>{BUCKET_LABELS[b]} {products.data?.bucket_totals[b] ?? ''}</Text></Pressable>)}</Row>
    <Field label="Search products" value={search} onChangeText={setSearch} />
    {!isDesktop ? <Button label={filtersOpen ? 'Hide filters' : 'Show filters'} onPress={() => setFiltersOpen(value => !value)} /> : null}
    {!isDesktop && !filtersOpen ? <Copy muted>{[games.data?.find(g => g.slug === game)?.name ?? 'All games', types.data?.find(t => t.slug === type)?.name ?? 'All types', stock === 'in' ? 'In stock' : stock === 'out' ? 'Sold out' : 'All products', includeArchived ? 'Including archived' : 'Hide archived'].join(' · ')}</Copy> : null}
    {isDesktop || filtersOpen ? <Row><Choice label="Game" value={game} options={[{value:'',label:'All games'}, ...(games.data ?? []).map(g=>({value:g.slug,label:g.name}))]}
      onChange={v=>{setGame(v);setOffset(0);}} />
    <Choice label="Stock" value={stock} options={[{value:'in',label:'In stock'},{value:'out',label:'Sold out'},{value:'',label:'All products'}]}
      onChange={v=>{setStock(v);setOffset(0);}} />
    <Choice label="Product type" value={type} options={[{value:'',label:'All types'}, ...(types.data ?? []).map(t=>({value:t.slug,label:t.name}))]}
      onChange={v=>{setType(v);setOffset(0);}} />
    <Choice label="Archived products" value={includeArchived ? 'include' : 'hide'} options={[{value:'hide',label:'Hide archived'},{value:'include',label:'Include archived'}]}
      onChange={v=>{setIncludeArchived(v === 'include');setOffset(0);}} /></Row> : null}
    <ErrorNotice error={products.error ?? games.error ?? types.error} retry={()=>{void products.refetch();void games.refetch();void types.refetch();}} />
    {products.isPending && <Loading />}
    {products.data?.items.length === 0 && <Card><Copy>No products match these filters.</Copy></Card>}
    {products.data?.items.map(p => <StockCard key={p.id} product={p} bucket={bucket} dense={isDesktop}
      onDetails={() => router.push({ pathname: '/products/[productId]', params: { productId: p.id } })}
      onSell={() => setSelling(p)} onMove={() => setOperation({ product: p, mode: 'move' })}
      onEdit={() => setOperation({ product: p, mode: 'edit' })} />)}
    {products.data && <Row><Button label="Previous" disabled={offset===0} onPress={()=>setOffset(Math.max(0,offset-30))} />
      <Copy>{products.data.total} products</Copy><Button label="Next" disabled={offset+30>=products.data.total} onPress={()=>setOffset(offset+30)} /></Row>}
  </Page>;
}
