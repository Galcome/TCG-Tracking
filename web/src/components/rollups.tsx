/**
 * The three rollups, kept apart on screen the way they are kept apart in the data.
 *
 * **Tier** compares strategies and shows the spread, not just the average. "We got lucky on
 * that Fabled case" is survivorship - the case anybody remembers is the one that hit - so a
 * view that only ever surfaced the winner would always conclude that ripping pays.
 *
 * **Set** shows its parts and never a blend. Sold, still trying, and held on purpose are
 * three different facts, and averaging a realized flip together with an unrealized hold
 * describes neither of them.
 *
 * **Lineage** lives on the product page, because it is about one thing rather than the shape
 * of the whole store. It is never added to the tier view: a case's lineage return *is* the
 * aggregate of its descendants, so a combined total would count the same money twice.
 */

import { useQuery } from '@tanstack/react-query'

import { api, type LineageNode } from '../api'
import { money, percent, signedMoney, toneFor } from '../format'
import { Card, Empty, Skeleton } from './ui'

export function TierReport() {
  const rows = useQuery({ queryKey: ['byTier'], queryFn: api.byTier })

  if (rows.isLoading) return <Skeleton className="h-40 w-full" />
  if (!rows.data?.length) {
    return (
      <Card>
        <Empty>Nothing has sold yet, so there is nothing to compare.</Empty>
      </Card>
    )
  }

  return (
    <>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-(--color-edge) text-left text-xs uppercase tracking-wide text-(--color-muted)">
            <tr>
              <th className="px-4 py-3 font-medium">Tier</th>
              <th className="px-4 py-3 text-right font-medium">Sold</th>
              <th className="px-4 py-3 text-right font-medium">Profit</th>
              <th className="px-4 py-3 text-right font-medium">Typical</th>
              <th className="px-4 py-3 text-right font-medium">Worst → best</th>
              <th className="px-4 py-3 text-right font-medium">Days held</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-(--color-edge)">
            {rows.data.map((row) => (
              <tr key={row.key}>
                <td className="px-4 py-3">
                  {row.label}
                  <span className="ml-2 text-xs text-(--color-faint)">
                    {row.products_traded} product{row.products_traded === 1 ? '' : 's'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{row.units_sold}</td>
                <td
                  className={`px-4 py-3 text-right tabular-nums ${toneFor(row.realized_profit)}`}
                >
                  {signedMoney(row.realized_profit)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {percent(row.median_roi)}
                </td>
                {/* The spread, beside the middle. One enormous win must not read as the
                    normal outcome. */}
                <td className="px-4 py-3 text-right text-xs tabular-nums">
                  <span className={toneFor(row.worst_roi ?? 0)}>{percent(row.worst_roi)}</span>
                  <span className="mx-1 text-(--color-faint)">→</span>
                  <span className={toneFor(row.best_roi ?? 0)}>{percent(row.best_roi)}</span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-(--color-muted)">
                  {row.avg_days_held ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="mt-2 text-xs text-(--color-faint)">
        Read a row against its own history, not against the row above it. A $900 case is
        harder to move than a $150 box and <em>should</em> sit longer, so case-versus-box is
        not a fair comparison. The worst-to-best range is there because the case anybody
        remembers is the one that hit.
      </p>
    </>
  )
}

export function SetReport() {
  const rows = useQuery({ queryKey: ['bySet'], queryFn: api.bySet })

  if (rows.isLoading) return <Skeleton className="h-40 w-full" />
  if (!rows.data?.length) {
    return (
      <Card>
        <Empty>No sets have anything recorded against them yet.</Empty>
      </Card>
    )
  }

  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2">
        {rows.data.map((row) => (
          <li key={row.set_id}>
            <Card>
              <p className="font-medium">{row.name}</p>
              {/* Three facts, side by side. There is deliberately no single number for
                  this set - one would have to average a flip against a hold. */}
              <dl className="mt-3 grid grid-cols-3 gap-3 text-xs">
                <div>
                  <dt className="text-(--color-faint)">Sold</dt>
                  <dd className={`mt-0.5 tabular-nums ${toneFor(row.realized_profit)}`}>
                    {signedMoney(row.realized_profit)}
                  </dd>
                  <dd className="text-(--color-faint)">
                    {row.units_sold} unit{row.units_sold === 1 ? '' : 's'} ·{' '}
                    {percent(row.sold_roi)}
                  </dd>
                </div>
                <div>
                  <dt className="text-(--color-faint)">In the Store</dt>
                  <dd className="mt-0.5 tabular-nums">{money(row.store_cost)}</dd>
                  <dd className="text-(--color-faint)">
                    {row.units_in_store} unit{row.units_in_store === 1 ? '' : 's'}
                    {row.oldest_store_days !== null && ` · ${row.oldest_store_days}d oldest`}
                  </dd>
                </div>
                <div>
                  <dt className="text-(--color-faint)">In the Vault</dt>
                  <dd className="mt-0.5 tabular-nums">{money(row.vault_cost)}</dd>
                  {/* No ageing figure on purpose. The Vault is not asleep. */}
                  <dd className="text-(--color-faint)">
                    {row.units_in_vault} unit{row.units_in_vault === 1 ? '' : 's'} · on
                    purpose
                  </dd>
                </div>
              </dl>
            </Card>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-(--color-faint)">
        Three figures per set, never one. A single blended return would mix realized flips
        with unrealized holds and describe neither. Only the Store carries an age — the
        Vault is parked deliberately, not sitting unsold.
      </p>
    </>
  )
}

function Branch({ node }: { node: LineageNode }) {
  return (
    <li style={{ paddingLeft: `${(node.depth - 1) * 1.25}rem` }}>
      <span className="text-sm">
        <span className="text-(--color-faint)">└ </span>
        {node.quantity_produced}&times; {node.product_name}
        <span className="ml-2 text-xs text-(--color-faint)">
          {money(node.cost, 'cost unknown')}
        </span>
      </span>
      {node.children.length > 0 && (
        <ul className="mt-1 space-y-1">
          {node.children.map((child) => (
            <Branch key={child.product_id} node={child} />
          ))}
        </ul>
      )}
    </li>
  )
}

/** One product, all-in, across everything it became. */
export function LineageReport({ productId }: { productId: string }) {
  const rolled = useQuery({
    queryKey: ['lineage', productId],
    queryFn: () => api.lineage(productId),
  })

  const data = rolled.data
  // Nothing came out of it and nothing has sold: there is no story to tell yet.
  if (!data || (data.tree.length === 0 && data.units_sold === 0)) return null

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-(--color-muted)">
        All-in
      </h2>
      <Card>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-[0.6875rem] tracking-[0.1em] text-(--color-faint)">WENT IN</p>
            <p className="font-display mt-0.5 text-lg font-bold tabular-nums">
              {money(data.cost)}
            </p>
          </div>
          <div>
            <p className="text-[0.6875rem] tracking-[0.1em] text-(--color-faint)">
              CAME BACK
            </p>
            <p
              className={`font-display mt-0.5 text-lg font-bold tabular-nums ${toneFor(
                data.realized_profit,
              )}`}
            >
              {signedMoney(data.realized_profit)}
            </p>
          </div>
          <div>
            <p className="text-[0.6875rem] tracking-[0.1em] text-(--color-faint)">
              STILL HELD
            </p>
            <p className="font-display mt-0.5 text-lg font-bold tabular-nums">
              {money(data.remaining_cost)}
            </p>
            <p className="text-xs text-(--color-faint)">
              {data.units_remaining} unit{data.units_remaining === 1 ? '' : 's'}
            </p>
          </div>
          <div>
            <p className="text-[0.6875rem] tracking-[0.1em] text-(--color-faint)">RETURN</p>
            <p
              className={`font-display mt-0.5 text-lg font-bold tabular-nums ${toneFor(
                data.roi ?? 0,
              )}`}
            >
              {percent(data.roi)}
            </p>
            <p className="text-xs text-(--color-faint)">
              {data.units_sold} sold
              {Number(data.written_off) > 0 && ` · ${money(data.written_off)} bulk`}
            </p>
          </div>
        </div>

        {data.tree.length > 0 && (
          <ul className="mt-4 space-y-1 border-t border-(--color-edge) pt-3">
            {data.tree.map((node) => (
              <Branch key={node.product_id} node={node} />
            ))}
          </ul>
        )}

        <p className="mt-3 text-xs text-(--color-faint)">
          Measured against what this cost, across everything it turned into. Not comparable
          with the tier report — that one already counts these descendants, so adding the
          two would double the same money.
        </p>
      </Card>
    </section>
  )
}
