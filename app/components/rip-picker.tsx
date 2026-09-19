import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../context/AppContext';
import type { Product } from '../lib/api';
import { canRip } from '../lib/product-types';
import { RipDialog } from './rip-form';
import { Button, Copy, ErrorNotice, Field, Loading, Sheet } from './ui';

/** Quick-action entry to a rip: pick an in-stock box or pack, then open the normal rip form. */
export function RipPickerDialog({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Product | null>(null);
  const candidates = useQuery({
    queryKey: ['products', 'rip-picker', search],
    queryFn: () => api.products({ q: search || undefined, stock: 'in', limit: 30 }),
    enabled: !picked,
  });
  if (picked) return <RipDialog product={picked} onClose={onClose} />;
  const rippable = (candidates.data?.items ?? []).filter(p => canRip(p.product_type.slug) && !p.is_archived);
  return <Sheet title="Rip a box" open onClose={onClose}>
    <Field label="Find a box or pack" value={search} onChangeText={setSearch} autoFocus />
    <ErrorNotice error={candidates.error} retry={() => { void candidates.refetch(); }} />
    {candidates.isPending && <Loading />}
    {candidates.isSuccess && rippable.length === 0 ? <Copy muted>No sealed product in stock matches.</Copy> : null}
    {rippable.map(p => <Button key={p.id} label={`Rip ${p.name} · ${p.stats.quantity_on_hand} in stock`} onPress={() => setPicked(p)} />)}
  </Sheet>;
}
