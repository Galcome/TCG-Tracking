/**
 * The application frame.
 *
 * Navigation is a persistent sidebar from `lg:` up and a bottom tab bar below it, so the
 * same routes work on both without duplicate components.
 *
 * Recording a sale is the daily job, so it is the primary action in every page header;
 * adding a product is occasional and sits behind it.
 */

import { useQuery } from '@tanstack/react-query'
import { BarChart3, LayoutDashboard, LogOut, Package, ScrollText } from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

import { api, type Member } from '../api'
import { signedMoney, toneFor } from '../format'
import { gameColour } from './ui'

const NAV = [
  { to: '/', label: 'Dashboard', Icon: LayoutDashboard, end: true },
  { to: '/inventory', label: 'Inventory', Icon: Package, end: false },
  { to: '/sales', label: 'Sales', Icon: ScrollText, end: false },
  { to: '/reports', label: 'Reports', Icon: BarChart3, end: false },
]

/** "Joseph Napoleone" -> "JN". Falls back to the first two characters. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return (parts[0] ?? '?').slice(0, 2).toUpperCase()
}

function Wordmark({ size = 30 }: { size?: number }) {
  const card = { height: size * 0.7, width: size * 0.53, borderRadius: 3 }
  return (
    <span
      aria-hidden="true"
      className="relative inline-flex items-center justify-center"
      style={{ height: size, width: size }}
    >
      <span
        className="absolute"
        style={{ ...card, background: 'rgba(255,203,5,0.8)', transform: 'rotate(-14deg)' }}
      />
      <span
        className="absolute"
        style={{ ...card, background: 'rgba(165,94,234,0.8)', transform: 'rotate(14deg)' }}
      />
      <span
        className="absolute"
        style={{
          ...card,
          background: 'linear-gradient(180deg, #4cc4ff, #1d7fd4)',
          boxShadow: '0 2px 8px rgba(76,196,255,0.45)',
        }}
      />
    </span>
  )
}

/** Month-to-date performance, above the member card. One dashboard call. */
function MonthToDate() {
  const summary = useQuery({ queryKey: ['dashboard', 'mtd'], queryFn: () => api.dashboard('mtd') })
  const games = useQuery({ queryKey: ['byGame', 'mtd'], queryFn: () => api.group('game', 'mtd') })

  const traded = (games.data ?? []).filter((row) => row.sale_count > 0)
  const totalRevenue = traded.reduce((sum, row) => sum + Number(row.revenue), 0)

  return (
    <div className="space-y-2.5 border-y border-(--color-edge) px-1.5 py-3.5">
      <p className="text-[0.625rem] font-semibold tracking-[0.12em] text-(--color-faint)">
        THIS MONTH · STORE
      </p>
      <p className="flex items-baseline gap-2">
        <span
          className={`font-display text-[1.375rem] font-bold ${toneFor(summary.data?.realized_profit)}`}
        >
          {summary.data ? signedMoney(summary.data.realized_profit) : '—'}
        </span>
        <span className="text-[0.6875rem] text-(--color-faint)">profit</span>
      </p>

      {/* Game mix by revenue - the sidebar's only chart, and it earns its place by
          showing at a glance whether the month leaned on one game. */}
      <div className="flex h-[5px] overflow-hidden rounded-full bg-(--color-surface)">
        {totalRevenue > 0 &&
          traded.slice(0, 4).map((row) => (
            <span
              key={row.key}
              title={row.label}
              style={{
                width: `${(Number(row.revenue) / totalRevenue) * 100}%`,
                backgroundColor: gameColour(row.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')),
              }}
            />
          ))}
      </div>

      <p className="text-[0.6875rem] text-(--color-faint)">
        {traded.length} game{traded.length === 1 ? '' : 's'} traded ·{' '}
        {summary.data?.sale_count ?? 0} sale{summary.data?.sale_count === 1 ? '' : 's'}
      </p>
    </div>
  )
}

function MemberCard({ member, onSignOut }: { member: Member | undefined; onSignOut: () => void }) {
  const name = member?.display_name ?? 'Signed in'
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 px-1.5">
        <span
          aria-hidden="true"
          className="font-display inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl text-sm font-bold text-(--color-ink)"
          style={{
            background: 'linear-gradient(150deg, #1d7fd4, #a55eea)',
            boxShadow: '0 0 0 1px rgba(76,196,255,0.35), 0 4px 14px rgba(29,127,212,0.35)',
          }}
        >
          {initials(name)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[0.8125rem] font-semibold">{name}</p>
          {member && (
            <span className="mt-0.5 inline-block rounded border border-(--color-game-pokemon)/35 bg-(--color-game-pokemon)/10 px-1.5 py-px text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-(--color-game-pokemon)">
              {member.role}
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        className="flex items-center gap-1.5 px-1.5 text-xs text-(--color-muted) transition-colors hover:text-(--color-accent)"
      >
        <LogOut size={13} />
        Sign out
      </button>
    </div>
  )
}

export function AppShell({
  member,
  onSignOut,
  children,
}: {
  member: Member | undefined
  onSignOut: () => void
  children: ReactNode
}) {
  return (
    <div className="min-h-full lg:flex">
      <aside className="hidden w-[248px] shrink-0 flex-col gap-7 border-r border-(--color-edge) bg-(--color-ink)/55 px-4 pb-4 pt-5 lg:flex">
        <div className="flex items-center gap-3 px-1.5">
          <Wordmark />
          <div className="min-w-0">
            <p className="font-display truncate text-sm font-bold leading-tight">
              TCG Investments
            </p>
            <p className="text-[0.6875rem] tracking-[0.04em] text-(--color-faint)">STORE LEDGER</p>
          </div>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm transition-colors duration-150 ${
                  isActive
                    ? 'bg-(--color-accent)/12 font-medium text-(--color-accent)'
                    : 'text-(--color-muted) hover:bg-(--color-raised) hover:text-(--color-text)'
                }`
              }
            >
              <Icon size={17} strokeWidth={2} />
              {label}
            </NavLink>
          ))}
        </nav>

        <MonthToDate />

        <div className="mt-auto">
          <MemberCard member={member} onSignOut={onSignOut} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-(--color-edge) bg-(--color-ink)/90 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2">
            <Wordmark size={24} />
            <span className="font-display text-sm font-bold">TCG Investments</span>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            aria-label="Sign out"
            className="text-(--color-muted)"
          >
            <LogOut size={17} />
          </button>
        </header>

        {/* pb-32 clears the mobile tab bar and the record-sale button above it. */}
        <main className="min-w-0 flex-1 px-4 pb-32 pt-5 lg:px-8 lg:pb-12 lg:pt-6">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-(--color-edge) bg-(--color-ink)/95 backdrop-blur lg:hidden">
        {NAV.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-1 py-2.5 text-[0.625rem] transition-colors ${
                isActive ? 'text-(--color-accent)' : 'text-(--color-faint)'
              }`
            }
          >
            <Icon size={19} strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

/** Shared page header: eyebrow, title, period chips, and the two primary actions. */
export function PageHeader({
  title,
  children,
}: {
  title: string
  children?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-5">
      <div>
        <p className="text-[0.6875rem] font-semibold tracking-[0.14em] text-(--color-faint)">
          STORE LEDGER · FIFO COST BASIS
        </p>
        <h1 className="font-display mt-1.5 text-2xl font-bold tracking-tight lg:text-[2rem]">
          {title}
        </h1>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2.5">{children}</div>
    </header>
  )
}
