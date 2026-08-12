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
import {
  BarChart3,
  Boxes,
  LayoutDashboard,
  LogOut,
  Package,
  Plus,
  ScrollText,
  Store,
  Vault,
} from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

import { api, type Member, type Product } from '../api'
import { signedMoney, toneFor } from '../format'
import { Button, gameColour } from './ui'

/** Actions every page header offers. Passing a product skips the picker step. */
export interface PageActions {
  onRecordSale: (product?: Product) => void
  onAddProduct: () => void
}

interface NavItem {
  to: string
  label: string
  Icon: ComponentType<{ size?: number; strokeWidth?: number }>
  /** Which bucket this destination shows. `undefined` means it is not a stock view. */
  bucket?: string
  /** Nested under All stock in the sidebar. */
  child?: boolean
  /** Six is already the ceiling for a bottom tab bar at 375px. */
  mobile?: boolean
}

/**
 * The three buckets are destinations, not a control buried inside one page.
 *
 * They were tabs on Inventory and nothing else, so from the Dashboard there was no Store
 * anywhere on screen - Joseph's "I DON'T SEE STORE!". A place you cannot navigate to is
 * not a place.
 */
const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', Icon: LayoutDashboard, mobile: true },
  { to: '/inventory', label: 'All stock', Icon: Boxes, bucket: '' },
  { to: '/inventory?bucket=inventory', label: 'Inventory', Icon: Package, bucket: 'inventory', child: true, mobile: true },
  { to: '/inventory?bucket=store', label: 'Store', Icon: Store, bucket: 'store', child: true, mobile: true },
  { to: '/inventory?bucket=vault', label: 'Vault', Icon: Vault, bucket: 'vault', child: true, mobile: true },
  { to: '/sales', label: 'Sales', Icon: ScrollText, mobile: true },
  { to: '/reports', label: 'Reports', Icon: BarChart3, mobile: true },
]

/**
 * Which nav item the current URL is on.
 *
 * `NavLink`'s own `isActive` compares pathnames and ignores the query string, so all four
 * stock destinations would light up together. The bucket lives in the query string
 * because it has to be shareable and survive Back, so the check is done by hand.
 */
function useActiveNav(): (item: NavItem) => boolean {
  const { pathname, search } = useLocation()
  const bucket = new URLSearchParams(search).get('bucket') ?? ''

  return (item: NavItem) => {
    if (item.bucket !== undefined) return pathname === '/inventory' && bucket === item.bucket
    if (item.to === '/') return pathname === '/'
    return pathname.startsWith(item.to)
  }
}

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
  onRecordSale,
  onAddProduct,
  children,
}: {
  member: Member | undefined
  onSignOut: () => void
  onRecordSale: () => void
  onAddProduct: () => void
  children: ReactNode
}) {
  const isActive = useActiveNav()

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
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={`flex items-center gap-3 rounded-[10px] py-2.5 text-sm transition-colors duration-150 ${
                item.child ? 'pl-7 pr-3' : 'px-3'
              } ${
                isActive(item)
                  ? 'bg-(--color-accent)/12 font-medium text-(--color-accent)'
                  : 'text-(--color-muted) hover:bg-(--color-raised) hover:text-(--color-text)'
              }`}
            >
              <item.Icon size={item.child ? 15 : 17} strokeWidth={2} />
              {item.label}
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

      {/* The mobile action bar, once for the whole app rather than per page.
          Both actions live here because the page headers hide theirs below `lg:`, and for
          a while that left a phone able to sell stock it already had and never able to
          acquire any.
          Positions are fixed rather than reordered per page: a button that moves is a
          button that gets mis-tapped, and both of these write to the ledger. */}
      <div className="fixed inset-x-4 bottom-20 z-10 flex gap-2 lg:hidden">
        {/* Called with no arguments on purpose. `onClick={onRecordSale}` hands React's
            click event to the handler, and App reads that first argument as the product
            to pre-select - so the dialog got a MouseEvent, read .game.slug off it, and
            took the whole app down. PageHeader always wrapped it; this did not. */}
        <button
          type="button"
          onClick={() => onRecordSale()}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-linear-to-b from-(--color-accent) to-(--color-accent-deep) px-4 py-3.5 font-semibold text-(--color-ink) shadow-lg"
        >
          Record sale
        </button>
        {/* Opaque on purpose: the bar floats over scrolling content, and the primary
            button only reads as solid because it is a filled gradient. */}
        <button
          type="button"
          onClick={() => onAddProduct()}
          className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-(--color-edge-strong) bg-(--color-surface) px-4 py-3.5 text-sm font-semibold text-(--color-text) shadow-lg"
        >
          <Plus size={16} strokeWidth={2.5} />
          Add product
        </button>
      </div>

      {/* Six items is the ceiling at 375px, so All stock is the one that gives way - the
          page it leads to carries the same choice as a tab strip at the top. */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-(--color-edge) bg-(--color-ink)/95 backdrop-blur lg:hidden">
        {NAV.filter((item) => item.mobile).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={`flex min-w-0 flex-1 flex-col items-center gap-1 px-0.5 py-2.5 text-[0.625rem] whitespace-nowrap transition-colors ${
              isActive(item) ? 'text-(--color-accent)' : 'text-(--color-faint)'
            }`}
          >
            <item.Icon size={19} strokeWidth={2} />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

/**
 * Shared page header: eyebrow, title, whatever the page passes (period chips), and the
 * two primary actions.
 *
 * The actions live here rather than in each page, because wiring them per page is exactly
 * how the Dashboard ended up with no way to add anything.
 */
export function PageHeader({
  title,
  onRecordSale,
  onAddProduct,
  children,
}: {
  title: string
  onRecordSale?: (product?: Product) => void
  onAddProduct?: () => void
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
      <div className="flex flex-wrap items-center justify-end gap-2.5">
        {children}
        {/* Desktop only: on a phone both of these are in the shell's action bar above the
            tab bar, where a thumb reaches them. */}
        <span className="hidden items-center gap-2.5 lg:flex">
          {onAddProduct && (
            <Button type="button" variant="ghost" onClick={onAddProduct}>
              <Plus size={15} strokeWidth={2.5} />
              Add product
            </Button>
          )}
          {onRecordSale && (
            <Button type="button" onClick={() => onRecordSale()}>
              Record sale
            </Button>
          )}
        </span>
      </div>
    </header>
  )
}
