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

export function GameDot({ slug, className = '' }: { slug: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${className}`}
      style={{ backgroundColor: gameColour(slug) }}
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
      className={`rounded-xl border border-(--color-edge) bg-(--color-surface) p-4 shadow-sm ${
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
      className={`relative overflow-hidden rounded-xl border border-(--color-edge) bg-(--color-surface) p-4 shadow-sm ${
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
    <div className="rounded-xl border border-(--color-edge) bg-(--color-surface) p-4">
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
