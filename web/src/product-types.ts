/**
 * What a product type is, and what can be done to it.
 *
 * One module because the same three questions were being answered three different ways,
 * and one of those ways was wrong. `types[0]` is `Single` because `Single` happens to be
 * first in a seed list — never because it is a sensible default for anything. Crack open
 * leaned on that and filed every box it produced as a single, silently corrupting the tier
 * report, which is the one place product type actually matters.
 *
 * **Look types up by slug. Never by list position.**
 */

import type { Taxonomy } from './api'

/** A card is not a container. Nothing here can be cracked or ripped. */
const NOT_A_CONTAINER = ['single', 'raw-single', 'graded-card']

/** A pack has nothing sealed inside it, so there is nothing to crack it into. */
export const CANNOT_BE_CRACKED = [...NOT_A_CONTAINER, 'booster-pack']

/** A case is opened into its boxes, never one card at a time. */
export const CANNOT_BE_RIPPED = [...NOT_A_CONTAINER, 'sealed-case']

/**
 * Deliberately deny-lists, mirroring `src/services/transformations.py`.
 *
 * `lot`, `collection`, `box-set`, `binder`, `deck` and `other` stay permitted because
 * nobody can say what they hold, and blocking a real workflow is a worse failure than
 * allowing an odd one. Only the genuinely impossible is refused.
 */
export function canCrack(slug: string | undefined): boolean {
  return !!slug && !CANNOT_BE_CRACKED.includes(slug)
}

export function canRip(slug: string | undefined): boolean {
  return !!slug && !CANNOT_BE_RIPPED.includes(slug)
}

/** Whether a name can honestly be built for this type, or only the person knows it. */
export function namedByItsSet(slug: string | undefined): boolean {
  return !!slug && !NOT_A_CONTAINER.includes(slug)
}

/**
 * What opening one of these produces: a case yields boxes, a box yields packs.
 *
 * The default comes from what the operation *means*, rather than from whatever sorted
 * first. Undefined for anything with no obvious child, which leaves the person to choose.
 */
export function opensInto(slug: string | undefined): string | undefined {
  if (slug === 'sealed-case') return 'booster-box'
  if (slug === 'booster-box') return 'booster-pack'
  return undefined
}

/** Find a seeded type by slug, falling back to the first only when it is genuinely absent. */
export function bySlug(types: Taxonomy[] | undefined, slug: string | undefined): Taxonomy | undefined {
  if (!types?.length) return undefined
  return types.find((option) => option.slug === slug) ?? undefined
}

/**
 * "Mega Evolution: Pitch Black Night" + "Sealed Case" -> both, joined.
 *
 * Empty when there is nothing honest to build: no set yet, or a card type, where only the
 * person holding it knows what it is called. Mirrors the graded-card name built in
 * `grading-forms.tsx` — a sensible default, always shown, never silently applied.
 *
 * Avoids repeating itself: a set already ending in the type name is left alone, so
 * "Foo Booster Box" + Booster Box does not become "Foo Booster Box Booster Box".
 */
export function suggestedProductName(
  setLabel: string,
  type: Taxonomy | undefined,
): string {
  const set = setLabel.trim()
  if (!set || !type || !namedByItsSet(type.slug)) return ''
  if (set.toLowerCase().endsWith(type.name.toLowerCase())) return set
  return `${set} ${type.name}`
}
