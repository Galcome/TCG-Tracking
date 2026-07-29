/**
 * The journeys that have actually broken in production.
 *
 * These run against the real API and a real database, so they check the thing a stubbed
 * client cannot: that the numbers on screen are the ones the FIFO engine computed.
 */
import { expect, test } from '@playwright/test'

import { addProduct, gotoInventory, openProduct, recordSale, rx, stat, statAmount } from './helpers'

test('a new product shows up in inventory at what it cost', async ({ page }) => {
  const name = await addProduct(page, { quantity: 2, total: '400.00' })

  await gotoInventory(page)
  await page.getByPlaceholder('Search products…').fill(name)

  const row = page.getByRole('row', { name: rx(name) })
  await expect(row).toContainText('$200.00', { timeout: 10_000 }) // unit cost
  await expect(row).toContainText('$400.00') // inventory value
})

test('recording a sale moves stock into profit', async ({ page }) => {
  const name = await addProduct(page, { quantity: 2, total: '400.00' })
  await openProduct(page, name)

  await recordSale(page, { quantity: 1, total: '300.00', channel: 'eBay', platformFees: '0' })

  await expect(stat(page, 'In stock')).toHaveText('1')
  expect(await statAmount(page, 'Realized profit')).toBe(100)
  expect(await statAmount(page, 'Inventory at cost')).toBe(200)

  await page.goto('/sales')
  await expect(page.getByRole('row', { name: rx(name) })).toContainText('+$100.00')
})

test('editing what a purchase cost re-runs FIFO on the sale drawn from it', async ({ page }) => {
  const name = await addProduct(page, { quantity: 2, total: '400.00' })
  await openProduct(page, name)
  await recordSale(page, { quantity: 1, total: '300.00', platformFees: '0' })

  expect(await statAmount(page, 'Realized profit')).toBe(100)

  // The receipt actually said 500, not 400. One unit's cost goes 200 -> 250.
  await page.getByRole('row', { name: /Purchase/ }).getByRole('button', { name: 'Edit' }).click()
  const dialog = page.locator('form')
  await dialog.getByLabel('Total paid').fill('500.00')
  await dialog.getByLabel('Why the change?').fill('receipt said 500')
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(dialog).toBeHidden()

  await expect
    .poll(() => statAmount(page, 'Realized profit'), { timeout: 10_000 })
    .toBe(50)
  expect(await statAmount(page, 'Inventory at cost')).toBe(250)
})

test('saving a purchase untouched does not quietly inflate what it cost', async ({ page }) => {
  // $180 plus $20 shipping. The edit form used to show the $200 landed total and PATCH it
  // back as the base amount, so shipping was added a second time and the lot became $220.
  const name = await addProduct(page, { quantity: 1, total: '180.00', shipping: '20.00' })
  await openProduct(page, name)

  expect(await statAmount(page, 'Inventory at cost')).toBe(200)

  await page.getByRole('row', { name: /Purchase/ }).getByRole('button', { name: 'Edit' }).click()
  const dialog = page.locator('form')
  await expect(dialog.getByLabel('Total paid')).toHaveValue('180.00')
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(dialog).toBeHidden()

  await expect
    .poll(() => statAmount(page, 'Inventory at cost'), { timeout: 10_000 })
    .toBe(200)
})
