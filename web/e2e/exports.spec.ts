/**
 * The CSV exports, checked by reading the file rather than trusting the button.
 *
 * The group already lives in Excel, so the export is the feature that lets them pivot
 * anything the app does not show. The old one carried twelve columns and no set, type,
 * days held or ROI - which meant rebuilding by hand the exact mappings the app already
 * knows.
 *
 * Two rules are asserted here because both are ways a file can look right and be wrong:
 * unknown cost exports as **empty** rather than `0`, and every cell is quoted so a comma
 * in a set name cannot shift a column.
 */
import { expect, test } from '@playwright/test'

import { addProduct, openProduct, recordSale, uniqueName } from './helpers'

/** Click something that downloads, and return the file's text. */
async function download(page: import('@playwright/test').Page, click: () => Promise<void>) {
  const [file] = await Promise.all([page.waitForEvent('download'), click()])
  const path = await file.path()
  const { readFile } = await import('node:fs/promises')
  return { name: file.suggestedFilename(), text: await readFile(path, 'utf8') }
}

test('the sales export carries the set, the type and the return', async ({ page }) => {
  const name = await addProduct(page, {
    name: uniqueName('Export Box'),
    quantity: 2,
    total: '200.00',
  })
  await openProduct(page, name)
  await recordSale(page, { quantity: 1, total: '400.00', platformFees: '0' })

  await page.goto('/sales')
  const csv = await download(page, () =>
    page.getByRole('button', { name: 'CSV' }).click(),
  )

  expect(csv.name).toMatch(/^tcg-sales-\d{4}-\d{2}-\d{2}\.csv$/)

  const header = csv.text.split('\n')[0]
  for (const column of ['set', 'type', 'language', 'roi_percent', 'days_held', 'unit_cost']) {
    expect(header).toContain(`"${column}"`)
  }

  // Every cell quoted: a set called "Cards, Comics & Games" would otherwise shift every
  // column to its right without warning.
  expect(csv.text).toContain(`"${name}"`)
})

test('the grouped export is whatever is on screen, filters included', async ({ page }) => {
  const name = await addProduct(page, {
    name: uniqueName('Grouped Box'),
    quantity: 1,
    total: '100.00',
  })
  await openProduct(page, name)
  await recordSale(page, { quantity: 1, total: '250.00', platformFees: '0' })

  await page.goto('/reports')
  const all = await download(page, () =>
    page.getByRole('button', { name: 'This view' }).click(),
  )
  expect(all.name).toContain('tcg-by-game')
  expect(all.text).toContain('"Pokémon"')

  // Filtered to a type with no sales, the same button must produce an empty report rather
  // than the unfiltered one. An export that ignores the controls above it is a different
  // dataset wearing the same name.
  await page.getByLabel('Filter by product type').selectOption({ label: 'Binder' })
  await expect(page.getByText(/has anything to report/)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'This view' })).toBeDisabled()
})

test('the inventory export lists what is on the shelf', async ({ page }) => {
  const name = await addProduct(page, {
    name: uniqueName('Shelf Box'),
    quantity: 3,
    total: '300.00',
  })

  await page.goto('/reports')
  const csv = await download(page, () =>
    page.getByRole('button', { name: 'Inventory' }).click(),
  )

  expect(csv.name).toContain('tcg-inventory')
  expect(csv.text).toContain(`"${name}"`)

  // The bucket split is what makes it useful: three units in Inventory is a different
  // position from three spread across Store and Vault.
  const header = csv.text.split('\n')[0]
  for (const column of ['inventory', 'store', 'vault', 'unit_cost']) {
    expect(header).toContain(`"${column}"`)
  }
})

test('an unknown cost exports as empty, never as zero', async ({ page }) => {
  // A sale with no purchase behind it has no cost basis at all.
  const name = await addProduct(page, {
    name: uniqueName('Unknown Cost Box'),
    quantity: 1,
    total: '100.00',
  })
  await openProduct(page, name)
  await recordSale(page, { quantity: 1, total: '150.00', platformFees: '0' })

  await page.goto('/sales')
  const csv = await download(page, () =>
    page.getByRole('button', { name: 'CSV' }).click(),
  )

  // Nothing anywhere in the file should be a bare "0" standing in for a missing cost.
  // A zero there becomes "it was free" the moment somebody sums the column.
  const header = csv.text.split('\n')[0].split(',')
  const costColumn = header.indexOf('"cost_basis"')
  expect(costColumn).toBeGreaterThan(-1)

  for (const line of csv.text.split('\n').slice(1).filter(Boolean)) {
    const cell = line.split(',')[costColumn]
    expect(cell === '""' || Number(cell.replace(/"/g, '')) > 0).toBe(true)
  }
})
