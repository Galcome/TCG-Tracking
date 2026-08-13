/**
 * Cracking a case open, through the real app.
 *
 * Two things are worth driving a browser for. The cost has to move rather than double or
 * evaporate - a $900 case becomes $900 of boxes and the group has still only spent $900.
 * And the boxes have to keep the case's purchase date, because cracking a case on its
 * first birthday must not produce six brand-new boxes.
 */
import { expect, test, type Page } from '@playwright/test'

import { amount, gotoInventory, openProduct, statAmount, uniqueName } from './helpers'

/** Create a product with an opening purchase and return its name. */
async function addCase(page: Page, total: string): Promise<string> {
  const name = uniqueName('Crack Case')
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

test('a case becomes its boxes, and the cost goes with them', async ({ page }) => {
  const caseName = await addCase(page, '900.00')
  const boxName = uniqueName('Crack Box')

  await openProduct(page, caseName)
  await page.getByRole('button', { name: 'Crack open' }).click()

  const dialog = page.locator('form')
  await dialog.getByLabel('Boxes per case').fill('6')
  await dialog.getByLabel('Name').fill(boxName)

  // Said before the button, not discovered in a report afterwards.
  await expect(dialog.getByText(/keep the case.s purchase date/)).toBeVisible()

  await dialog.getByRole('button', { name: 'Crack it open' }).click()
  await expect(dialog).toBeHidden()

  // The case is gone and its money is not.
  await expect(statAmount(page, 'In stock')).resolves.toBe(0)
  await expect(statAmount(page, 'Inventory at cost')).resolves.toBe(0)

  await openProduct(page, boxName)
  await expect(statAmount(page, 'In stock')).resolves.toBe(6)
  await expect(statAmount(page, 'Inventory at cost')).resolves.toBe(900)
})

test('opening a case is not spending money again', async ({ page }) => {
  await page.goto('/')
  const before = amount(
    await page
      .getByText('Money out', { exact: true })
      .locator('xpath=..')
      .locator('p')
      .nth(1)
      .innerText(),
  )

  const caseName = await addCase(page, '600.00')
  await openProduct(page, caseName)
  await page.getByRole('button', { name: 'Crack open' }).click()

  const dialog = page.locator('form')
  await dialog.getByLabel('Boxes per case').fill('6')
  await dialog.getByLabel('Name').fill(uniqueName('Spend Box'))
  await dialog.getByRole('button', { name: 'Crack it open' }).click()
  await expect(dialog).toBeHidden()

  await page.goto('/')
  const after = amount(
    await page
      .getByText('Money out', { exact: true })
      .locator('xpath=..')
      .locator('p')
      .nth(1)
      .innerText(),
  )

  // $600 spent, not $1,200. The boxes carry cost across; they are not a second purchase.
  expect(after).toBeCloseTo(before + 600, 2)
})

test('the boxes can be split across buckets as they come out', async ({ page }) => {
  const caseName = await addCase(page, '900.00')
  const boxName = uniqueName('Split Box')

  await openProduct(page, caseName)
  await page.getByRole('button', { name: 'Crack open' }).click()

  const dialog = page.locator('form')
  await dialog.getByLabel('Boxes per case').fill('6')
  await dialog.getByLabel('Name').fill(boxName)
  await dialog.getByLabel('Store', { exact: true }).fill('4')
  await dialog.getByLabel('Inventory', { exact: true }).fill('1')
  await dialog.getByLabel('Vault', { exact: true }).fill('1')
  await dialog.getByRole('button', { name: 'Crack it open' }).click()
  await expect(dialog).toBeHidden()

  await openProduct(page, boxName)
  await expect(page.getByText('1 inventory · 4 store · 1 vault')).toBeVisible({
    timeout: 10_000,
  })
})

test('a split that does not add up is refused before anything is written', async ({ page }) => {
  const caseName = await addCase(page, '900.00')

  await openProduct(page, caseName)
  await page.getByRole('button', { name: 'Crack open' }).click()

  const dialog = page.locator('form')
  await dialog.getByLabel('Boxes per case').fill('6')
  await dialog.getByLabel('Name').fill(uniqueName('Bad Split Box'))
  await dialog.getByLabel('Store', { exact: true }).fill('2')
  await dialog.getByRole('button', { name: 'Crack it open' }).click()

  await expect(dialog.getByText(/adds up to 2, but 6 boxes came out/)).toBeVisible()
  await expect(dialog).toBeVisible()
})

test('what came out of what is on the page, and can be undone', async ({ page }) => {
  const caseName = await addCase(page, '300.00')
  const boxName = uniqueName('Lineage Box')

  await openProduct(page, caseName)
  await page.getByRole('button', { name: 'Crack open' }).click()

  const dialog = page.locator('form')
  await dialog.getByLabel('Boxes per case').fill('6')
  await dialog.getByLabel('Name').fill(boxName)
  await dialog.getByRole('button', { name: 'Crack it open' }).click()
  await expect(dialog).toBeHidden()

  // The chain, on the case's own page.
  const row = page.getByRole('listitem').filter({ hasText: boxName })
  await expect(row).toBeVisible({ timeout: 10_000 })

  await row.getByRole('button', { name: 'Undo' }).click()
  const undo = page.locator('form')
  await undo.getByLabel('Reason').fill('wrong case')
  await undo.getByRole('button', { name: 'Undo it' }).click()
  await expect(undo).toBeHidden()

  // The case is back.
  await expect(statAmount(page, 'In stock')).resolves.toBe(1)
})
