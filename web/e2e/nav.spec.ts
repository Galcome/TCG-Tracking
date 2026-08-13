/**
 * The buckets as destinations.
 *
 * Joseph's report was "I DON'T SEE STORE!", sent from the Dashboard. Store and Vault
 * existed only as a tab strip inside one page, so from anywhere else in the app they were
 * invisible - and the previous e2e suite passed throughout, because every spec started by
 * navigating to Inventory first and therefore never asked whether you could get there.
 *
 * These tests start where a person starts.
 */
import { expect, test, type Page } from '@playwright/test'

import { addProduct, openProduct, rx, uniqueName } from './helpers'

/** The sidebar link for a place. A link, not the page's tab strip button. */
function navLink(page: Page, label: string) {
  return page.getByRole('link', { name: label, exact: true })
}

test('the places are in the navigation, reachable from the Dashboard', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  for (const label of ['All stock', 'Inventory', 'Store', 'Vault']) {
    await expect(navLink(page, label)).toBeVisible()
  }

  await navLink(page, 'Store').click()
  await expect(page).toHaveURL(/\?bucket=store$/)
  await expect(page.getByRole('heading', { name: 'Store' })).toBeVisible()
})

test('the heading names the place, and only that place is highlighted', async ({ page }) => {
  await page.goto('/inventory?bucket=vault')

  await expect(page.getByRole('heading', { name: 'Vault' })).toBeVisible()

  // NavLink's own isActive ignores the query string, so without a manual check all four
  // stock destinations light up at once and the nav stops telling you anything.
  await expect(navLink(page, 'Vault')).toHaveClass(/color-accent/)
  await expect(navLink(page, 'Store')).not.toHaveClass(/color-accent/)
  await expect(navLink(page, 'Inventory')).not.toHaveClass(/color-accent/)
  await expect(navLink(page, 'All stock')).not.toHaveClass(/color-accent/)
})

test('a place survives a reload and Back returns to the last one', async ({ page }) => {
  await page.goto('/')
  await navLink(page, 'Store').click()
  await expect(page.getByRole('heading', { name: 'Store' })).toBeVisible()

  // The URL is the state, so the link is shareable and a refresh does not lose the place.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Store' })).toBeVisible()

  await navLink(page, 'Vault').click()
  await expect(page.getByRole('heading', { name: 'Vault' })).toBeVisible()

  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Store' })).toBeVisible()
})

test('the tab strip and the sidebar cannot disagree about where you are', async ({ page }) => {
  await page.goto('/inventory')
  await expect(page.getByRole('heading', { name: 'All stock' })).toBeVisible()

  // Pressing the tab has to move the same URL the sidebar reads, or the two controls
  // drift apart and one of them starts lying.
  await page.getByRole('button', { name: /^Vault/ }).click()
  await expect(page).toHaveURL(/\?bucket=vault$/)
  await expect(navLink(page, 'Vault')).toHaveClass(/color-accent/)
  await expect(page.getByRole('heading', { name: 'Vault' })).toBeVisible()
})

test('a hand-edited bucket falls back to everything rather than erroring', async ({ page }) => {
  await page.goto('/inventory?bucket=basement')

  // The API rejects an unknown bucket with a 422. A mistyped link must not become an
  // error screen.
  await expect(page.getByRole('heading', { name: 'All stock' })).toBeVisible()
  await expect(page.getByText(/Unprocessable|422/)).toBeHidden()
})

test('move stock to the Store, then find it under Store', async ({ page }) => {
  const name = await addProduct(page, { quantity: 2, total: '400.00' })
  await openProduct(page, name)

  await page.getByRole('button', { name: 'Move', exact: true }).first().click()
  const dialog = page.locator('form')
  await dialog.getByLabel('Move to').selectOption('store')
  await dialog.getByLabel('How many').fill('2')
  await dialog.getByRole('button', { name: 'Move', exact: true }).click()
  await expect(dialog).toBeHidden()

  // The whole point of the change: go to the Store from anywhere and the box is there.
  await navLink(page, 'Store').click()
  await page.getByPlaceholder('Search products…').fill(name)
  await expect(page.getByRole('row', { name: rx(name) })).toBeVisible({ timeout: 10_000 })

  // And it is no longer in Inventory, which is what "moved" has to mean.
  await navLink(page, 'Inventory').click()
  await page.getByPlaceholder('Search products…').fill(name)
  await expect(page.getByRole('row', { name: rx(name) })).toBeHidden({ timeout: 10_000 })
})

test('an empty place says it is empty, not that you own nothing', async ({ page }) => {
  await page.goto('/inventory?bucket=store')
  await page.getByPlaceholder('Search products…').fill(uniqueName('no-such'))

  // "No products yet. Add your first one" on a store holding forty boxes reads as a bug.
  await expect(page.locator('body')).not.toContainText('No products yet', { timeout: 10_000 })
})

test.describe('on the narrowest phone', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('every tab item fits without wrapping or overflowing', async ({ page }) => {
    await page.goto('/')

    const bar = page.locator('nav').last()
    await expect(bar.getByRole('link')).toHaveCount(7)

    // The bar itself must not scroll sideways...
    const barOverflows = await bar.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
    expect(barOverflows).toBe(false)

    // ...and no label may spill out of its own sixth of the width onto its neighbour.
    // Labels are nowrap, so overflow is silent - it just overlaps.
    const spills = await bar.evaluate((el) =>
      Array.from(el.children)
        .filter((child) => child.scrollWidth > child.clientWidth + 1)
        .map((child) => child.textContent),
    )
    expect(spills).toEqual([])
  })

  test('Store is reachable on a phone', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav').last().getByRole('link', { name: 'Store' }).click()

    await expect(page.getByRole('heading', { name: 'Store' })).toBeVisible()
  })
})

/**
 * The second report of the same shape: "how do I open or split a box?"
 *
 * Crack open, Rip open and Send to grading all shipped, all worked, and all lived on a
 * product's own page - whose only entrance from the list was a button labelled "History".
 * Nobody looking for "open this box" clicks History, so the features were unreachable in
 * practice while every backend test passed.
 *
 * This asserts the *route*, not the dialogs: that a person standing on Inventory can get
 * to the actions by clicking the thing they would actually click.
 */
test('a box can be opened from the inventory list without knowing where to look', async ({
  page,
}) => {
  const box = await addProduct(page, { name: uniqueName('Reachable Box'), quantity: 6, total: '900.00' })

  await page.getByPlaceholder('Search products…').fill(box)
  const row = page.getByRole('row', { name: rx(box) })
  await expect(row).toBeVisible({ timeout: 10_000 })

  // The name is the door. It has to be a link, not just text on a row that edits.
  await row.getByRole('link', { name: box }).click()

  await expect(page.getByRole('heading', { name: box })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'Crack open' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Rip open' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send to grading' })).toBeVisible()
})
