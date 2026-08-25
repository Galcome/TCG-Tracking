/**
 * Shared interface pieces.
 *
 * Forms render as a centred dialog on desktop and a bottom sheet on mobile, from one
 * component, so there is a single implementation per form.
 */

import type { FormEvent, ReactNode } from 'react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'

export const FIELD_CLASS =
  'mt-1 w-full rounded-lg border border-(--color-edge) bg-(--color-ink)/60 px-3 py-2.5 ' +
  'text-base text-(--color-text) outline-none transition-colors ' +
  'placeholder:text-(--color-faint) hover:border-(--color-edge-strong) ' +
  'focus:border-(--color-accent)'

/** Game identity colours, matched by slug. Keeps a mixed list scannable. */
const GAME_COLOURS: Record<string, string> = {
  pokemon: 'var(--color-game-pokemon)',
  'magic-the-gathering': 'var(--color-game-magic)',
  'yu-gi-oh': 'var(--color-game-yugioh)',
  lorcana: 'var(--color-game-lorcana)',
  'one-piece': 'var(--color-game-onepiece)',
  digimon: 'var(--color-game-digimon)',
}

export function gameColour(slug: string): string {
  return GAME_COLOURS[slug] ?? 'var(--color-game-other)'
}

/**
 * Per-game marks.
 *
 * The colour alone was doing all the identifying, which meant a mixed list could only be
 * read by going to the Game column. A shape is recognised before a hue is, so each of the
 * games we actually trade gets its own silhouette and the list becomes scannable at a
 * glance.
 *
 * The rule, so this stays coherent as games are added:
 *
 * - Pokemon and Magic are drawn in their own colours, because for those two the colour
 *   IS the mark - a monochrome pokeball is a fried egg, and Magic without five colours is
 *   just a circle.
 * - Everything else is a monochrome silhouette in the game's existing identity colour, so
 *   the marker still agrees with the bars on the dashboard and in the sidebar, which are
 *   coloured from the same token.
 * - A game with no mark keeps the lit orb. Nothing breaks by adding a game.
 *
 * All of them are drawn on a 24x24 grid and rendered at 12px, so they share one box and
 * interleave in a list without anything shifting.
 */

/** The five wedges of a mana pie, cut from -90deg in 72deg steps on an r=11 circle. */
const MANA_WEDGES: [string, string][] = [
  ['M12 12 L12 1 A11 11 0 0 1 22.46 8.6 Z', '#f4f0dc'],
  ['M12 12 L22.46 8.6 A11 11 0 0 1 18.47 20.9 Z', '#2f7fd0'],
  // Lifted well off true black: at 12px on a near-black page a black wedge is a bite
  // taken out of the disc rather than a fifth of it.
  ['M12 12 L18.47 20.9 A11 11 0 0 1 5.53 20.9 Z', '#4a4551'],
  ['M12 12 L5.53 20.9 A11 11 0 0 1 1.54 8.6 Z', '#d9453c'],
  ['M12 12 L1.54 8.6 A11 11 0 0 1 12 1 Z', '#3d9c63'],
]

/**
 * The shape for a game, or null to fall back to the orb.
 *
 * `currentColor` resolves to the game's identity colour, set by the caller.
 */
