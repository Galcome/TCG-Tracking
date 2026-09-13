import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApi } from '../context/AppContext';
import { Button, Copy, ErrorNotice, Field, Loading, Sheet } from './ui';

/** Suggestions never replace typed identity without the user's selection. */
export function SetField({ game, value, onChange }: {
  game: string; value: string; onChange: (value: string) => void;
}) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const sets = useQuery({
    queryKey: ['sets', game, query],
    queryFn: () => api.sets({ game, q: query, limit: 20 }),
    enabled: open && Boolean(game),
  });
  const choose = (name: string) => { onChange(name); setOpen(false); };
  return <>
    <Field label="Set" value={value} onChangeText={onChange} placeholder="Set name" />
    <Button label="Find a set" disabled={!game} onPress={() => { setSearch(value); setQuery(value); setOpen(true); }} />
    <Sheet title="Choose a set" open={open} onClose={() => setOpen(false)}>
      <Field label="Search sets" value={search} onChangeText={setSearch} />
      <Copy muted>Suggestions are scoped to the selected game. You can also keep a typed set name.</Copy>
      <ErrorNotice error={sets.error} retry={() => { void sets.refetch(); }} />
      {sets.isPending && <Loading />}
      {sets.data?.did_you_mean && <Button label={'Did you mean ' + sets.data.did_you_mean + '?'} onPress={() => choose(sets.data!.did_you_mean!)} />}
      {sets.data?.items.map(set => <Button key={set.id} label={set.name} onPress={() => choose(set.name)} />)}
      {sets.data?.items.length === 0 && <Copy>No matching sets. Close this picker to enter the name manually.</Copy>}
    </Sheet>
  </>;
}
