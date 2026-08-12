/**
 * The money ledger, through the real app.
 *
 * The journeys here are the ones the group described and the spreadsheet already does:
 * Jason fronts $5,000 and is owed $5,000, draws $3,000 back and is owed $2,000, sells a box
 * and keeps the cash. None of that was expressible before - the app knew who *did* a
 * transaction, never whose money paid for it.
 *
 * Balances are store-wide, so every assertion here measures the *change* it caused rather
 * than a value, because the suite shares one database with every other spec.
 */
import { expect, test, type Page } from '@playwright/test'

import { amount, gotoInventory, openProduct, recordSale, uniqueName } from './helpers'

/** The balance on one account card, as a number. */
async function balance(page: Page, account: string): Promise<number> {
  const card = page.getByRole('listitem').filter({ hasText: account })
  await expect(card.first()).toBeVisible({ timeout: 10_000 })
  return amount(await card.first().locator('p.font-display').innerText())
}

/**
 * Straight to the page. That the nav link gets you there is asserted once, on its own,
 * rather than relied on by every other test - a broken link should fail one test with a
 * clear name, not nine with a timeout.
 */
async function gotoMoney(page: Page) {
  await page.goto('/money')
  await expect(page.getByRole('heading', { name: 'Money' })).toBeVisible({ timeout: 10_000 })
}

/**
 * The signed-in member's account is named after them, and e2e/firebase-stub.ts always
 * signs in as the same person.
 */
const ME = 'E2E Tester'

async function myAccountName(page: Page): Promise<string> {
  await gotoMoney(page)
  await expect(page.getByRole('listitem').filter({ hasText: ME }).first()).toBeVisible({
    timeout: 10_000,
  })
  return ME
}

/** Add a product with an opening purchase, leaving funding on its default. */
async function buy(page: Page, total: string): Promise<string> {
  const name = uniqueName('Money Box')
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

test('the Money page is reachable from the Dashboard', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Money', exact: true }).first()).toBeVisible()

  await gotoMoney(page)
  await expect(page.getByText('IN THE JOINT ACCOUNT')).toBeVisible()
})

test('cash held and money owed are shown as two figures, never one', async ({ page }) => {
  await gotoMoney(page)

  // A single netted number would hide whichever of the two is the problem, and it is the
  // same trap as folding the Dashboard's money in/out into this.
  await expect(page.getByText('IN THE JOINT ACCOUNT')).toBeVisible()
  await expect(page.getByText('OWED TO PARTNERS')).toBeVisible()
  await expect(page.getByText(/says where the cash sits/)).toBeVisible()
})

test('paying for stock yourself means the group owes you for it', async ({ page }) => {
  const mine = await myAccountName(page)
  const before = await balance(page, mine)

  await buy(page, '5000.00')

  await gotoMoney(page)
  expect(await balance(page, mine)).toBeCloseTo(before + 5000, 2)
})

test('drawing from the joint account settles part of what you are owed', async ({ page }) => {
  const mine = await myAccountName(page)
  await buy(page, '5000.00')

  await gotoMoney(page)
  const owedBefore = await balance(page, mine)
  const jointBefore = await balance(page, 'Joint account')

  await page.getByRole('button', { name: 'Move money' }).first().click()
  const dialog = page.locator('form')
  await dialog.getByLabel('Out of').selectOption({ label: 'Joint account' })
  await dialog.getByLabel('Into').selectOption({ label: mine })
  await dialog.getByLabel('How much').fill('3000.00')

  // Both balances fall, which surprises people, so the form says so before the button.
  await expect(dialog.getByText(/Pays .* back/)).toBeVisible()

  await dialog.getByRole('button', { name: 'Move it' }).click()
  await expect(dialog).toBeHidden()

  expect(await balance(page, mine)).toBeCloseTo(owedBefore - 3000, 2)
  expect(await balance(page, 'Joint account')).toBeCloseTo(jointBefore - 3000, 2)
})

