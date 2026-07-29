/** Correcting a sale from the screen it is looked at on, and selling off-platform. */
import { expect, test } from '@playwright/test'

import { addProduct, openProduct, recordSale, rx, statAmount } from './helpers'

/** The Sales row for one product, isolated by search so other specs cannot bleed in. */
async function saleRow(page: import('@playwright/test').Page, name: string) {
  await page.goto('/sales')
  await page.getByPlaceholder('Search by product…').fill(name)
  const row = page.getByRole('row', { name: rx(name) })
  await expect(row).toBeVisible({ timeout: 10_000 })
  return row
}

test('a mistyped fee can be fixed from the sales ledger', async ({ page }) => {
  const name = await addProduct(page, { quantity: 1, total: '200.00' })
  await openProduct(page, name)
  await recordSale(page, { quantity: 1, total: '300.00', channel: 'eBay', platformFees: '40.00' })

  let row = await saleRow(page, name)
  await expect(row).toContainText('$260.00') // net proceeds
  await expect(row).toContainText('+$60.00') // profit

  await row.getByRole('button', { name: 'Edit' }).click()
  const dialog = page.locator('form')
  await dialog.getByText('Advanced').click()
  await dialog.getByLabel('Platform fees').fill('30.00')
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(dialog).toBeHidden()

  row = await saleRow(page, name)
  await expect(row).toContainText('$270.00')
  await expect(row).toContainText('+$70.00')
})

test('voiding a sale takes its profit back out', async ({ page }) => {
  const name = await addProduct(page, { quantity: 1, total: '200.00' })
  await openProduct(page, name)
  await recordSale(page, { quantity: 1, total: '300.00', platformFees: '0' })
  expect(await statAmount(page, 'Realized profit')).toBe(100)

  const row = await saleRow(page, name)
  await row.getByRole('button', { name: 'Void' }).click()
  const dialog = page.locator('form')
  await dialog.getByLabel('Reason').fill('entered twice')
  await dialog.getByRole('button', { name: 'Void it' }).click()
  await expect(dialog).toBeHidden()

  await openProduct(page, name)
  expect(await statAmount(page, 'Realized profit')).toBe(0)
  await expect(stat(page, 'In stock')).toHaveText('1')
})

test('a sale can be recorded somewhere that is not one of the six channels', async ({ page }) => {
  const name = await addProduct(page, { quantity: 1, total: '200.00' })
  await openProduct(page, name)
  await recordSale(page, { quantity: 1, total: '300.00', channel: 'Corner card shop' })

  const row = await saleRow(page, name)
  await expect(row).toContainText('Corner card shop')

  // A channel you can enter has to be a channel you can filter by.
  await page.getByPlaceholder('Search by product…').fill('')
  await page.locator('select').first().selectOption('Corner card shop')
  await expect(page.getByRole('row', { name: rx(name) })).toBeVisible()
})

test('unsold stock is listed under how long it has been sitting', async ({ page }) => {
  const name = await addProduct(page, { quantity: 3, total: '600.00' })

  await page.goto('/reports')
  const band = page.getByRole('button', { name: /0-30 days/ })
  await expect(band).toBeVisible({ timeout: 10_000 })
  await band.click()

  // Asserting on this lot, not the band total: the total is store-wide and every other
  // spec in this file adds to it.
  const lot = page.getByRole('link', { name: rx(name) })
  await expect(lot).toContainText('3 units')
  await expect(lot).toContainText('$600.00')
})

function stat(page: import('@playwright/test').Page, label: string) {
  return page.getByText(label, { exact: true }).locator('xpath=..').locator('p').nth(1)
}
