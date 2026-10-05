import type { Taxonomy } from './api'

const NOT_A_CONTAINER = ['single', 'raw-single', 'graded-card']

export const CANNOT_BE_CRACKED = [...NOT_A_CONTAINER, 'booster-pack']
export const CANNOT_BE_RIPPED = [...NOT_A_CONTAINER, 'sealed-case']

export function canCrack(slug: string | undefined): boolean {
  return Boolean(slug && !CANNOT_BE_CRACKED.includes(slug))
}

export function canRip(slug: string | undefined): boolean {
  return Boolean(slug && !CANNOT_BE_RIPPED.includes(slug))
}

/** Sealed products whose contents worth tracking are booster packs. */
export const HOLDS_PACKS = [
  'booster-box',
  'collector-booster-box',
  'elite-trainer-box',
  'pokemon-center-elite-trainer-box',
  'booster-bundle',
  'illumineers-trove',
  'prerelease-kit',
  'premium-collection',
  'ultra-premium-collection',
  'super-premium-collection',
  'collection-box',
  'pin-collection',
  'poster-collection',
  'collector-chest',
  'build-and-battle-box',
  'build-and-battle-stadium',
  'trainers-toolkit',
  'holiday-calendar',
  'mini-tin',
  'tin',
  'blister',
  'gift-set',
  'gift-bundle',
]

export function opensInto(slug: string | undefined): string | undefined {
  if (slug === 'sealed-case') return 'booster-box'
  if (slug === 'etb-case') return 'elite-trainer-box'
  if (slug && HOLDS_PACKS.includes(slug)) return 'booster-pack'
  return undefined
}

export function namedByItsSet(slug: string | undefined): boolean {
  return Boolean(slug && !NOT_A_CONTAINER.includes(slug))
}

export function bySlug(types: Taxonomy[] | undefined, slug: string | undefined): Taxonomy | undefined {
  if (!types?.length || !slug) return undefined
  return types.find((option) => option.slug === slug)
}

export function suggestedProductName(setLabel: string, type: Pick<Taxonomy, 'name' | 'slug'> | undefined): string {
  const set = setLabel.trim()
  if (!set || !type || !namedByItsSet(type.slug)) return ''
  if (set.toLowerCase().endsWith(type.name.toLowerCase())) return set
  return `${set} ${type.name}`
}

/** The name after correcting a product's type. A name that was the old type's suggestion
 * follows the new type; a name typed by hand is left alone. */
export function nameAfterTypeChange(
  name: string,
  setLabel: string,
  from: Pick<Taxonomy, 'name' | 'slug'> | undefined,
  to: Pick<Taxonomy, 'name' | 'slug'> | undefined,
): string {
  const before = suggestedProductName(setLabel, from)
  const after = suggestedProductName(setLabel, to)
  return before && after && name.trim() === before ? after : name
}
