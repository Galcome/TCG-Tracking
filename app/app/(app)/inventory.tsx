import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Choice, Copy, ErrorNotice, Field, Loading, Page, Row } from '../../components/ui';
import { useApi } from '../../context/AppContext';
import { colors } from '../../context/ThemeContext';
import { BUCKETS, BUCKET_LABELS, type Bucket } from '../../lib/api';
import { money } from '../../lib/format';
import { ProductForms } from '../../components/product-forms';
export default function Inventory() {
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
  useEffect(() => { const t = setTimeout(() => { setQ(search); setOffset(0); }, 250); return () => clearTimeout(t); }, [search]);
  const games = useQuery({ queryKey: ['games'], queryFn: api.games });
  const types = useQuery({ queryKey: ['productTypes'], queryFn: api.productTypes });
  const products = useQuery({ queryKey: ['products', q, game, stock, bucket, type, includeArchived, offset],
    queryFn: () => api.products({ q, game, stock, bucket, product_type: type, include_archived: includeArchived, limit: 30, offset }) });
  return <Page title={bucket ? BUCKET_LABELS[bucket] : 'All stock'}>
    <Button label="Add product" onPress={() => setAdding(true)} />
    {adding && <ProductForms mode="add" onClose={() => setAdding(false)} />}
    <Row><Button label="All stock" onPress={() => { router.setParams({ bucket: '' }); setOffset(0); }} />
      {BUCKETS.map(b => <Button key={b} label={BUCKET_LABELS[b] + ' ' + (products.data?.bucket_totals[b] ?? '')}
        onPress={() => { router.setParams({ bucket: b }); setOffset(0); }} />)}</Row>
    <Field label="Search products" value={search} onChangeText={setSearch} />
    <Row><Choice label="Game" value={game} options={[{value:'',label:'All games'}, ...(games.data ?? []).map(g=>({value:g.slug,label:g.name}))]}
      onChange={v=>{setGame(v);setOffset(0);}} />
    <Choice label="Stock" value={stock} options={[{value:'in',label:'In stock'},{value:'out',label:'Sold out'},{value:'',label:'All products'}]}
      onChange={v=>{setStock(v);setOffset(0);}} />
    <Choice label="Product type" value={type} options={[{value:'',label:'All types'}, ...(types.data ?? []).map(t=>({value:t.slug,label:t.name}))]}
      onChange={v=>{setType(v);setOffset(0);}} />
    <Choice label="Archived products" value={includeArchived ? 'include' : 'hide'} options={[{value:'hide',label:'Hide archived'},{value:'include',label:'Include archived'}]}
      onChange={v=>{setIncludeArchived(v === 'include');setOffset(0);}} /></Row>
    <ErrorNotice error={products.error ?? games.error ?? types.error} retry={()=>{void products.refetch();void games.refetch();void types.refetch();}} />
    {products.isPending && <Loading />}
    {products.data?.items.length === 0 && <Card><Copy>No products match these filters.</Copy></Card>}
    {products.data?.items.map(p=><Card key={p.id}>
      <Row><View style={{flex:1,minWidth:200}}><Button label={p.name} onPress={()=>router.push({pathname:'/products/[productId]',params:{productId:p.id}})} />
        <Copy muted>{p.game.name} · {p.product_type.name}{p.set_name ? ' · '+p.set_name : ''}</Copy></View>
        <View style={{minWidth:120,alignItems:'center'}}><Copy>{bucket ? p.stats.by_bucket[bucket] : p.stats.quantity_on_hand}</Copy><Copy muted>{bucket ? 'In '+BUCKET_LABELS[bucket] : 'In stock'}</Copy></View></Row>
      <Row>{BUCKETS.map(b=><Text key={b} style={{color:colors[b],backgroundColor:colors.raised,padding:8,borderRadius:8}}>{BUCKET_LABELS[b]} {p.stats.by_bucket[b]}</Text>)}</Row>
      {p.is_archived ? <Copy muted>Archived · history retained</Copy> : null}
      <Row><Copy>Cost {money(p.stats.remaining_cost)}</Copy><Copy>Realized profit {money(p.stats.realized_profit)}</Copy></Row>
      <Copy muted>Market estimate {money(p.market_estimate?.value)} / unit{p.market_estimate ? ' · '+p.market_estimate.provider+' · '+p.market_estimate.status+' · '+(p.market_estimate.captured_on ?? 'No date') : ''}</Copy>
    </Card>)}
    {products.data && <Row><Button label="Previous" disabled={offset===0} onPress={()=>setOffset(Math.max(0,offset-30))} />
      <Copy>{products.data.total} products</Copy><Button label="Next" disabled={offset+30>=products.data.total} onPress={()=>setOffset(offset+30)} /></Row>}
  </Page>;
}
