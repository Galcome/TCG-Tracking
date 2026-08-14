/**
 * The return chart, at the size the data actually is.
 *
 * Joseph, looking at it with two sets recorded: "This chart needs a UI overhaul. The info is
 * good but the spacing is off, you can't even read the titles of products."
 *
 * He was right, and the cause was that it was built for a dataset that does not exist yet.
 * The x-axis was floored at 30 days, so same-day sales crushed into the leftmost 3% of an
 * empty plot; the best return mapped to `top: 0`, so the winning dot drew half outside the
 * chart; and the "FAST + HIGH RETURN" caption sat in the top-left corner, which is exactly
 * where that winning dot lands.
 *
 * These assert the small-N path, because that is the one he is looking at and the one that
 * was broken.
 */
import { expect, test } from '@playwright/test'

import { addProduct, openProduct, recordSale, uniqueName } from './helpers'

/** A product with one sale, so it has both a return and a hold time to plot. */
async function soldProduct(page: import('@playwright/test').Page, total: string, price: string) {
  const name = await addProduct(page, { name: uniqueName('Chart Box'), quantity: 2, total })
  await openProduct(page, name)
  await recordSale(page, { quantity: 1, total: price, platformFees: '0' })
  return name
}

test('a small number of groups reads as labelled rows, not a crowded scatter', async ({
  page,
}) => {
  await soldProduct(page, '200.00', '400.00')

  // Grouped by game on purpose. The suite shares one database and accumulates products, so
  // grouping by product crosses the scatter threshold once enough specs have run - and then
  // this would be testing the scatter while claiming to test the small-N view.
  await page.goto('/reports')

  const chart = page.locator('section').filter({ hasText: 'Return vs. time held' })
  await expect(chart).toBeVisible({ timeout: 10_000 })

  // The label is on its own line, in full, rather than inside a 96px truncated box.
  await expect(chart.getByText('Pokémon', { exact: true })).toBeVisible()

  // And each row says what it means without needing a hover.
  await expect(chart.getByText(/sold ·/).first()).toBeVisible()
})

test('nothing is drawn outside its own chart', async ({ page }) => {
  await soldProduct(page, '100.00', '900.00')

  await page.goto('/reports')
  await page.getByRole('button', { name: 'Product', exact: true }).click()

  const chart = page.locator('section').filter({ hasText: 'Return vs. time held' })
  await expect(chart).toBeVisible({ timeout: 10_000 })

  // The old scatter put the best performer at top: 0 with a -50% transform, so half of it
  // rendered above the plot. Whatever is drawn now has to sit inside the section.
  // Measured after scrolling: boundingBox is viewport-relative, so taking it first and
  // scrolling second compares two different coordinate frames.
  await chart.scrollIntoViewIfNeeded()

  const bounds = await chart.boundingBox()
  expect(bounds).not.toBeNull()

  for (const child of await chart.locator('li, span[style*="width"]').all()) {
    const box = await child.boundingBox()
    if (!box || box.width === 0) continue
    expect(box.y).toBeGreaterThanOrEqual(bounds!.y - 1)
    expect(box.y + box.height).toBeLessThanOrEqual(bounds!.y + bounds!.height + 1)
  }
})

test('the reports page does not scroll sideways on a phone', async ({ page }) => {
  await soldProduct(page, '150.00', '300.00')
  await page.setViewportSize({ width: 375, height: 812 })

  await page.goto('/reports')
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible({ timeout: 10_000 })

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
})
