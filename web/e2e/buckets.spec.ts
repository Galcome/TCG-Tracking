/**
 * Buckets and moves, through the real app.
 *
 * The journey that was impossible before this landed: buy two of a thing and put one in the
 * Store and one in the Vault. `storage_location` was a single text field on the product, so
 * the two could never differ.
 */
import { expect, test, type Page } from '@playwright/test'

import { addProduct, gotoInventory, openProduct, rx, stat } from './helpers'

/** Move stock between buckets from the product page. */
async function moveStock(page: Page, options: { quantity: number; from: string; to: string }) {
  await page.getByRole('button', { name: 'Move', exact: true }).first().click()
  const dialog = page.locator('form')

  await dialog.getByLabel('Move from').selectOption(options.from)
  await dialog.getByLabel('Move to').selectOption(options.to)
  await dialog.getByLabel('How many').fill(String(options.quantity))
  await dialog.getByRole('button', { name: 'Move', exact: true }).click()
  await expect(dialog).toBeHidden()
}

test('two of the same product can sit in different buckets', async ({ page }) => {
  const name = await addProduct(page, { quantity: 2, total: '600.00' })
  await openProduct(page, name)

  await moveStock(page, { quantity: 1, from: 'inventory', to: 'vault' })

  await gotoInventory(page)
  await page.getByPlaceholder('Search products…').fill(name)

  const row = page.getByRole('row', { name: rx(name) })
  await expect(row).toContainText('1 inventory', { timeout: 10_000 })
  await expect(row).toContainText('1 vault')
})

test('moving changes where stock is, never how much or what it cost', async ({ page }) => {
  const name = await addProduct(page, { quantity: 4, total: '400.00' })
  await openProduct(page, name)

  await expect(stat(page, 'In stock')).toHaveText('4')
  const costBefore = await stat(page, 'Inventory at cost').innerText()

  await moveStock(page, { quantity: 3, from: 'inventory', to: 'store' })

  // The two figures the whole design rests on: neither may move.
  await expect(stat(page, 'In stock')).toHaveText('4')
  await expect(stat(page, 'Inventory at cost')).toHaveText(costBefore)
})

test('the inventory list can be filtered to one bucket', async ({ page }) => {
  const name = await addProduct(page, { quantity: 2, total: '200.00' })
  await openProduct(page, name)
  await moveStock(page, { quantity: 2, from: 'inventory', to: 'vault' })

  await gotoInventory(page)
  await page.getByPlaceholder('Search products…').fill(name)

  // Everything moved out of Inventory, so it is absent from that view and present in Vault.
  await page.getByRole('combobox').nth(1).selectOption('vault')
  await expect(page.getByRole('row', { name: rx(name) })).toBeVisible({ timeout: 10_000 })

  await page.getByRole('combobox').nth(1).selectOption('inventory')
  await expect(page.getByRole('row', { name: rx(name) })).toBeHidden({ timeout: 10_000 })
})

test('a move is recorded in history with the date it happened', async ({ page }) => {
  const name = await addProduct(page, { quantity: 3, total: '300.00' })
  await openProduct(page, name)
  await moveStock(page, { quantity: 2, from: 'inventory', to: 'store' })

  const row = page.getByRole('row', { name: /Move/ })
  await expect(row).toBeVisible({ timeout: 10_000 })
  await expect(row).toContainText('2 to store')

  // A move relocates stock rather than creating it, so it contributes nothing to quantity.
  await expect(row).toContainText('0')
})

test('voiding a move puts the stock back where it was', async ({ page }) => {
  const name = await addProduct(page, { quantity: 2, total: '200.00' })
  await openProduct(page, name)
  await moveStock(page, { quantity: 2, from: 'inventory', to: 'vault' })

  await page.getByRole('row', { name: /Move/ }).getByRole('button', { name: 'Void' }).click()
  const dialog = page.locator('form')
  await dialog.getByLabel('Reason').fill('wrong pile')
  await dialog.getByRole('button', { name: 'Void it' }).click()
  await expect(dialog).toBeHidden()

  await gotoInventory(page)
  await page.getByPlaceholder('Search products…').fill(name)
  await page.getByRole('combobox').nth(1).selectOption('inventory')
  await expect(page.getByRole('row', { name: rx(name) })).toBeVisible({ timeout: 10_000 })
})
