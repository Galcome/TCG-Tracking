/**
 * Ripping a box, through the real app.
 *
 * The distinction worth driving a browser for: a box is a lottery, so cost follows what
 * the hits are worth rather than splitting evenly - and whatever they do not take is bulk,
 * written off while you are still looking at the screen rather than in a report later.
 */
import { expect, test, type Page } from '@playwright/test'

import { gotoInventory, openProduct, statAmount, uniqueName } from './helpers'

async function addBox(page: Page, total: string): Promise<string> {
  const name = uniqueName('Rip Box')
  await gotoInventory(page)
  await page.getByRole('button', { name: 'Add product' }).first().click()

  const dialog = page.locator('form')
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('Quantity').fill('1')
  await dialog.getByLabel('Total paid').fill(total)
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  return name
}

test('the big hit carries most of the box', async ({ page }) => {
  const boxName = await addBox(page, '150.00')
  const big = uniqueName('Iconic')
  const small = uniqueName('Filler')

  await openProduct(page, boxName)
  await page.getByRole('button', { name: 'Rip open' }).click()

  const dialog = page.locator('form')
  await dialog.getByLabel('Hit 1 name').fill(big)
  await dialog.getByLabel('Hit 1 value').fill('500.00')
  await dialog.getByRole('button', { name: 'Add another' }).click()
  await dialog.getByLabel('Hit 2 name').fill(small)
  await dialog.getByLabel('Hit 2 value').fill('10.00')

  // The split is shown while you type, not discovered afterwards.
  await expect(dialog.getByText(/takes \$147\./)).toBeVisible()

  await dialog.getByRole('button', { name: 'Log the hits' }).click()
  await expect(dialog).toBeHidden()

  await openProduct(page, big)
  const bigCost = await statAmount(page, 'Inventory at cost')
  expect(bigCost).toBeGreaterThan(140)

  await openProduct(page, small)
  const smallCost = await statAmount(page, 'Inventory at cost')
  expect(smallCost).toBeLessThan(10)
})

test('a rip with nothing worth keeping writes the whole box off', async ({ page }) => {
  const boxName = await addBox(page, '150.00')

  await openProduct(page, boxName)
  await page.getByRole('button', { name: 'Rip open' }).click()

  const dialog = page.locator('form')
  // The honest record of a bad one, and the button says so.
  await expect(dialog.getByText(/All of it written off as bulk/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Rip it, nothing worth keeping' }).click()
  await expect(dialog).toBeHidden()

  await expect(statAmount(page, 'In stock')).resolves.toBe(0)
  await expect(page.getByText(/\$150\.00 written off/)).toBeVisible({ timeout: 10_000 })
})

test('the estimate never becomes the profit', async ({ page }) => {
  const boxName = await addBox(page, '150.00')
  const hit = uniqueName('Journey Hit')

  await openProduct(page, boxName)
  await page.getByRole('button', { name: 'Rip open' }).click()

  const dialog = page.locator('form')
  await dialog.getByLabel('Hit 1 name').fill(hit)
  // Valued at $50 out of a $150 box - "down $100" is a true statement of the day.
  await dialog.getByLabel('Hit 1 value').fill('50.00')
  await expect(dialog.getByText(/never becomes profit/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Log the hits' }).click()
  await expect(dialog).toBeHidden()

  await openProduct(page, hit)
  // Cost basis is the box's real price, not the guess.
  await expect(statAmount(page, 'Inventory at cost')).resolves.toBe(150)
  await expect(statAmount(page, 'Realized profit')).resolves.toBe(0)
})

test('the camera is not offered when nothing can read a photo', async ({ page }) => {
  const boxName = await addBox(page, '150.00')

  await openProduct(page, boxName)
  await page.getByRole('button', { name: 'Rip open' }).click()

  // No key is configured in the e2e environment, so the button is absent rather than
  // present and failing. The typing path below it is untouched.
  const dialog = page.locator('form')
  await expect(dialog.getByText('Photograph them instead')).toBeHidden()
  await expect(dialog.getByLabel('Hit 1 name')).toBeVisible()
})