function markFor(slug: string) {
  switch (slug) {
    case 'pokemon':
      return (
        <>
          <circle cx="12" cy="12" r="11" fill="#f2f5fb" />
          <path d="M1 12a11 11 0 0 1 22 0Z" fill="#ee2b3b" />
          <path d="M1 12h22" stroke="var(--color-ink)" strokeWidth="2.6" />
          <circle cx="12" cy="12" r="4.2" fill="var(--color-ink)" />
          <circle cx="12" cy="12" r="2.3" fill="#f2f5fb" />
        </>
      )

    case 'magic-the-gathering':
      return (
        <>
          {MANA_WEDGES.map(([d, fill]) => (
            <path key={fill} d={d} fill={fill} />
          ))}
          {/* Holds the disc together at 12px, where five wedges start to read as
              five separate specks. */}
          <circle cx="12" cy="12" r="11" fill="none" stroke="rgba(255,255,255,0.3)" />
        </>
      )

    // The Millennium Puzzle: a point-down triangle with the eye set into it.
    case 'yu-gi-oh':
      return (
        <>
          <path d="M12 21.6 L2.2 4.6 H21.8 Z" fill="currentColor" />
          <circle cx="12" cy="10.2" r="2.4" fill="var(--color-ink)" />
        </>
      )

    // A drop of ink, which is what the whole game runs on.
    case 'lorcana':
      return (
        <path
          d="M12 2.2c0 0 7.6 8.6 7.6 12.6a7.6 7.6 0 0 1-15.2 0c0-4 7.6-12.6 7.6-12.6z"
          fill="currentColor"
        />
      )

    // A straw hat, brim first.
    case 'one-piece':
      return (
        <>
          <ellipse cx="12" cy="16.4" rx="10" ry="3.3" fill="currentColor" />
          <path d="M6 16.4C6 9.9 8.7 5.4 12 5.4S18 9.9 18 16.4Z" fill="currentColor" />
          <rect x="5.6" y="13.5" width="12.8" height="2.5" fill="var(--color-ink)" opacity="0.5" />
        </>
      )

    // A digi-egg, cracked across the middle.
    case 'digimon':
      return (
        <>
          <ellipse cx="12" cy="13.2" rx="8.2" ry="9.6" fill="currentColor" />
          <path
            d="M4.3 13.2 L7.6 11 L10.1 14.2 L13 11 L15.6 14.2 L19.7 12.2"
            fill="none"
            stroke="var(--color-ink)"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        </>
      )

    default:
      return null
  }
}

/**
 * The per-game marker: a mark where we have one, the lit orb otherwise.
 *
 * The orb keeps its specular highlight and bloom so an unmarked game still reads as a
 * token off a card rather than a bullet point.
 */
export function GameDot({ slug, className = '' }: { slug: string; className?: string }) {
  const colour = gameColour(slug)
  const mark = markFor(slug)

  if (mark) {
    return (
      <span
        aria-hidden="true"
        className={`inline-flex h-3 w-3 shrink-0 items-center justify-center ${className}`}
      >
        <svg
          viewBox="0 0 24 24"
          width={12}
          height={12}
          className="shrink-0"
          style={{
            color: colour,
            filter: `drop-shadow(0 0 4px color-mix(in srgb, ${colour} 45%, transparent))`,
          }}
        >
          {mark}
        </svg>
      </span>
    )
  }

  return (
    <span
      aria-hidden="true"
      className={`inline-block h-3 w-3 shrink-0 rounded-full ${className}`}
      style={{
        // color-mix keeps the glow tied to the same custom property as the fill, so a
        // game's colour is still defined in exactly one place.
        background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.85), ${colour} 60%)`,
        boxShadow: `0 0 6px color-mix(in srgb, ${colour} 45%, transparent)`,
      }}
    />
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-(--color-muted)">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-(--color-faint)">{hint}</span>}
    </label>
  )
}

export function Card({
  children,
  className = '',
  interactive = false,
}: {
  children: ReactNode
  className?: string
  interactive?: boolean
}) {
  return (
    <div
      className={`holo-edge rounded-xl border border-(--color-edge) bg-(--color-surface) p-4 shadow-sm ${
        interactive
          ? 'transition-colors duration-150 hover:border-(--color-edge-strong) hover:bg-(--color-raised)'
          : ''
      } ${className}`}
    >
      {children}
    </div>
  )
}

export function Stat({
  label,
  value,
  tone = '',
  emphasis = false,
  hint,
  foil = false,
}: {
  label: string
  value: string
  tone?: string
  emphasis?: boolean
  hint?: string
  /** The one flourish, reserved for the headline profit tile. */
  foil?: boolean
}) {
  return (
    <div
      className={`holo-edge relative overflow-hidden rounded-xl border border-(--color-edge) bg-(--color-surface) p-4 shadow-sm ${
        foil ? 'foil' : ''
      }`}
    >
      <p className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-(--color-faint)">
        {label}
      </p>
      <p
        className={`font-display mt-1.5 font-semibold tabular-nums ${
          emphasis ? 'text-[1.75rem] leading-tight lg:text-[2.125rem]' : 'text-xl lg:text-2xl'
        } ${tone}`}
      >
        {value}
      </p>
      {hint && <p className="mt-1.5 text-xs leading-snug text-(--color-faint)">{hint}</p>}
    </div>
  )
}

export function Button({
  children,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger'
}) {
  const styles = {
    primary:
      'bg-linear-to-b from-(--color-accent) to-(--color-accent-deep) text-(--color-ink) ' +
      'font-semibold shadow-sm hover:brightness-110',
    ghost:
      'border border-(--color-edge) text-(--color-text) hover:border-(--color-edge-strong) ' +
      'hover:bg-(--color-raised)',
    danger: 'border border-(--color-loss)/40 text-(--color-loss) hover:bg-(--color-loss)/10',
  }[variant]

  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm transition-all duration-150 disabled:opacity-50 disabled:hover:brightness-100 ${styles} ${props.className ?? ''}`}
    >
      {children}
    </button>
  )
}

