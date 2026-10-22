import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useRef } from 'react'

import { Button, Card, Copy, ErrorNotice, Loading, Page, Row } from '../../components/ui'
import { useApi } from '../../context/AppContext'
import type { DeletedProduct } from '../../lib/api'
import { describeDate, isoFromDate } from '../../lib/format'

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/**
 * The audit log's last resort: products that were deleted, and one tap to put one back with
 * every purchase, sale, move and money movement it had.
 */
export default function RecentlyDeleted() {
  const api = useApi()
  const queries = useQueryClient()
  const deleted = useQuery({ queryKey: ['deleted-products'], queryFn: () => api.deletedProducts() })
  // A ref, not isPending: a fast double tap lands before the re-render that disables the button.
  const running = useRef(false)
  const recover = useMutation({
    mutationFn: (entry: DeletedProduct) => api.restoreDeletedProduct(entry.id),
    onSuccess: ({ product_id }) => {
      void queries.invalidateQueries()
      router.push({ pathname: '/products/[productId]', params: { productId: product_id } })
    },
    onSettled: () => { running.current = false },
  })

  return <Page title="Recently deleted">
    <Copy muted>A last resort. Recovering a product puts it back exactly as it was, with its purchases, sales, moves and the money they moved.</Copy>
    <ErrorNotice error={deleted.error ?? recover.error} retry={deleted.isError ? () => { void deleted.refetch() } : undefined} />
    {deleted.isPending ? <Loading /> : null}
    {deleted.data?.length === 0 ? <Card><Copy>Nothing has been deleted.</Copy></Card> : null}
    {deleted.data?.map(entry => <Card key={entry.id}>
      <Copy>{entry.name}</Copy>
      <Copy muted>Deleted {describeDate(isoFromDate(new Date(entry.deleted_at)))}{entry.deleted_by ? ` by ${entry.deleted_by}` : ''} · {plural(entry.purchases, 'purchase')} · {plural(entry.sales, 'sale')}</Copy>
      {entry.recoverable
        ? <Row><Button variant="primary" label={recover.isPending && recover.variables?.id === entry.id ? 'Recovering…' : `Recover ${entry.name}`} disabled={recover.isPending}
          onPress={() => { if (running.current) return; running.current = true; recover.mutate(entry) }} /></Row>
        : <Copy muted>Deleted before full copies were kept, so it cannot be recovered.</Copy>}
    </Card>)}
  </Page>
}
