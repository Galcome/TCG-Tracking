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

export function opensInto(slug: string | undefined): string | undefined {
  if (slug === 'sealed-case') return 'booster-box'
  if (slug === 'booster-box') return 'booster-pack'
  return undefined
}

export function namedByItsSet(slug: string | undefined): boolean {
  return Boolean(slug && !NOT_A_CONTAINER.includes(slug))
}

export function bySlug(types: Taxonomy[] | undefined, slug: string | undefined): Taxonomy | undefined {
  if (!types?.length || !slug) return undefined
  return types.find((option) => option.slug === slug)
}

export function suggestedProductName(setLabel: string, type: Taxonomy | undefined): string {
  const set = setLabel.trim()
  if (!set || !type || !namedByItsSet(type.slug)) return ''
  if (set.toLowerCase().endsWith(type.name.toLowerCase())) return set
  return `${set} ${type.name}`
}
