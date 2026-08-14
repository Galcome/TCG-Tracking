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

/**
 * Sets as an axis, and a filter that narrows the whole page.
 *
 * Joseph: "You also can't really filter by sets." Group-by offered game, product, type,
 * channel and seller — every axis except the one the group actually buys and sells in.
 */
test('sets can be compared as an axis of their own', async ({ page }) => {
  const setName = uniqueName('Axis Set')
  const name = await addProduct(page, {
    name: uniqueName('Axis Box'),
    quantity: 2,
    total: '200.00',
  })

  // Give it a set, then sell one so it has a return to report.
  await openProduct(page, name)
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click()
  const edit = page.locator('form')
  await edit.getByText('Advanced').click()
  await edit.getByPlaceholder('Start typing, or pick one below').fill(setName)
  await edit.getByRole('button', { name: 'Save changes' }).click()
  await expect(edit).toBeHidden()

  await recordSale(page, { quantity: 1, total: '400.00', platformFees: '0' })

  await page.goto('/reports')
  await page.getByRole('button', { name: 'Set', exact: true }).click()

  await expect(page.getByText(setName).first()).toBeVisible({ timeout: 10_000 })
})

test('the set filter waits for a game, then narrows the page', async ({ page }) => {
  await page.goto('/reports')

  // A flat list of every set across six games is unusable; picking the game first is the
  // step that makes the second dropdown short.
  await expect(page.getByLabel('Filter by set')).toBeDisabled()

  await page.getByLabel('Filter by game').selectOption({ label: 'Pokémon' })
  await expect(page.getByLabel('Filter by set')).toBeEnabled()

  // Clearing the game clears the set with it: a set belongs to a game, and a Lorcana set
  // left selected under Pokémon would return nothing and look broken.
  await page.getByLabel('Filter by game').selectOption({ label: 'All games' })
  await expect(page.getByLabel('Filter by set')).toBeDisabled()
})

test('a filter narrows the numbers rather than hiding rows', async ({ page }) => {
  const name = await addProduct(page, {
    name: uniqueName('Narrowed Box'),
    quantity: 1,
    total: '100.00',
  })
  await openProduct(page, name)
  await recordSale(page, { quantity: 1, total: '250.00', platformFees: '0' })

  await page.goto('/reports')

  // Filtering to a type nothing was sold under empties the report, and clearing brings it
  // back. That round trip is the proof the filter reaches the server rather than hiding
  // rows in the browser - a row hidden client-side would still be inside the totals.
  await page.getByLabel('Filter by product type').selectOption({ label: 'Binder' })
  await expect(page.getByText(/has anything to report/)).toBeVisible({ timeout: 10_000 })

  await page.getByRole('button', { name: 'Clear' }).click()
  await expect(page.getByText(/has anything to report/)).toBeHidden({ timeout: 10_000 })
})

/**
 * The investor view: how much is committed, how much came back, how exposed is one bet.
 *
 * The reports answered "what did we make?" and never answered either of those. For three
 * people's pooled money, concentration is the single most useful risk sentence the app can
 * produce — and it needed no new data, only the rows already on the page.
 */
test('capital committed, returned and still at risk are all stated', async ({ page }) => {
  const name = await addProduct(page, {
    name: uniqueName('Capital Box'),
    quantity: 4,
    total: '400.00',
  })
  await openProduct(page, name)
  await recordSale(page, { quantity: 2, total: '500.00', platformFees: '0' })

  await page.goto('/reports')
  const card = page.locator('section').filter({ hasText: 'Where the capital is' })
  await expect(card).toBeVisible({ timeout: 10_000 })

  // exact: the card's own blurb and the "% of committed" note both contain these words.
  await expect(card.getByText('Committed', { exact: true })).toBeVisible()
  await expect(card.getByText('Returned', { exact: true })).toBeVisible()
  await expect(card.getByText('Still at risk', { exact: true })).toBeVisible()

  // Returned is stated against what was committed, not in isolation: profit alone says
  // nothing about how much had to be tied up to get it.
  await expect(card.getByText(/of committed/)).toBeVisible()
})

test('concentration is measured against what is still at risk', async ({ page }) => {
  const name = await addProduct(page, {
    name: uniqueName('Concentrated Box'),
    quantity: 2,
    total: '200.00',
  })
  await openProduct(page, name)

  await page.goto('/reports')
  const card = page.locator('section').filter({ hasText: 'Where the capital is' })
  await expect(card.getByText('Concentration', { exact: true })).toBeVisible({ timeout: 10_000 })

  // Money already returned is not exposed to anything, so it is excluded on purpose and
  // the card says so rather than leaving the reader to assume.
  await expect(card.getByText(/still at risk/).first()).toBeVisible()
})
