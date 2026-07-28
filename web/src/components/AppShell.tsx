/**
 * The application frame.
 *
 * Replaces the old global `max-w-md`, which pinned every screen to phone width and left a
 * desktop viewport two-thirds empty. Navigation is a persistent sidebar from `lg:` up and a
 * bottom tab bar below it, so the same routes work on both without duplicate components.
 */

import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

import type { Member } from '../api'

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◈', end: true },
  { to: '/inventory', label: 'Inventory', icon: '▦', end: false },
  { to: '/reports', label: 'Reports', icon: '◑', end: false },
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
      {/* Desktop navigation */}
      <aside className="hidden w-60 shrink-0 border-r border-(--color-edge) lg:flex lg:flex-col">
        <div className="px-5 py-5">
          <p className="text-sm font-semibold tracking-tight">TCG Card Investments</p>
          <p className="mt-0.5 text-xs text-(--color-muted)">Store ledger</p>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                  isActive
                    ? 'bg-(--color-surface) text-(--color-accent)'
                    : 'text-(--color-muted) hover:bg-(--color-surface)'
                }`
              }
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-(--color-edge) px-5 py-4">
          <p className="truncate text-sm">{member?.display_name ?? 'Signed in'}</p>
          <p className="text-xs text-(--color-muted)">{member?.role}</p>
          <button
            type="button"
            onClick={onSignOut}
            className="mt-2 text-xs text-(--color-accent)"
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header */}
        <header className="flex items-center justify-between border-b border-(--color-edge) px-4 py-3 lg:hidden">
          <span className="text-sm font-semibold">TCG Card Investments</span>
          <button type="button" onClick={onSignOut} className="text-sm text-(--color-accent)">
            Sign out
          </button>
        </header>

        {/* pb-24 keeps content clear of the mobile tab bar. */}
        <main className="min-w-0 flex-1 px-4 pb-24 pt-4 lg:px-8 lg:pb-10 lg:pt-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>

      {/* Mobile navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-(--color-edge) bg-(--color-ink) lg:hidden">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs ${
                isActive ? 'text-(--color-accent)' : 'text-(--color-muted)'
              }`
            }
          >
            <span aria-hidden="true" className="text-base">
              {item.icon}
            </span>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
