import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { api } from './api'
import { AppShell } from './components/AppShell'
import { AddProductDialog, RecordSaleDialog } from './components/forms'
import { Dashboard } from './pages/Dashboard'
import { Inventory } from './pages/Inventory'
import { Login } from './pages/Login'
import { ProductDetail } from './pages/ProductDetail'
import { Reports } from './pages/Reports'
import { Sales } from './pages/Sales'
import { useAuth } from './useAuth'

export function App() {
  const { user, loading, signOut } = useAuth()

  // Recording a sale is reachable from every screen, so the dialog lives here rather
  // than being duplicated per page.
  const [recordingSale, setRecordingSale] = useState(false)
  const [addingProduct, setAddingProduct] = useState(false)

  // The first authenticated call provisions the member row server-side.
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, enabled: Boolean(user), retry: false })

  if (loading) {
    return <p className="p-6 text-sm text-(--color-muted)">Loading…</p>
  }

  if (!user) {
    return <Login />
  }

  if (me.isError) {
    // Most likely this account is not on the store's member allowlist.
    return (
      <div className="mx-auto max-w-md p-6">
        <p className="text-sm text-red-400">{(me.error as Error).message}</p>
        <button type="button" onClick={signOut} className="mt-4 text-sm text-(--color-accent)">
          Sign out
        </button>
      </div>
    )
  }

  const openSale = () => setRecordingSale(true)
  const openProduct = () => setAddingProduct(true)
  const actions = { onRecordSale: openSale, onAddProduct: openProduct }

  return (
    <AppShell member={me.data} onSignOut={signOut} onRecordSale={openSale}>
      <Routes>
        <Route path="/" element={<Dashboard {...actions} />} />
        <Route path="/inventory" element={<Inventory {...actions} />} />
        <Route path="/sales" element={<Sales {...actions} />} />
        <Route path="/products/:productId" element={<ProductDetail />} />
        <Route path="/reports" element={<Reports {...actions} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {recordingSale && <RecordSaleDialog onClose={() => setRecordingSale(false)} />}
      {addingProduct && <AddProductDialog onClose={() => setAddingProduct(false)} />}
    </AppShell>
  )
}
