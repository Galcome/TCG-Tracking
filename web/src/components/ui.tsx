/**
 * Small shared pieces. Forms render as a centred dialog on desktop and a full-screen sheet
 * on mobile, from one component, so there is a single implementation per form.
 */

import type { FormEvent, ReactNode } from 'react'
import { useEffect } from 'react'

export const FIELD_CLASS =
  'mt-1 w-full rounded-lg border border-(--color-edge) bg-(--color-surface) px-3 py-2.5 ' +
  'text-base outline-none focus:border-(--color-accent)'

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
      <span className="text-sm text-(--color-muted)">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-(--color-muted)">{hint}</span>}
    </label>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-(--color-edge) bg-(--color-surface) p-4 ${className}`}
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
}: {
  label: string
  value: string
  tone?: string
  emphasis?: boolean
  hint?: string
}) {
  return (
    <Card>
      <p className="text-xs uppercase tracking-wide text-(--color-muted)">{label}</p>
      <p
        className={`mt-1 font-semibold tabular-nums ${emphasis ? 'text-2xl lg:text-3xl' : 'text-lg lg:text-xl'} ${tone}`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-(--color-muted)">{hint}</p>}
    </Card>
  )
}

export function Button({
  children,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-(--color-accent) text-(--color-ink) font-medium',
    ghost: 'border border-(--color-edge) text-(--color-text)',
    danger: 'border border-red-500/40 text-red-400',
  }[variant]
  return (
    <button
      {...props}
      className={`rounded-lg px-4 py-2.5 text-sm disabled:opacity-50 ${styles} ${props.className ?? ''}`}
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
  // Escape closes, and the page behind must not scroll while a sheet is open on mobile.
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
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/60 sm:items-center sm:p-6">
      <form
        onSubmit={onSubmit}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-(--color-edge) bg-(--color-ink) p-5 sm:max-w-lg sm:rounded-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-(--color-muted)"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">{children}</div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

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
    <details className="rounded-lg border border-(--color-edge) px-3 py-2">
      <summary className="cursor-pointer text-sm text-(--color-accent)">Advanced</summary>
      <div className="mt-3 space-y-4">{children}</div>
    </details>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-sm text-(--color-muted)">{children}</p>
}

/** Explains which cost-basis method the numbers use, per the brief. */
export function FifoNote() {
  return (
    <p className="text-xs text-(--color-muted)">
      Cost basis: FIFO — the oldest stock is treated as sold first.
    </p>
  )
}
