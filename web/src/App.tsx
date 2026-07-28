import { useQuery } from '@tanstack/react-query'
import { Navigate, Route, Routes } from 'react-router-dom'

import { api } from './api'
import { Inventory } from './pages/Inventory'
import { Login } from './pages/Login'
import { NewProduct } from './pages/NewProduct'
import { useAuth } from './useAuth'

export function App() {
  const { user, loading, signOut } = useAuth()

  // The first authenticated call provisions the member row server-side.
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, enabled: Boolean(user), retry: false })

  if (loading) {
    return <p className="p-6 text-sm text-(--color-muted)">Loading…</p>
  }

  if (!user) {
    return <Login />
  }

  return (
    <div className="mx-auto max-w-md">
      <header className="flex items-center justify-between border-b border-(--color-edge) px-4 py-3">
        <span className="text-sm text-(--color-muted)">
          {me.data ? me.data.display_name : user.email}
        </span>
        <button type="button" onClick={signOut} className="text-sm text-(--color-accent)">
          Sign out
        </button>
      </header>

      {me.isError ? (
        <p className="p-4 text-sm text-red-400">{(me.error as Error).message}</p>
      ) : (
        <Routes>
          <Route path="/" element={<Inventory />} />
          <Route path="/products/new" element={<NewProduct />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </div>
  )
}
