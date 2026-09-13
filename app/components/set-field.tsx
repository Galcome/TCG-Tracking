import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { useApi } from '../context/AppContext'
import { Button, Copy, ErrorNotice, Field, Loading, Row } from './ui'

/**
 * Set identity stays free text, with game-scoped suggestions alongside it.
 *
 * The list is helpful, never authoritative: a person can pick a recent or new seeded set,
 * accept a did-you-mean prompt, or keep typing a set that is not in the calendar. Keeping the
 * field and suggestions in the same sheet also avoids a nested picker stealing the form's
 * keyboard/focus context.
 */
export function SetField({ game, value, onChange, autoFocus = false }: {
  game: string
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
}) {
  const api = useApi()
  const gameSlug = game.trim()
  const [query, setQuery] = useState(value.trim())

  useEffect(() => {
    const timer = setTimeout(() => setQuery(value.trim()), 250)
    return () => clearTimeout(timer)
  }, [value])

  const sets = useQuery({
    queryKey: ['sets', gameSlug, query],
    queryFn: () => api.sets({ game: gameSlug, q: query || undefined, limit: 20 }),
    enabled: Boolean(gameSlug),
  })
  const suggestions = sets.data?.items ?? []
  const didYouMean = sets.data?.did_you_mean ?? null
  const exactMatch = suggestions.some((set) => set.name.trim().toLowerCase() === value.trim().toLowerCase())
  // Keep the routine path compact on a phone. The complete API result remains available after
  // the user narrows the query; showing twenty full-width controls before Quantity is too much.
  const visibleSuggestions = exactMatch ? [] : suggestions.slice(0, 5)

  return (
    <>
      <Field
        label="Set"
        value={value}
        onChangeText={onChange}
        autoFocus={autoFocus}
        placeholder={gameSlug ? 'Start typing, or pick one below' : 'Choose a game first'}
      />
      {!gameSlug ? <Copy muted>Choose a game to see set suggestions. You can still type a set name.</Copy> : null}
      {sets.isFetching ? <Loading /> : null}
      {sets.error ? <ErrorNotice error={sets.error} retry={() => { void sets.refetch() }} /> : null}
      {didYouMean && !exactMatch ? (
        <Button
          label={'Did you mean ' + didYouMean + '?'}
          variant="link"
          onPress={() => onChange(didYouMean)}
        />
      ) : null}
      {visibleSuggestions.length > 0 ? (
        <>
          <Copy muted>Recent sets are from your collection; new sets come from the release calendar.</Copy>
          {visibleSuggestions.map((set) => (
            <Row key={set.id}>
              <Button label={set.name} onPress={() => onChange(set.name)} />
              <Copy muted>{set.uses > 0 ? 'Recent' : 'New'}</Copy>
            </Row>
          ))}
        </>
      ) : sets.data && !sets.isFetching && !exactMatch ? (
        <Copy muted>No matching sets. Keep typing to create/use a new set name.</Copy>
      ) : null}
    </>
  )
}
