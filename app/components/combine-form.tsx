import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useApi } from '../context/AppContext';
import { BUCKETS, BUCKET_LABELS, type Bucket, type Product } from '../lib/api';
import { addProducts, bucketsFree, combineInputs, combineQuantity, lineKey, sharedGame, type AddMode, type CombineDraftLine } from '../lib/combine-drafts';
import { money } from '../lib/format';
import { Button, Card, Choice, Copy, ErrorNotice, Field, Heading, Loading, Row, Sheet } from './ui';

const PAGE = 30;
/** The products endpoint's largest page; "Add all" walks the whole result in these. */
const BULK_PAGE = 200;

/**
 * Bundle stock into one new product - a whole set of singles sold as one unit.
 *
 * Find products with the game, set and search filters, add them, trim the list, and the
 * preview shows what the bundle will cost (the cards' FIFO cost added up) and what they are
 * worth together today. Nothing is written until "Combine".
 */
export function CombineDialog({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const queries = useQueryClient();
  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState('');
  const [bundleGame, setBundleGame] = useState('');
  const [bundleSet, setBundleSet] = useState('');
  const [bucket, setBucket] = useState<Bucket>('inventory');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<CombineDraftLine[]>([]);

  const [game, setGame] = useState('');
  const [setId, setSetId] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  useEffect(() => { const t = setTimeout(() => { setQ(search); setOffset(0); }, 250); return () => clearTimeout(t); }, [search]);

  const games = useQuery({ queryKey: ['games'], queryFn: api.games });
  const types = useQuery({ queryKey: ['productTypes'], queryFn: api.productTypes });
  const sets = useQuery({ queryKey: ['sets', game, 'used'], queryFn: () => api.sets({ game, used: true, limit: 200 }), enabled: game !== '' });
  // Hidden stock is still stock, and a set's singles are often hidden off the main list.
  const finder = { q, game, set_id: setId || undefined, stock: 'in', hidden: 'include' as const };
  const found = useQuery({ queryKey: ['products', 'combine', finder, offset], queryFn: () => api.products({ ...finder, limit: PAGE, offset }) });

  // A bundle of singles is a Collection unless somebody says otherwise.
  const bundleType = typeId || types.data?.find(t => t.slug === 'collection')?.id || '';

  const addAll = useMutation({
    mutationFn: async (mode: AddMode) => {
      const everything: Product[] = [];
      for (let at = 0; ; at += BULK_PAGE) {
        const page = await api.products({ ...finder, sort: 'name', limit: BULK_PAGE, offset: at });
        everything.push(...page.items);
        if (at + BULK_PAGE >= page.total) return { everything, mode };
      }
    },
    onSuccess: ({ everything, mode }) => setLines(current => addProducts(current, everything, mode)),
  });

  const inputs = combineInputs(lines);
  // Debounced so typing a quantity is one preview, not one per keystroke.
  const [previewKey, setPreviewKey] = useState(inputs);
  const inputsJson = JSON.stringify(inputs);
  useEffect(() => { const t = setTimeout(() => setPreviewKey(JSON.parse(inputsJson)), 300); return () => clearTimeout(t); }, [inputsJson]);
  const preview = useQuery({
    queryKey: ['combinePreview', previewKey],
    queryFn: () => api.previewCombine({ inputs: previewKey ?? [] }),
    enabled: Boolean(previewKey?.length),
    placeholderData: previous => previous,
  });
  const short = useMemo(() => (preview.data?.inputs ?? []).filter(row => row.quantity > row.available), [preview.data]);

  const derivedGame = sharedGame(lines);
  const gameNeeded = lines.length > 0 && derivedGame === null;
  const selected = new Set(lines.map(line => line.product_id));
  const units = (inputs ?? []).reduce((sum, input) => sum + input.quantity, 0);

  const submit = useMutation({
    mutationFn: () => {
      if (!name.trim()) throw new Error('Give the bundle a name.');
      if (!bundleType) throw new Error('Pick a product type for the bundle.');
      if (!inputs?.length) throw new Error('Add at least one product, each with a whole-number quantity.');
      if (gameNeeded && !bundleGame) throw new Error('These come from different games. Pick the game the bundle belongs to.');
      return api.combineProducts({
        name: name.trim(), product_type_id: bundleType, game_id: gameNeeded ? bundleGame : undefined,
        set_name: bundleSet.trim() || null, bucket, inputs, notes: notes.trim() || null,
      });
    },
    onSuccess: async (record) => {
      await queries.invalidateQueries();
      onClose();
      // Like adding a product: land where it was stored, newest first, so the bundle is on top.
      const bundle = record.outputs[0]?.product_id;
      if (bundle) router.push({ pathname: '/inventory', params: { bucket, added: bundle } });
    },
  });
  const busy = submit.isPending || addAll.isPending;

  const update = (key: string, change: Partial<CombineDraftLine>) =>
    setLines(current => current.map(line => lineKey(line) === key ? { ...line, ...change } : line));
  const remove = (key: string) => setLines(current => current.filter(line => lineKey(line) !== key));
  const pickSet = (value: string) => {
    setSetId(value); setOffset(0);
    const chosen = sets.data?.items.find(s => s.id === value);
    if (chosen && !bundleSet.trim()) setBundleSet(chosen.name);
  };

  const footer = <>
    {inputs && inputs.length > 0 && preview.data ? <Copy>
      {lines.length} products, {units} units · Cost {preview.data.has_unknown_cost ? 'unknown' : money(preview.data.total_cost)} · Worth {money(preview.data.estimated_value)}{preview.data.unpriced ? ` (${preview.data.unpriced} unpriced)` : ''}
    </Copy> : null}
    <ErrorNotice error={submit.error} />
    <Button variant="primary" label={submit.isPending ? 'Combining...' : `Combine ${lines.length} products`}
      disabled={busy || !inputs?.length || short.length > 0} onPress={() => submit.mutate()} />
  </>;

  return <Sheet title="Combine products" open onClose={onClose} dismissDisabled={busy} footer={footer}>
    <Copy muted>The products leave stock and one new product arrives carrying their cost. Its worth is recorded as what they are valued at today. Break it apart later to put everything back.</Copy>
    <Field label="Bundle name" value={name} onChangeText={setName} placeholder="151 Master Set" editable={!busy} />
    <Row>
      <Choice label="Bundle type" value={bundleType} options={(types.data ?? []).map(t => ({ value: t.id, label: t.name }))} onChange={setTypeId} disabled={busy} />
      <Choice label="Goes to" value={bucket} options={BUCKETS.map(b => ({ value: b, label: BUCKET_LABELS[b] }))} onChange={v => setBucket(v as Bucket)} disabled={busy} />
      {gameNeeded ? <Choice label="Bundle game" value={bundleGame} options={(games.data ?? []).map(g => ({ value: g.id, label: g.name }))} onChange={setBundleGame} disabled={busy} /> : null}
    </Row>
    <Field label="Bundle set (optional)" value={bundleSet} onChangeText={setBundleSet} editable={!busy} />
    <Field label="Notes (optional)" value={notes} onChangeText={setNotes} editable={!busy} />

    <Heading>Find stock</Heading>
    <Row>
      <Choice label="Game" value={game} options={[{ value: '', label: 'All games' }, ...(games.data ?? []).map(g => ({ value: g.slug, label: g.name }))]}
        onChange={v => { setGame(v); setSetId(''); setOffset(0); }} disabled={busy} />
      {game ? <Choice label="Set" value={setId} options={[{ value: '', label: 'All sets' }, ...(sets.data?.items ?? []).map(s => ({ value: s.id, label: s.name }))]}
        onChange={pickSet} disabled={busy} /> : null}
    </Row>
    <Field label="Search stock" value={search} onChangeText={setSearch} editable={!busy} />
    <ErrorNotice error={found.error ?? games.error ?? types.error ?? sets.error ?? addAll.error} />
    {found.isPending && <Loading />}
    {found.data ? <Row>
      <Button label={addAll.isPending ? 'Adding...' : `Add one of each (${found.data.total})`} disabled={busy || found.data.total === 0} onPress={() => addAll.mutate('one')} />
      <Button label={`Add every copy (${found.data.total})`} disabled={busy || found.data.total === 0} onPress={() => addAll.mutate('all')} />
    </Row> : null}
    {found.data?.items.map(product => <Row key={product.id}>
      <View style={{ flex: 1, minWidth: 160 }}>
        <Copy>{product.name}</Copy>
        <Copy muted>{[product.set_name, product.collector_number, BUCKETS.filter(b => product.stats.by_bucket[b] > 0).map(b => `${BUCKET_LABELS[b]} ${product.stats.by_bucket[b]}`).join(', ')].filter(Boolean).join(' · ')}</Copy>
      </View>
      <Button label={selected.has(product.id) ? 'Added' : 'Add'} disabled={busy || selected.has(product.id)}
        onPress={() => setLines(current => addProducts(current, [product], 'one'))} />
    </Row>)}
    {found.data && found.data.total > PAGE ? <Row>
      <Button label="Previous" disabled={offset === 0} onPress={() => setOffset(Math.max(0, offset - PAGE))} />
      <Copy muted>{offset + 1}-{Math.min(offset + PAGE, found.data.total)} of {found.data.total}</Copy>
      <Button label="Next" disabled={offset + PAGE >= found.data.total} onPress={() => setOffset(offset + PAGE)} />
    </Row> : null}

    <Heading>{`In the bundle (${lines.length})`}</Heading>
    {lines.length === 0 ? <Copy muted>Nothing added yet.</Copy> : <Button variant="link" label="Remove all" disabled={busy} onPress={() => setLines([])} />}
    <ErrorNotice error={preview.error} />
    {short.length > 0 ? <Card><Copy>{short.map(row => `${row.product_name}: ${BUCKET_LABELS[row.bucket]} holds ${row.available}`).join(' · ')}</Copy></Card> : null}
    {lines.map(line => {
      const key = lineKey(line);
      const row = preview.data?.inputs.find(r => r.product_id === line.product_id && r.bucket === line.bucket);
      const free = bucketsFree(lines, line);
      return <View key={key} role="group" accessibilityLabel={'Combining ' + line.name}><Card>
        <Copy>{line.name}</Copy>
        <Row>
          <Field label="Quantity" value={line.quantity} onChangeText={text => update(key, { quantity: text })} keyboardType="number-pad" editable={!busy} style={{ minWidth: 80 }} />
          {free.length > 1 ? <Choice label="From" value={line.bucket} options={free.map(b => ({ value: b, label: `${BUCKET_LABELS[b]} (${line.held[b] ?? 0})` }))}
            onChange={v => update(key, { bucket: v as Bucket })} disabled={busy} /> : <Copy muted>From {BUCKET_LABELS[line.bucket]}</Copy>}
          <Button label="Remove" danger disabled={busy} onPress={() => remove(key)} />
        </Row>
        {combineQuantity(line.quantity) === null ? <Copy muted>Enter a whole number.</Copy> : row ? <Copy muted>Cost {money(row.cost)} · Worth {row.value === null ? 'no price' : money(row.value)}</Copy> : null}
      </Card></View>;
    })}
  </Sheet>;
}
