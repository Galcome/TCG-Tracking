/**
 * What is in the Vault, and what it has done since.
 *
 * Measured on **appreciation** rather than velocity, because that is what a deliberate long
 * hold is for. There is no days-to-sell column here on purpose, and the Vault does not
 * appear in the ageing report at all - it is not asleep, it is parked.
 *
 * The one thing shown alongside is how long something sat in the Store before it was moved
 * here. Exempting the Vault from ageing would otherwise make it the place slow stock goes to
 * disappear. Nothing is blocked and nothing is nagged about; it is simply visible whether
 * the Vault is a strategy or an excuse.
 */

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, type VaultHolding } from '../api'
import { money, percent, shortDate, signedMoney, todayIso, toneFor } from '../format'
import { MONEY_INPUT, useLedgerMutation } from './forms'
import { Card, Dialog, Empty, Field, FIELD_CLASS, RowAction, Skeleton } from './ui'

/** Older than a year is what the workbook itself treats as due for revaluing. */
const STALE_DAYS = 365

function ValueDialog({
  holding,
  onClose,
}: {
  holding: VaultHolding
  onClose: () => void
}) {
  const [value, setValue] = useState('')
  const [capturedOn, setDate] = useState(todayIso())

  const run = useLedgerMutation(
    () =>
      api.recordValuation({
        product_id: holding.product_id,
        value,
        captured_on: capturedOn,
      }),
    onClose,
  )

  return (
    <Dialog
      title={`What is ${holding.product_name} worth?`}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault()
        run.mutate(undefined)
      }}
      submitLabel="Save it"
      busy={run.isPending}
      error={run.error ? (run.error as Error).message : null}
    >
      <Field
        label="Per unit, today"
        hint={`${holding.units} held, at ${money(holding.cost)} of cost`}
      >
        <input
          required
          autoFocus
          {...MONEY_INPUT}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={FIELD_CLASS}
        />
      </Field>
      <Field label="As at">
        <input
          required
          type="date"
          value={capturedOn}
          onChange={(e) => setDate(e.target.value)}
          className={FIELD_CLASS}
        />
      </Field>
      <p className="rounded-lg border border-(--color-edge) bg-(--color-ink)/50 px-3 py-2 text-xs text-(--color-muted)">
        An estimate, kept with its date. It never becomes cost basis and it never becomes
        profit &mdash; those follow what was actually paid and actually received.
      </p>
    </Dialog>
  )
}

export function VaultReport() {
  const rows = useQuery({ queryKey: ['vaultHoldings'], queryFn: api.vaultHoldings })
  const [valuing, setValuing] = useState<VaultHolding | null>(null)

  if (rows.isLoading) return <Skeleton className="h-40 w-full" />
  if (!rows.data?.length) {
    return (
      <Card>
        <Empty>
          Nothing in the Vault yet. Move something here when you mean to hold it.
        </Empty>
      </Card>
    )
  }

  const total = rows.data.reduce((sum, row) => sum + Number(row.cost), 0)

  return (
    <>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-(--color-edge) text-left text-xs uppercase tracking-wide text-(--color-muted)">
            <tr>
              <th className="px-4 py-3 font-medium">Held</th>
              <th className="px-4 py-3 text-right font-medium">Cost</th>
              <th className="px-4 py-3 text-right font-medium">Worth</th>
              <th className="px-4 py-3 text-right font-medium">Market estimate</th>
              <th className="px-4 py-3 text-right font-medium">Change</th>
              <th className="px-4 py-3 text-right font-medium">A year</th>
              <th className="py-3 pl-2 pr-4" />
            </tr>
          </thead>
          <tbody className="divide-y divide-(--color-edge)">
            {rows.data.map((row) => (
              <tr key={row.product_id}>
                <td className="px-4 py-3">
                  {row.product_name}
                  <span className="mt-0.5 block text-xs text-(--color-faint)">
                    {row.units} unit{row.units === 1 ? '' : 's'}
                    {row.days_held !== null && ` · held ${row.days_held}d`}
                    {/* The loophole guard, said quietly and not as a warning. */}
                    {row.days_in_store_first !== null &&
                      ` · moved here after ${row.days_in_store_first}d in the Store`}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{money(row.cost)}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {row.value === null ? (
                    <span className="text-(--color-faint)">not valued</span>
                  ) : (
                    <>
                      {money(row.value)}
                      {row.days_since_valued !== null &&
                        row.days_since_valued > STALE_DAYS && (
                          <span className="mt-0.5 block text-xs text-(--color-loss)">
                            {row.days_since_valued}d old
                          </span>
                        )}
                    </>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {row.market_estimate?.value === null || !row.market_estimate ? (
                    <span className="text-(--color-faint)">—</span>
                  ) : (
                    <>
                      {money(row.market_estimate.value)}
                      <span
                        className={`mt-0.5 block text-[0.6875rem] ${
                          row.market_estimate.status === 'fresh'
                            ? 'text-(--color-faint)'
                            : 'text-(--color-loss)'
                        }`}
                      >
                        per unit · {row.market_estimate.provider}
                        {row.market_estimate.captured_on &&
                          ` · ${shortDate(row.market_estimate.captured_on)}`}
                        {row.market_estimate.status !== 'fresh' &&
                          ` · ${row.market_estimate.status}`}
                      </span>
                    </>
                  )}
                </td>
                <td
                  className={`px-4 py-3 text-right tabular-nums ${toneFor(
                    row.appreciation ?? 0,
                  )}`}
                >
                  {row.appreciation === null ? '—' : signedMoney(row.appreciation)}
                  {row.appreciation_pct !== null && (
                    <span className="mt-0.5 block text-xs">
                      {percent(row.appreciation_pct)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-(--color-muted)">
                  {row.annualised === null ? '—' : percent(row.annualised)}
                </td>
                <td className="whitespace-nowrap py-3 pl-2 pr-4 text-right">
                  <RowAction onClick={() => setValuing(row)}>Value it</RowAction>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="mt-2 text-xs text-(--color-faint)">
        {money(total.toFixed(2))} of capital is parked here. That is a real constraint on
        what can be spent &mdash; it is not a warning. There is no days-to-sell figure, and
        the Vault is left out of the ageing report entirely, because it is not asleep.
      </p>

      {valuing && <ValueDialog holding={valuing} onClose={() => setValuing(null)} />}
    </>
  )
}
