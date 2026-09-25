import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, Card, Choice, Copy, ErrorNotice, Field, Loading, Page, Row } from '../../components/ui';
import { useApi } from '../../context/AppContext';
import { colors, useResponsiveLayout } from '../../context/ThemeContext';
import { BUCKETS, BUCKET_LABELS, type Bucket, type Product, type ProductSort, type VaultHolding } from '../../lib/api';
import { ProductForms } from '../../components/product-forms';
import { RecordSaleDialog } from '../../components/sale-form';
import { StockCard } from '../../components/stock-card';
import { RipDialog } from '../../components/rip-form';
import { RecordValuationDialog } from '../../components/valuation-form';
import { canRip } from '../../lib/product-types';
const SORTS: { value: ProductSort; label: string }[] = [
  { value: 'value_desc', label: 'Value: high to low' },
  { value: 'value_asc', label: 'Value: low to high' },
  { value: 'unit_value_desc', label: 'Unit value: high to low' },
  { value: 'type', label: 'Type, then value' },
  { value: 'quantity_desc', label: 'Quantity: most first' },
  { value: 'newest', label: 'Recently added' },
];

export default function Inventory() {
  const { isDesktop, fontScale } = useResponsiveLayout();
  const wrapLocations = !isDesktop && fontScale > 1.3;
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
  const [sort, setSort] = useState<ProductSort | ''>('');
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState(false);
  const [operation, setOperation] = useState<{ product: Product; mode: 'move' } | null>(null);
  const [selling, setSelling] = useState<Product | null>(null);
  const [ripping, setRipping] = useState<Product | null>(null);
  const [valuing, setValuing] = useState<Product | null>(null);
  useEffect(() => { const t = setTimeout(() => { setQ(search); setOffset(0); }, 250); return () => clearTimeout(t); }, [search]);
  const games = useQuery({ queryKey: ['games'], queryFn: api.games });
  const types = useQuery({ queryKey: ['productTypes'], queryFn: api.productTypes });
  const products = useQuery({ queryKey: ['products', q, game, stock, bucket, type, includeArchived, sort, offset],
    queryFn: () => api.products({ q, game, stock, bucket, product_type: type, include_archived: includeArchived, sort: sort || undefined, limit: 30, offset }) });
  // With no explicit sort, a search ranks by match; offering "Name" then is a real choice.
  const sortOptions = [{ value: '', label: q.trim() ? 'Best match' : 'Name A-Z' },
    ...(q.trim() ? [{ value: 'name', label: 'Name A-Z' }] : []), ...SORTS];
  // The Vault tab is the one Vault: its rows carry the valuation report alongside the stock.
  const vault = useQuery({ queryKey: ['vaultHoldings'], queryFn: api.vaultHoldings, enabled: bucket === 'vault' });
  const holdings = useMemo(() => new Map((vault.data ?? []).map(h => [h.product_id, h] as [string, VaultHolding])), [vault.data]);
  const activeFilters = [SORTS.find(s => s.value === sort)?.label, games.data?.find(g => g.slug === game)?.name, types.data?.find(t => t.slug === type)?.name,
    stock === 'out' ? 'Sold out' : stock === '' ? 'All products' : null, includeArchived ? 'Archived included' : null].filter(Boolean);
  return <Page title={bucket ? BUCKET_LABELS[bucket] : 'Stock'}>
    {isDesktop ? <Button label="Add product" onPress={() => setAdding(true)} /> : null}
    {adding && <ProductForms mode="add" initialName={products.data?.items.length === 0 ? q.trim() : undefined} onClose={() => setAdding(false)} />}
    {operation ? <ProductForms product={operation.product} mode={operation.mode} onClose={() => setOperation(null)} /> : null}
    {selling ? <RecordSaleDialog product={selling} onClose={() => setSelling(null)} /> : null}
    {valuing ? <RecordValuationDialog key={valuing.id} product={{ id: valuing.id, name: valuing.name }} onClose={() => setValuing(null)} /> : null}
    {ripping ? <RipDialog product={ripping} initialBucket={bucket || undefined} onClose={() => setRipping(null)} /> : null}
    <View accessibilityLabel="Stock locations" style={{ flexDirection: 'row', flexWrap: wrapLocations ? 'wrap' : 'nowrap', gap: 6 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="All stock" accessibilityState={{ selected: !bucket }} onPress={() => { router.setParams({ bucket: '' }); setOffset(0); }} style={{ flex: wrapLocations ? undefined : 1, width: wrapLocations ? '48%' : undefined, minWidth: 0, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: !bucket ? colors.accent : colors.edge, backgroundColor: !bucket ? colors.raised : 'transparent' }}><Text style={{ color: colors.accent, fontSize: 12, textAlign: 'center' }}>All</Text></Pressable>
      {BUCKETS.map(b => <Pressable key={b} accessibilityRole="button" accessibilityLabel={BUCKET_LABELS[b] + ' ' + (products.data?.bucket_totals[b] ?? '')} accessibilityState={{ selected: bucket === b }} style={{ flex: wrapLocations ? undefined : 1, width: wrapLocations ? '48%' : undefined, minWidth: 0, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: bucket === b ? colors.raised : 'transparent', borderWidth: 1, borderColor: bucket === b ? colors[b] : colors.edge }}
        onPress={() => { router.setParams({ bucket: b }); setOffset(0); }}><Text style={{ color: colors[b], fontSize: 12, textAlign: 'center' }}>{BUCKET_LABELS[b]} {products.data?.bucket_totals[b] ?? ''}</Text></Pressable>)}</View>
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}><Field label="Search products" value={search} onChangeText={setSearch} style={{ flex: 1 }} />
      {!isDesktop ? <Button style={{ minWidth: 86, paddingHorizontal: 10 }} label={filtersOpen ? 'Done' : 'Filters'} onPress={() => setFiltersOpen(value => !value)} /> : null}</View>
    {!isDesktop && !filtersOpen && activeFilters.length > 0 ? <Copy muted>{activeFilters.join(' · ')}</Copy> : null}
    {isDesktop || filtersOpen ? <Row><Choice label="Sort" value={sort} options={sortOptions}
      onChange={v=>{setSort(v as ProductSort | '');setOffset(0);}} />
    <Choice label="Game" value={game} options={[{value:'',label:'All games'}, ...(games.data ?? []).map(g=>({value:g.slug,label:g.name}))]}
      onChange={v=>{setGame(v);setOffset(0);}} />
    <Choice label="Stock" value={stock} options={[{value:'in',label:'In stock'},{value:'out',label:'Sold out'},{value:'',label:'All products'}]}
      onChange={v=>{setStock(v);setOffset(0);}} />
    <Choice label="Product type" value={type} options={[{value:'',label:'All types'}, ...(types.data ?? []).map(t=>({value:t.slug,label:t.name}))]}
      onChange={v=>{setType(v);setOffset(0);}} />
    <Choice label="Archived products" value={includeArchived ? 'include' : 'hide'} options={[{value:'hide',label:'Hide archived'},{value:'include',label:'Include archived'}]}
      onChange={v=>{setIncludeArchived(v === 'include');setOffset(0);}} /></Row> : null}
    {bucket === 'vault' ? <Copy muted>Held on purpose. Manual valuations and appreciation are unrealized estimates, separate from cost and profit.</Copy> : null}
    <ErrorNotice error={products.error ?? games.error ?? types.error ?? (bucket === 'vault' ? vault.error : null)} retry={()=>{void products.refetch();void games.refetch();void types.refetch();if (bucket === 'vault') void vault.refetch();}} />
    {products.isPending && <Loading />}
    {products.data?.items.length === 0 && <Card><Copy>No products match these filters.</Copy>
      {q.trim() ? <Button variant="primary" label={`Add "${q.trim()}"`} onPress={() => setAdding(true)} /> : null}</Card>}
    {products.data?.items.map(p => <StockCard key={p.id} product={p} bucket={bucket} dense={isDesktop} vault={bucket === 'vault' ? holdings.get(p.id) : undefined}
      onValue={bucket === 'vault' ? () => setValuing(p) : undefined}
      onDetails={() => router.push({ pathname: '/products/[productId]', params: { productId: p.id } })}
      onSell={() => setSelling(p)} onMove={() => setOperation({ product: p, mode: 'move' })}
      onRip={canRip(p.product_type.slug) ? () => setRipping(p) : undefined} />)}
    {products.data && <Row><Button label="Previous" disabled={offset===0} onPress={()=>setOffset(Math.max(0,offset-30))} />
      <Copy>{products.data.total} products</Copy><Button label="Next" disabled={offset+30>=products.data.total} onPress={()=>setOffset(offset+30)} /></Row>}
  </Page>;
}
