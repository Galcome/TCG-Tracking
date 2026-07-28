/**
 * The application frame.
 *
 * Navigation is a persistent sidebar from `lg:` up and a bottom tab bar below it, so the
 * same routes work on both without duplicate components.
 */

import { BarChart3, LayoutDashboard, LogOut, Package } from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

import type { Member } from '../api'

const NAV = [
  { to: '/', label: 'Dashboard', Icon: LayoutDashboard, end: true },
  { to: '/inventory', label: 'Inventory', Icon: Package, end: false },
  { to: '/reports', label: 'Reports', Icon: BarChart3, end: false },
]

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
      <aside className="hidden w-60 shrink-0 flex-col border-r border-(--color-edge) bg-(--color-ink)/40 lg:flex">
        <div className="px-5 py-6">
          <div className="flex items-center gap-2.5">
            {/* A small stack of cards, fanned. Enough personality for a wordmark
                without becoming a mascot. */}
            <span className="relative inline-flex h-7 w-7 items-center justify-center">
              <span className="absolute h-5 w-4 -rotate-12 rounded-[3px] bg-(--color-game-pokemon)/80" />
              <span className="absolute h-5 w-4 rotate-12 rounded-[3px] bg-(--color-game-yugioh)/80" />
              <span className="absolute h-5 w-4 rounded-[3px] bg-(--color-accent)" />
            </span>
            <div className="min-w-0">
              <p className="font-display truncate text-sm font-bold leading-tight">
                TCG Investments
              </p>
              <p className="text-[0.6875rem] text-(--color-faint)">Store ledger</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors duration-150 ${
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

        <div className="border-t border-(--color-edge) px-5 py-4">
          <p className="truncate text-sm font-medium">{member?.display_name ?? 'Signed in'}</p>
          <p className="text-xs capitalize text-(--color-faint)">{member?.role}</p>
          <button
            type="button"
            onClick={onSignOut}
            className="mt-2.5 inline-flex items-center gap-1.5 text-xs text-(--color-muted) transition-colors hover:text-(--color-accent)"
          >
            <LogOut size={13} />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-(--color-edge) bg-(--color-ink)/90 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2">
            <span className="relative inline-flex h-6 w-6 items-center justify-center">
              <span className="absolute h-4 w-3 -rotate-12 rounded-[2px] bg-(--color-game-pokemon)/80" />
              <span className="absolute h-4 w-3 rounded-[2px] bg-(--color-accent)" />
            </span>
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

        {/* pb-24 keeps content clear of the mobile tab bar. */}
        <main className="min-w-0 flex-1 px-4 pb-24 pt-5 lg:px-8 lg:pb-12 lg:pt-8">
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
              `flex flex-1 flex-col items-center gap-1 py-2.5 text-[0.6875rem] transition-colors ${
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
