/**
 * The journey Joseph reported broken: move something to the Store and see that it moved.
 *
 * The original e2e moved 1 of 2, which shows a split. It never moved *all* of something,
 * which is the case where the row said nothing at all and the move looked like a no-op.
 */
import { expect, test, type Page } from '@playwright/test'

import { addProduct, gotoInventory, openProduct, rx, stat } from './helpers'

async function moveAll(page: Page, to: string, quantity = 1) {
  await page.getByRole('button', { name: 'Move', exact: true }).first().click()
  const dialog = page.getByRole('dialog').locator('form')
  await dialog.getByLabel('Move to').selectOption(to)
  await dialog.getByLabel('How many').fill(String(quantity))
  await dialog.getByRole('button', { name: 'Move', exact: true }).click()
  await expect(dialog).toBeHidden()
}

test('moving everything to the Store visibly changes the row', async ({ page }) => {
  const name = await addProduct(page, { quantity: 1, total: '200.00' })
  await openProduct(page, name)
  await moveAll(page, 'store')

  await gotoInventory(page)
  await page.getByPlaceholder('Search products…').fill(name)

  const row = page.getByRole('row', { name: rx(name) })
  await expect(row).toBeVisible({ timeout: 10_000 })
  await expect(row).toContainText('1 store')
})

test('the product page says where its stock is', async ({ page }) => {
  const name = await addProduct(page, { quantity: 1, total: '200.00' })
  await openProduct(page, name)

  await moveAll(page, 'vault')
  await expect(page.getByText('1 vault')).toBeVisible({ timeout: 10_000 })
  await expect(stat(page, 'In stock')).toHaveText('1')
})

test('the buckets are tabs, and their counts survive being filtered', async ({ page }) => {
  const name = await addProduct(page, { quantity: 3, total: '300.00' })
  await openProduct(page, name)
  await moveAll(page, 'vault', 3)

  await gotoInventory(page)
  const vaultTab = page.getByRole('button', { name: /^Vault/ })
  await expect(vaultTab).toBeVisible({ timeout: 10_000 })

  await vaultTab.click()
  await page.getByPlaceholder('Search products…').fill(name)
  await expect(page.getByRole('row', { name: rx(name) })).toBeVisible({ timeout: 10_000 })

  // Standing on the Vault tab must not make the other tabs read zero.
  await expect(page.getByRole('button', { name: /^Vault/ })).not.toContainText('Vault 0')
})

test('a sale is booked against the bucket it actually came from', async ({ page }) => {
  const name = await addProduct(page, { quantity: 2, total: '200.00' })
  await openProduct(page, name)
  await moveAll(page, 'store', 2)

  await page.getByRole('button', { name: 'Record sale' }).first().click()
  const dialog = page.getByRole('dialog').locator('form')
  await dialog.getByLabel('Total received').fill('300.00')
  // Defaults to where the stock is, rather than silently saying Inventory.
  // The bucket chip reads "Store (2)"; anchoring on the count keeps this off the
  // "Store credit…" destination chip, which also starts with the word Store.
  await expect(dialog.getByRole('button', { name: /^Store \(/ })).toHaveClass(/color-accent/)
  await dialog.getByRole('button', { name: 'Record sale' }).click()
  await expect(dialog).toBeHidden()

  // The bug this guards: Inventory would have gone to -1 while the Store stayed full.
  await expect(page.getByText('1 store')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/-1 inventory/)).toBeHidden()
})

test('a purchase can go straight to the Vault', async ({ page }) => {
  await gotoInventory(page)
  await page.getByRole('button', { name: 'Add product' }).first().click()

  const dialog = page.getByRole('dialog').locator('form')
  const name = `Straight to Vault ${Date.now().toString(36)}`
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('Quantity').fill('2')
  await dialog.getByLabel('Total paid').fill('600.00')
  await dialog.getByRole('button', { name: /^Vault/ }).click()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  await gotoInventory(page)
  await page.getByPlaceholder('Search products…').fill(name)
  await expect(page.getByRole('row', { name: rx(name) })).toContainText('2 vault', {
    timeout: 10_000,
  })
})
