/**
 * Cracking a case open, through the real app.
 *
 * Two things are worth driving a browser for. The cost has to move rather than double or
 * evaporate - a $900 case becomes $900 of boxes and the group has still only spent $900.
 * And the boxes have to keep the case's purchase date, because cracking a case on its
 * first birthday must not produce six brand-new boxes.
 */
import { expect, test, type Page } from '@playwright/test'

import {
  addProduct,
  amount,
  gotoInventory,
  openProduct,
  statAmount,
  uniqueName,
} from './helpers'

/**
 * Create an actual **case** with an opening purchase and return its name.
 *
 * The type used to be left at the dialog's default, which is `Single` — so this file
 * spent its whole life cracking a *card* open and asserting the arithmetic came out
 * right. It did, because nothing refused. Now that a card cannot be cracked, the helper
 * has to create the thing it is named after.
 */
async function addCase(page: Page, total: string): Promise<string> {
  const name = uniqueName('Crack Case')
  await gotoInventory(page)
  await page.getByRole('button', { name: 'Add product' }).first().click()

  const dialog = page.getByRole('dialog').locator('form')
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('Product type').selectOption({ label: 'Sealed Case' })
  await dialog.getByLabel('Quantity').fill('1')
  await dialog.getByLabel('Total paid').fill(total)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toBeHidden()

  return name
}

test('a case becomes its boxes, and the cost goes with them', async ({ page }) => {
  const caseName = await addCase(page, '900.00')
  const boxName = uniqueName('Crack Box')

  await openProduct(page, caseName)
  await page.getByRole('button', { name: 'Crack open' }).click()

  const dialog = page.getByRole('dialog').locator('form')
  await dialog.getByLabel('Boxes per case').fill('6')
  await dialog.getByLabel('Name').fill(boxName)

  // Said before the button, not discovered in a report afterwards.
  await expect(dialog.getByText(/keep the case.s purchase date/)).toBeVisible()

  await dialog.getByRole('button', { name: 'Crack it open' }).click()
  await expect(dialog).toBeHidden()

  // You land on the boxes, because that is where the money now is.
  await expect(page.getByRole('heading', { name: boxName })).toBeVisible({ timeout: 10_000 })
  await expect(statAmount(page, 'In stock')).resolves.toBe(6)
  await expect(statAmount(page, 'Inventory at cost')).resolves.toBe(900)

  // And the case is gone, with its money moved rather than lost. Back rather than a
  // search: an emptied case has zero stock, so the default In-stock list hides it.
  await page.goBack()
  await expect(page.getByRole('heading', { name: caseName })).toBeVisible({ timeout: 10_000 })
  await expect(statAmount(page, 'In stock')).resolves.toBe(0)
  await expect(statAmount(page, 'Inventory at cost')).resolves.toBe(0)
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

  const dialog = page.getByRole('dialog').locator('form')
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

  const dialog = page.getByRole('dialog').locator('form')
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

  const dialog = page.getByRole('dialog').locator('form')
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

  const dialog = page.getByRole('dialog').locator('form')
  await dialog.getByLabel('Boxes per case').fill('6')
  await dialog.getByLabel('Name').fill(boxName)
  await dialog.getByRole('button', { name: 'Crack it open' }).click()
  await expect(dialog).toBeHidden()

  // The chain, on the case's own page - the crack now lands on the boxes, so come back.
  await page.goBack()
  await expect(page.getByRole('heading', { name: caseName })).toBeVisible({ timeout: 10_000 })

  // Scoped to the row that can be undone: the all-in lineage summary above it lists the
  // same box and has no Undo of its own.
  const row = page
    .getByRole('listitem')
    .filter({ hasText: boxName })
    .filter({ has: page.getByRole('button', { name: 'Undo' }) })
  await expect(row).toBeVisible({ timeout: 10_000 })

  await row.getByRole('button', { name: 'Undo' }).click()
  const undo = page.getByRole('dialog').locator('form')
  await undo.getByLabel('Reason').fill('wrong case')
  await undo.getByRole('button', { name: 'Undo it' }).click()
  await expect(undo).toBeHidden()

  // The case is back.
  await expect(statAmount(page, 'In stock')).resolves.toBe(1)
})

/**
 * Joseph, opening a booster box: "What the fuck is this?"
 *
 * The dialog asked "How many cases", offered "Boxes per case: 6", and promised the boxes
 * would keep the case's purchase date — while actually turning his box into packs. The
 * type had been made dynamic; every word around it was still hardcoded to the case story.
 *
 * The number was wrong too: 6 is boxes-in-a-case. A Pokémon box holds 36 packs, so the
 * suggestion was six times too small on the screen whose entire job is splitting cost.
 */
