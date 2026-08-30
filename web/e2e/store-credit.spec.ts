/**
 * Selling for store credit, through the real app.
 *
 * The distinction the whole feature exists to hold: sell a $200 box to a shop for $500 of
 * credit and you have made $300 of realized profit and zero dollars. Both are true, and an
 * app that adds them together stops being worth trusting.
 *
 * Balances are store-wide, so every assertion measures the change it caused.
 */
import { expect, test, type Page } from '@playwright/test'

import { amount, gotoInventory, openProduct, uniqueName } from './helpers'

async function gotoMoney(page: Page) {
  await page.goto('/money')
  await expect(page.getByRole('heading', { name: 'Money' })).toBeVisible({ timeout: 10_000 })
}

/** A named figure from the three-across summary at the top of the Money page. */
async function summary(page: Page, label: string): Promise<number> {
  const block = page.getByText(label, { exact: true }).locator('xpath=..')
  return amount(await block.locator('p').nth(1).innerText())
}

async function balance(page: Page, account: string): Promise<number> {
  const card = page.getByRole('listitem').filter({ hasText: account }).first()
  await expect(card).toBeVisible({ timeout: 10_000 })
  return amount(await card.locator('p.font-display').innerText())
}

/** Buy a box with no money recorded, so only the sale moves anything. */
async function buyUnfunded(page: Page, total: string): Promise<string> {
  const name = uniqueName('Credit Box')
  await gotoInventory(page)
  await page.getByRole('button', { name: 'Add product' }).first().click()

  const dialog = page.getByRole('dialog').locator('form')
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('Quantity').fill('1')
  await dialog.getByLabel('Total paid').fill(total)
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  return name
}

/** Record a sale, sending the money to a named shop as credit. */
async function sellForCredit(page: Page, options: { total: string; shop: string }) {
  await page.getByRole('button', { name: 'Record sale' }).first().click()
  const dialog = page.getByRole('dialog').locator('form')

  await dialog.getByLabel('Total received').fill(options.total)
  await dialog.getByRole('button', { name: 'Store credit…' }).click()
  await dialog.getByPlaceholder('Which shop?').fill(options.shop)

  // Said before the button, not discovered afterwards.
  await expect(dialog.getByText(/never as cash/)).toBeVisible()

  await dialog.getByRole('button', { name: 'Record sale' }).click()
  await expect(dialog).toBeHidden()
}

test('a sale for credit is profit, and it is not cash', async ({ page }) => {
  const shop = uniqueName('Shop')
  const name = await buyUnfunded(page, '200.00')

  await gotoMoney(page)
  const creditBefore = await summary(page, 'IN STORE CREDIT')

  await openProduct(page, name)
  await sellForCredit(page, { total: '500.00', shop })

  // $300 of realized profit...
  await expect(page.getByText('+$300.00').first()).toBeVisible({ timeout: 10_000 })

  // ...and $500 of credit, on its own line, in neither of the cash figures.
  await gotoMoney(page)
  expect(await summary(page, 'IN STORE CREDIT')).toBeCloseTo(creditBefore + 500, 2)
  expect(await balance(page, shop)).toBeCloseTo(500, 2)
})

test('the shop appears as a pot you can spend from', async ({ page }) => {
  const shop = uniqueName('Spendable')
  const name = await buyUnfunded(page, '100.00')

  await openProduct(page, name)
  await sellForCredit(page, { total: '400.00', shop })

  await gotoMoney(page)
  expect(await balance(page, shop)).toBeCloseTo(400, 2)

  // Buying with that credit spends it down - no separate mechanism, it is just an account.
  await gotoInventory(page)
  await page.getByRole('button', { name: 'Add product' }).first().click()
  const dialog = page.getByRole('dialog').locator('form')
  await dialog.getByLabel('Name').fill(uniqueName('Bought With Credit'))
  await dialog.getByLabel('Quantity').fill('1')
  await dialog.getByLabel('Total paid').fill('150.00')
  await dialog.getByRole('button', { name: shop, exact: true }).click()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  await gotoMoney(page)
  expect(await balance(page, shop)).toBeCloseTo(250, 2)
})

test('the shop is offered as a chip the next time', async ({ page }) => {
  const shop = uniqueName('Repeat')
  const first = await buyUnfunded(page, '100.00')
  await openProduct(page, first)
  await sellForCredit(page, { total: '200.00', shop })

  const second = await buyUnfunded(page, '100.00')
  await openProduct(page, second)
  await page.getByRole('button', { name: 'Record sale' }).first().click()

  // Typed once. Shops behave like marketplaces, not like a list somebody maintains.
  await expect(
    page.getByRole('dialog').locator('form').getByRole('button', { name: shop, exact: true }),
  ).toBeVisible()
})

test('the shop name doubles as where it sold', async ({ page }) => {
  const shop = uniqueName('Channel')
  const name = await buyUnfunded(page, '100.00')

  await openProduct(page, name)
  await sellForCredit(page, { total: '250.00', shop })

  // Selling for credit means selling *to* that shop, so the name is typed once.
  await page.goto('/sales')
  await page.getByPlaceholder('Search by product…').fill(name)
  await expect(page.getByRole('row', { name: new RegExp(shop) })).toBeVisible({
    timeout: 10_000,
  })
})

test('the Dashboard keeps credit out of money in', async ({ page }) => {
  const shop = uniqueName('NotCash')
  const name = await buyUnfunded(page, '100.00')

  await page.goto('/')
  const before = amount(
    await page.getByText('Money in', { exact: true }).locator('xpath=..').locator('p').nth(1).innerText(),
  )

  await openProduct(page, name)
  await sellForCredit(page, { total: '600.00', shop })

  await page.goto('/')
  const after = amount(
    await page.getByText('Money in', { exact: true }).locator('xpath=..').locator('p').nth(1).innerText(),
  )

  // Money in is cash. The credit is named separately in the hint beneath it.
  expect(after).toBeCloseTo(before, 2)
  await expect(page.getByText(/came in as store credit/)).toBeVisible()
})

test('typing the name of a shop that already exists keeps the field open', async ({ page }) => {
  const shop = uniqueName('Existing')
  const first = await buyUnfunded(page, '100.00')
  await openProduct(page, first)
  await sellForCredit(page, { total: '200.00', shop })

  const second = await buyUnfunded(page, '100.00')
  await openProduct(page, second)
  await page.getByRole('button', { name: 'Record sale' }).first().click()

  const dialog = page.getByRole('dialog').locator('form')
  await dialog.getByLabel('Total received').fill('300.00')
  await dialog.getByRole('button', { name: 'Store credit…' }).click()

  // Deriving "am I typing?" from whether the name matched a shop made the input vanish
  // on the last keystroke - exactly when you were most sure you had got it right.
  const field = dialog.getByPlaceholder('Which shop?')
  await field.fill(shop)
  await expect(field).toHaveValue(shop)

  await dialog.getByRole('button', { name: 'Record sale' }).click()
  await expect(dialog).toBeHidden()

  // And it went into the same pot rather than making a second one.
  await gotoMoney(page)
  expect(await balance(page, shop)).toBeCloseTo(500, 2)
})
