import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { api, isWorthRetrying, type Product } from './api'
import { AppShell } from './components/AppShell'
import { AddProductDialog, RecordSaleDialog } from './components/forms'
import { Dashboard } from './pages/Dashboard'
import { Inventory } from './pages/Inventory'
import { Login } from './pages/Login'
import { Money } from './pages/Money'
import { ProductDetail } from './pages/ProductDetail'
import { Reports } from './pages/Reports'
import { Sales } from './pages/Sales'
import { useAuth } from './useAuth'

export function App() {
  const { user, loading, signOut } = useAuth()

  // Recording a sale is reachable from every screen, so the dialog lives here rather
  // than being duplicated per page.
  // `undefined` product means the dialog asks which one; a product skips that step.
  const [saleFor, setSaleFor] = useState<{ product?: Product } | null>(null)
  const [addingProduct, setAddingProduct] = useState(false)

  // The first authenticated call provisions the member row server-side.
  //
  // This used to be `retry: false`, which was right about 403 and wrong about
  // everything else: one restart mid-request left the whole app on an error screen
  // whose only offer was Sign out, which does not help. Retry what might heal.
  const me = useQuery({
    queryKey: ['me'],
    queryFn: api.me,
    enabled: Boolean(user),
    retry: (failureCount, error) => failureCount < 2 && isWorthRetrying(error),
  })

  if (loading) {
    return <p className="p-6 text-sm text-(--color-muted)">Loading…</p>
  }

  if (!user) {
    return <Login />
  }

  if (me.isError) {
    // Either this account is not on the store's member allowlist, or something
    // transient outlasted the retries. The screen cannot tell which, so it offers
    // both ways out rather than assuming the permanent one.
    return (
      <div className="mx-auto max-w-md p-6">
        <p className="text-sm text-red-400">{(me.error as Error).message}</p>
        <div className="mt-4 flex items-center gap-4">
          <button
            type="button"
            onClick={() => me.refetch()}
            disabled={me.isFetching}
            className="text-sm text-(--color-accent) disabled:opacity-50"
          >
            {me.isFetching ? 'Trying…' : 'Try again'}
          </button>
          <button type="button" onClick={signOut} className="text-sm text-(--color-muted)">
            Sign out
          </button>
        </div>
      </div>
    )
  }

  const openSale = (product?: Product) => setSaleFor({ product })
  const openProduct = () => setAddingProduct(true)
  const actions = { onRecordSale: openSale, onAddProduct: openProduct }

  return (
    <AppShell
      member={me.data}
      onSignOut={signOut}
      onRecordSale={openSale}
      onAddProduct={openProduct}
    >
      <Routes>
        <Route path="/" element={<Dashboard {...actions} />} />
        <Route path="/inventory" element={<Inventory {...actions} />} />
        <Route path="/sales" element={<Sales {...actions} />} />
        <Route path="/money" element={<Money />} />
        <Route path="/products/:productId" element={<ProductDetail />} />
        <Route path="/reports" element={<Reports {...actions} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {saleFor && (
        <RecordSaleDialog product={saleFor.product} onClose={() => setSaleFor(null)} />
      )}
      {addingProduct && <AddProductDialog onClose={() => setAddingProduct(false)} />}
    </AppShell>
  )
}