test('keeping the cash from a sale lowers what you are owed', async ({ page }) => {
  const mine = await myAccountName(page)
  const name = await buy(page, '200.00')

  await gotoMoney(page)
  const before = await balance(page, mine)

  await openProduct(page, name)
  await recordSale(page, { quantity: 1, total: '300.00' })

  // The eBay payout lands in the seller's own account, so they are now holding $300 of
  // the group's money and are owed that much less.
  await gotoMoney(page)
  expect(await balance(page, mine)).toBeCloseTo(before - 300, 2)
})

test('an opening balance carries the spreadsheet over', async ({ page }) => {
  const mine = await myAccountName(page)
  const before = await balance(page, mine)

  const card = page.getByRole('listitem').filter({ hasText: mine }).first()
  await card.getByRole('button', { name: 'Adjust' }).click()

  const dialog = page.locator('form')
  // Labelled in the account's own terms - nobody should have to reason about which way
  // cash notionally travelled to produce the balance they want.
  await expect(dialog.getByRole('button', { name: 'Owed more' })).toBeVisible()
  await dialog.getByLabel('How much').fill('5000.00')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  expect(await balance(page, mine)).toBeCloseTo(before + 5000, 2)
})

test('the ledger says what each movement was for', async ({ page }) => {
  const name = await buy(page, '900.00')

  await gotoMoney(page)
  const row = page.getByRole('row').filter({ hasText: name })
  await expect(row).toBeVisible({ timeout: 10_000 })
  await expect(row).toContainText('Bought stock')
  await expect(row).toContainText('$900.00')
})

test('money that came from a purchase cannot be voided on its own', async ({ page }) => {
  const name = await buy(page, '250.00')

  await gotoMoney(page)
  const row = page.getByRole('row').filter({ hasText: name })
  await expect(row).toBeVisible({ timeout: 10_000 })

  // Correcting the purchase is the honest fix, and its money record follows. Offering a
  // Void here would let the two ledgers drift apart.
  await expect(row.getByRole('button', { name: 'Void' })).toBeHidden()
})

test('voiding a transfer puts both balances back', async ({ page }) => {
  const mine = await myAccountName(page)
  const before = await balance(page, mine)

  await page.getByRole('button', { name: 'Move money' }).first().click()
  const dialog = page.locator('form')
  await dialog.getByLabel('Out of').selectOption({ label: mine })
  await dialog.getByLabel('Into').selectOption({ label: 'Joint account' })
  await dialog.getByLabel('How much').fill('750.00')
  await dialog.getByRole('button', { name: 'Move it' }).click()
  await expect(dialog).toBeHidden()

  expect(await balance(page, mine)).toBeCloseTo(before + 750, 2)

  const row = page.getByRole('row').filter({ hasText: 'Transfer' }).first()
  await row.getByRole('button', { name: 'Void' }).click()
  const voidDialog = page.locator('form')
  await voidDialog.getByLabel('Reason').fill('wrong way round')
  await voidDialog.getByRole('button', { name: 'Void it' }).click()
  await expect(voidDialog).toBeHidden()

  expect(await balance(page, mine)).toBeCloseTo(before, 2)
})

test('correcting what a purchase cost moves the money with it', async ({ page }) => {
  const mine = await myAccountName(page)
  const before = await balance(page, mine)
  const name = await buy(page, '200.00')

  await openProduct(page, name)
  await page.getByRole('row', { name: /Purchase/ }).getByRole('button', { name: 'Edit' }).click()
  const dialog = page.locator('form')
  await dialog.getByLabel('Total paid').fill('300.00')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  // The bug this guards: a funding record left claiming the old number.
  await gotoMoney(page)
  expect(await balance(page, mine)).toBeCloseTo(before + 300, 2)
})

test('a purchase can be paid for out of the joint account instead', async ({ page }) => {
  await gotoMoney(page)
  const jointBefore = await balance(page, 'Joint account')

  await gotoInventory(page)
  await page.getByRole('button', { name: 'Add product' }).first().click()

  const dialog = page.locator('form')
  await dialog.getByLabel('Name').fill(uniqueName('Joint Box'))
  await dialog.getByLabel('Quantity').fill('1')
  await dialog.getByLabel('Total paid').fill('400.00')
  await dialog.getByRole('button', { name: 'Joint account', exact: true }).click()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  await gotoMoney(page)
  expect(await balance(page, 'Joint account')).toBeCloseTo(jointBefore - 400, 2)
})
