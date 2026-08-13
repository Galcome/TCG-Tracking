/**
 * The three rollups, on screen.
 *
 * The rules worth driving a browser for are the ones about what is *not* shown: the tier
 * view has to carry the spread and not just the average, and the set view has to show its
 * parts rather than one blended figure.
 */
import { expect, test, type Page } from '@playwright/test'

import { gotoInventory, openProduct, uniqueName } from './helpers'

async function addProduct(
  page: Page,
  name: string,
  total: string,
  set?: string,
  type?: string,
) {
  await gotoInventory(page)
  await page.getByRole('button', { name: 'Add product' }).first().click()

  const dialog = page.locator('form')
  await dialog.getByLabel('Name').fill(name)
  // Tier is grouped by product type, so a rollup spec that left everything at the default
  // was comparing one tier against itself.
  await dialog.getByLabel('Product type').selectOption({ label: type ?? 'Booster Box' })
  await dialog.getByLabel('Quantity').fill('1')
  await dialog.getByLabel('Total paid').fill(total)
  if (set) await dialog.getByPlaceholder('Start typing, or pick one below').fill(set)
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
}

test('the tier view shows the spread, not just the average', async ({ page }) => {
  const winner = uniqueName('Spread Winner')
  const loser = uniqueName('Spread Loser')
  await addProduct(page, winner, '100.00')
  await addProduct(page, loser, '100.00')

  for (const [name, price] of [
    [winner, '400.00'],
    [loser, '40.00'],
  ] as const) {
    await openProduct(page, name)
    await page.getByRole('button', { name: 'Record sale' }).first().click()
    const dialog = page.locator('form')
    await dialog.getByLabel('Total received').fill(price)
    await dialog.getByRole('button', { name: 'Record sale' }).click()
    await expect(dialog).toBeHidden()
  }

  await page.goto('/reports')
  await expect(page.getByText('Was the strategy right?')).toBeVisible({ timeout: 10_000 })

  // The range, not one number. A big win must not read as the normal outcome.
  await expect(page.getByRole('columnheader', { name: /Worst/ })).toBeVisible()
  await expect(page.getByText(/the case anybody remembers is the one that hit/)).toBeVisible()
})

test('a set is shown as three figures and never one', async ({ page }) => {
  const setName = uniqueName('Rollup Set')
  const sold = uniqueName('Rollup Sold')
  await addProduct(page, sold, '100.00', setName)

  await openProduct(page, sold)
  await page.getByRole('button', { name: 'Record sale' }).first().click()
  const dialog = page.locator('form')
  await dialog.getByLabel('Total received').fill('180.00')
  await dialog.getByRole('button', { name: 'Record sale' }).click()
  await expect(dialog).toBeHidden()

  await page.goto('/reports')
  const card = page.getByRole('listitem').filter({ hasText: setName })
  await expect(card).toBeVisible({ timeout: 10_000 })

  // Sold, Store and Vault side by side. There is deliberately no single set ROI.
  await expect(card.getByText('Sold', { exact: true })).toBeVisible()
  await expect(card.getByText('In the Store')).toBeVisible()
  await expect(card.getByText('In the Vault')).toBeVisible()
  await expect(page.getByText(/never one/).first()).toBeVisible()
})

test('a case shows what it returned all-in', async ({ page }) => {
  const caseName = uniqueName('All In Case')
  const boxName = uniqueName('All In Box')
  await addProduct(page, caseName, '600.00', undefined, 'Sealed Case')

  await openProduct(page, caseName)
  await page.getByRole('button', { name: 'Crack open' }).click()
  const dialog = page.locator('form')
  await dialog.getByLabel('Boxes per case').fill('6')
  await dialog.getByLabel('Name').fill(boxName)
  await dialog.getByRole('button', { name: 'Crack it open' }).click()
  await expect(dialog).toBeHidden()

  // The chain, and what went in against what has come back.
  await expect(page.getByText('WENT IN')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('$600.00').first()).toBeVisible()
  // Named twice on this page - in the chain and in the Opened row below it.
  await expect(page.getByText(new RegExp(boxName)).first()).toBeVisible()
  await expect(page.getByText(/would double the same money/)).toBeVisible()
})
