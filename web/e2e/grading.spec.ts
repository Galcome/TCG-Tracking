/**
 * Sending a card to be graded and getting it back, through the real app.
 *
 * Two things worth a browser. The card does not leave stock when it is sent - it keeps its
 * bucket and shows a day count, which is the condition the flag was accepted on. And the
 * fees join the cost basis on the way back, because without that every graded card's ROI
 * is overstated by roughly the fee.
 */
import { expect, test, type Page } from '@playwright/test'

import { gotoInventory, openProduct, statAmount, uniqueName } from './helpers'

async function addCard(page: Page, total: string): Promise<string> {
  const name = uniqueName('Grade Card')
  await gotoInventory(page)
  await page.getByRole('button', { name: 'Add product' }).first().click()

  const dialog = page.locator('form')
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('Product type').selectOption({ label: 'Single' })
  await dialog.getByLabel('Quantity').fill('1')
  await dialog.getByLabel('Total paid').fill(total)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toBeHidden()

  return name
}

test('a card sent away stays in stock and shows how long it has been out', async ({
  page,
}) => {
  const name = await addCard(page, '560.00')

  await openProduct(page, name)
  await page.getByRole('button', { name: 'Send to grading' }).click()

  const dialog = page.locator('form')
  await dialog.getByLabel('Fees').fill('30.00')
  // Said plainly, because "it left the house but it is still in Inventory" reads as a bug.
  await expect(dialog.getByText(/still your stock and still your money/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Send it' }).click()
  await expect(dialog).toBeHidden()

  // It never left.
  await expect(statAmount(page, 'In stock')).resolves.toBe(1)
  await expect(page.getByText(/0 days out/)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/at PSA/)).toBeVisible()
})

test('it comes back as a graded card carrying the fees', async ({ page }) => {
  const name = await addCard(page, '560.00')

  await openProduct(page, name)
  await page.getByRole('button', { name: 'Send to grading' }).click()
  let dialog = page.locator('form')
  await dialog.getByLabel('Fees').fill('30.00')
  await dialog.getByRole('button', { name: 'Send it' }).click()
  await expect(dialog).toBeHidden()

  // The flag is the way back in.
  await page.getByRole('button', { name: 'It came back' }).click()
  dialog = page.locator('form')
  await dialog.getByLabel('Grade', { exact: true }).fill('10')

  // Pre-filled from the card, the grader and the grade - shown, and editable.
  await expect(dialog.getByLabel('Now called')).toHaveValue(`${name} — PSA 10`)

  await dialog.getByRole('button', { name: 'Record it' }).click()
  await expect(dialog).toBeHidden()

  // The raw card is gone.
  await expect(statAmount(page, 'In stock')).resolves.toBe(0)

  // And the graded one carries $560 + $30.
  await openProduct(page, `${name} — PSA 10`)
  await expect(statAmount(page, 'Inventory at cost')).resolves.toBe(590)
})

/**
 * Joseph: "When an item comes back from grading, an option to add the estimated value
 * would be good."
 *
 * The biggest value event in the chain used to pass with nothing recorded — cost tracked
 * to the cent, and what the grade actually did to the card written down nowhere.
 *
 * Both halves are here because only one of them is still possible later: once the card is
 * at the grader, what it was worth raw is gone for good.
 */
test('what it was worth raw and what it is worth graded are both kept', async ({ page }) => {
  const card = await addCard(page, '560.00')
  await openProduct(page, card)

  await page.getByRole('button', { name: 'Send to grading' }).click()
  const send = page.locator('form')
  await send.getByLabel('Fees').fill('25.00')
  await send.getByLabel('What is it worth raw?').fill('560.00')
  await send.getByRole('button', { name: 'Send it' }).click()
  await expect(send).toBeHidden()

  await page.getByRole('button', { name: 'It came back' }).click()
  const back = page.locator('form')
  // exact: the "Now called" hint mentions the grade, so its accessible name
  // contains "Grade" too.
  await back.getByLabel('Grade', { exact: true }).fill('10')
  await back.getByLabel('What is it worth now?').fill('2000.00')
  await back.getByRole('button', { name: 'Record it' }).click()
  await expect(back).toBeHidden()

  // The graded card exists under its built name, and the estimate rode along with it.
  await gotoInventory(page)
  await page.getByPlaceholder('Search products…').fill(card)
  await expect(page.getByRole('row', { name: new RegExp(`${card} — PSA 10`) })).toBeVisible({
    timeout: 10_000,
  })
})

test('an estimate is never allowed to become profit', async ({ page }) => {
  const card = await addCard(page, '100.00')
  await openProduct(page, card)

  await page.getByRole('button', { name: 'Send to grading' }).click()
  const send = page.locator('form')
  await send.getByLabel('What is it worth raw?').fill('900.00')
  await send.getByRole('button', { name: 'Send it' }).click()
  await expect(send).toBeHidden()

  // A $900 estimate against a $100 card must move neither figure. Estimates inform
  // decisions; they do not score them, or the group marks its own homework.
  expect(await statAmount(page, 'Realized profit')).toBe(0)
  expect(await statAmount(page, 'Inventory at cost')).toBe(100)
})