/**
 * A row-level action. Small enough for a table row, bordered so it reads as a control -
 * the previous grey text links were invisible against the numbers beside them.
 *
 * `danger` is for the destructive one, and it stays quiet until hovered so a row of
 * actions is not permanently shouting.
 */
export function RowAction({
  tone = 'normal',
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'normal' | 'danger' }) {
  const hover =
    tone === 'danger'
      ? 'text-(--color-muted) hover:border-(--color-loss)/50 hover:text-(--color-loss)'
      : 'text-(--color-text) hover:border-(--color-accent) hover:bg-(--color-accent)/10 hover:text-(--color-accent)'

  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center gap-1.5 rounded-md border border-(--color-edge) px-2.5 py-1.5 text-xs transition-colors ${hover} ${props.className ?? ''}`}
    >
      {children}
    </button>
  )
}

/** The same control as a link, for actions that are really navigation. */
export function RowLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 rounded-md border border-(--color-edge) px-2.5 py-1.5 text-xs text-(--color-muted) transition-colors hover:border-(--color-edge-strong) hover:bg-(--color-raised) hover:text-(--color-text)"
    >
      {children}
    </Link>
  )
}

export function Chip({
  active,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={`rounded-full border px-3 py-1.5 text-sm transition-colors duration-150 ${
        active
          ? 'border-(--color-accent) bg-(--color-accent)/12 text-(--color-accent)'
          : 'border-(--color-edge) text-(--color-muted) hover:border-(--color-edge-strong) hover:text-(--color-text)'
      }`}
    >
      {children}
    </button>
  )
}

export function Dialog({
  title,
  onClose,
  onSubmit,
  submitLabel,
  busy,
  error,
  children,
}: {
  title: string
  onClose: () => void
  onSubmit: (event: FormEvent) => void
  submitLabel: string
  busy?: boolean
  error?: string | null
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        onSubmit={onSubmit}
        className="rise max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-(--color-edge-strong) bg-(--color-surface) p-5 shadow-2xl sm:max-w-lg sm:rounded-2xl"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-(--color-faint) transition-colors hover:text-(--color-text)"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">{children}</div>

        {error && (
          <p className="mt-4 rounded-lg border border-(--color-loss)/40 bg-(--color-loss)/10 px-3 py-2 text-sm text-(--color-loss)">
            {error}
          </p>
        )}

        <div className="mt-6 flex gap-3">
          <Button type="button" variant="ghost" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" disabled={busy} className="flex-1">
            {busy ? 'Saving…' : submitLabel}
          </Button>
        </div>
      </form>
    </div>
  )
}

export function Advanced({ children }: { children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-(--color-edge) px-3 py-2.5 transition-colors hover:border-(--color-edge-strong)">
      <summary className="cursor-pointer list-none text-sm font-medium text-(--color-accent)">
        <span className="inline-block transition-transform duration-150 group-open:rotate-90">
          ›
        </span>{' '}
        Advanced
      </summary>
      <div className="mt-4 space-y-4">{children}</div>
    </details>
  )
}

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      {icon && <div className="text-(--color-faint)">{icon}</div>}
      <p className="max-w-sm text-sm text-(--color-muted)">{children}</p>
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />
}

export function StatSkeleton() {
  return (
    <div className="holo-edge rounded-xl border border-(--color-edge) bg-(--color-surface) p-4">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-7 w-28" />
    </div>
  )
}

/** Explains which cost-basis method the numbers use, per the brief. */
export function FifoNote() {
  return (
    <p className="text-xs text-(--color-faint)">
      Cost basis: <span className="font-medium text-(--color-muted)">FIFO</span> — the oldest
      stock is treated as sold first.
    </p>
  )
}
