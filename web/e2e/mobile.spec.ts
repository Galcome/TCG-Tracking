/**
 * The phone.
 *
 * The rest of the suite runs at desktop width, which is why "the action exists at 1280px
 * and not at 393px" reached production: adding a product was impossible on mobile for as
 * long as the app has existed, and every check I had was blind to it.
 *
 * These assertions deliberately go through the `lg:hidden` branches - the shell's action
 * bar and Inventory's card list - which nothing else covers.
 */
import { devices, expect, test } from '@playwright/test'

import { uniqueName } from './helpers'

test.use({ ...devices['Pixel 5'] })

test('both actions are reachable from the thumb bar', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  const addProduct = page.getByRole('button', { name: 'Add product' })
  const recordSale = page.getByRole('button', { name: 'Record sale' })

  // Both, not either: the second button must not have pushed the first off the bar.
  await expect(addProduct).toBeVisible()
  await expect(recordSale).toBeVisible()

  await recordSale.click()
  await expect(page.getByRole('heading', { name: 'Record sale' })).toBeVisible()
  // Asks which product, rather than arriving with one already chosen. Passing the handler
  // straight to onClick handed React's click event in as the product, and reading
  // .game.slug off a MouseEvent took the whole app down.
  await expect(page.getByText('Which product?')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()

  await addProduct.click()
  await expect(page.getByRole('heading', { name: 'Add product' })).toBeVisible()
})

test('a product can be added on a phone and shows up in the card list', async ({ page }) => {
  const name = uniqueName('Phone Box')

  await page.goto('/')
  await page.getByRole('button', { name: 'Add product' }).click()

  const dialog = page.locator('form')
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('Quantity').fill('2')
  await dialog.getByLabel('Total paid').fill('300.00')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  await page.goto('/inventory')
  await page.getByPlaceholder('Search products…').fill(name)

  // The mobile card, not the desktop table row - that branch does not render here.
  const card = page.getByRole('listitem').filter({ hasText: name })
  await expect(card).toBeVisible({ timeout: 10_000 })
  await expect(card).toContainText('2 in stock')
  await expect(card).toContainText('$300.00')
})

test('an empty inventory offers a way out of being empty', async ({ page }) => {
  await page.goto('/inventory')
  // A search that cannot match reaches the empty state deterministically, on a database
  // the other specs have already filled.
  await page.getByPlaceholder('Search products…').fill('zzqqxx-no-such-product')

  const empty = page.getByText('Nothing matches', { exact: false })
  await expect(empty).toBeVisible({ timeout: 10_000 })

  // The button is offered however the list came up empty, not only on a virgin account.
  await page.getByRole('button', { name: 'Add product' }).last().click()
  await expect(page.getByRole('heading', { name: 'Add product' })).toBeVisible()
})

test('an empty shelf is not reported as an empty catalogue', async ({ page }) => {
  // The stock filter defaults to In stock. Selling out everything used to produce
  // "No products yet" on a store whose Sales ledger was full.
  await page.goto('/inventory')
  await page.locator('select').last().selectOption('out')

  const copy = page.locator('body')
  await expect(copy).not.toContainText('No products yet', { timeout: 10_000 })
})

// Pixel 5 is 393px. The overflow only showed at 375, so this one pins the narrower
// viewport rather than trusting the file's device.
test.describe('at 375px', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('no screen scrolls sideways', async ({ page }) => {
    // Two pixels of sideways scroll is not a crisis, but it is invisible in a
    // screenshot and impossible to unsee once you feel it. The Dashboard did it: the
    // recent-sales row needed 360px of fixed columns inside a 343px card.
    for (const path of ['/', '/inventory', '/sales', '/money', '/reports']) {
      await page.goto(path)
      await page.waitForTimeout(600)

      const sideways = await page.evaluate(
        () => document.body.scrollWidth > window.innerWidth + 1,
      )
      expect(sideways, `${path} scrolls sideways`).toBe(false)
    }
  })
})