test('opening a box talks about packs, not cases', async ({ page }) => {
  const box = await addProduct(page, {
    name: uniqueName('Wordy Box'),
    quantity: 1,
    total: '500.00',
    type: 'Booster Box',
  })
  await openProduct(page, box)
  await page.getByRole('button', { name: 'Crack open' }).click()

  const dialog = page.getByRole('dialog').locator('form')
  await expect(dialog.getByText('How many boxes')).toBeVisible()
  await expect(dialog.getByText('Packs per box')).toBeVisible()
  await expect(dialog.getByText(/packs keep the box.s purchase date/)).toBeVisible()

  // 36 packs in a Pokémon box, not the 6 boxes that live in a case.
  await expect(dialog.getByLabel('Packs per box')).toHaveValue('36')
  await expect(dialog.getByText(/How many cases/)).toBeHidden()
})

test('opening a case still talks about cases and boxes', async ({ page }) => {
  const kase = await addCase(page, '900.00')
  await openProduct(page, kase)
  await page.getByRole('button', { name: 'Crack open' }).click()

  const dialog = page.getByRole('dialog').locator('form')
  await expect(dialog.getByText('How many cases')).toBeVisible()
  await expect(dialog.getByLabel('Boxes per case')).toHaveValue('6')
})

/**
 * Language changes both suggestions, and until it could be set it never changed anything.
 *
 * `language` was on the model, accepted by the API and read by both size lookups — but no
 * screen ever set it, so it was always null and both tables' Japanese rows were dead. A
 * Japanese case quietly suggested six boxes, which is the English answer and looks
 * perfectly reasonable.
 */
test('a Japanese box suggests Japanese sizes', async ({ page }) => {
  await gotoInventory(page)
  await page.getByRole('button', { name: 'Add product' }).first().click()

  const add = page.getByRole('dialog').locator('form')
  const name = uniqueName('JP Box')
  await add.getByLabel('Name').fill(name)
  await add.getByLabel('Product type').selectOption({ label: 'Booster Box' })
  await add.getByLabel('Language').selectOption({ label: 'Japanese' })
  await add.getByLabel('Quantity').fill('1')
  await add.getByLabel('Total paid').fill('400.00')
  await add.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(add).toBeHidden()

  await openProduct(page, name)
  await page.getByRole('button', { name: 'Crack open' }).click()

  // 30 packs in a Japanese box, against 36 in an English one.
  await expect(page.getByRole('dialog').locator('form').getByLabel('Packs per box')).toHaveValue('30')
})

test('a Japanese case suggests twenty boxes, not six', async ({ page }) => {
  await gotoInventory(page)
  await page.getByRole('button', { name: 'Add product' }).first().click()

  const add = page.getByRole('dialog').locator('form')
  const name = uniqueName('JP Case')
  await add.getByLabel('Name').fill(name)
  await add.getByLabel('Product type').selectOption({ label: 'Sealed Case' })
  await add.getByLabel('Language').selectOption({ label: 'Japanese' })
  await add.getByLabel('Quantity').fill('1')
  await add.getByLabel('Total paid').fill('4000.00')
  await add.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(add).toBeHidden()

  await openProduct(page, name)
  await page.getByRole('button', { name: 'Crack open' }).click()

  await expect(page.getByRole('dialog').locator('form').getByLabel('Boxes per case')).toHaveValue('20')
})

/**
 * Joseph, after cracking a box into packs: "why am I still at Booster box? it makes me
 * think I haven't actually opened it."
 *
 * The dialog closed, the data refreshed silently, and every bit of evidence that anything
 * happened sat below the fold. Worse, the source is now at zero, so you were left looking
 * at a page for something you no longer have.
 */
test('cracking lands you on what you just made', async ({ page }) => {
  const kase = await addCase(page, '900.00')
  const boxName = uniqueName('Landed Box')

  await openProduct(page, kase)
  await page.getByRole('button', { name: 'Crack open' }).click()

  const dialog = page.getByRole('dialog').locator('form')
  await dialog.getByLabel('Boxes per case').fill('6')
  await dialog.getByLabel('Name').fill(boxName)
  await dialog.getByRole('button', { name: 'Crack it open' }).click()
  await expect(dialog).toBeHidden()

  // The boxes, not the case that no longer exists.
  await expect(page.getByRole('heading', { name: boxName })).toBeVisible({ timeout: 10_000 })
  await expect(statAmount(page, 'In stock')).resolves.toBe(6)
})
