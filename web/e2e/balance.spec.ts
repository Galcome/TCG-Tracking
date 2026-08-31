/**
 * Money out, money in, balance.
 *
 * Deltas rather than absolutes throughout: the e2e database is shared with every other
 * spec, so the only stable claim is how much a figure moved.
 */
import { expect, test, type Page } from '@playwright/test'

import { addProduct, amount, openProduct, recordSale } from './helpers'

async function gotoDashboard(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

/**
 * The three lifetime figures, read off the Since day one block.
 *
 * Does not navigate: the period test needs to press a period button and read again on the
 * same page, while the preference test verifies that a reload keeps the selected window.
 */
async function running(page: Page) {
  const block = page.locator('section').filter({ hasText: 'Since day one' })
  await expect(block).toBeVisible({ timeout: 10_000 })

  const figure = async (label: string) =>
    amount(await block.getByText(label, { exact: true }).locator('xpath=..').locator('p').nth(1).innerText())

  return {
    out: await figure('Money out'),
    in: await figure('Money in'),
    balance: await figure('Balance'),
  }
}

test('buying moves money out and pushes the balance down', async ({ page }) => {
  await gotoDashboard(page)
  const before = await running(page)

  await addProduct(page, { quantity: 2, total: '400.00' })

  await gotoDashboard(page)
  const after = await running(page)
  expect(after.out - before.out).toBeCloseTo(400, 2)
  expect(after.in).toBeCloseTo(before.in, 2)
  expect(after.balance - before.balance).toBeCloseTo(-400, 2)
})

test('selling brings money in, net of the fees charged', async ({ page }) => {
  const name = await addProduct(page, { quantity: 1, total: '200.00' })
  await gotoDashboard(page)
  const before = await running(page)

  await openProduct(page, name)
  await recordSale(page, { quantity: 1, total: '300.00', channel: 'eBay', platformFees: '25.00' })

  await gotoDashboard(page)
  const after = await running(page)
  // 300 received less 25 in fees. Gross would be 300, which is the mistake being guarded.
  expect(after.in - before.in).toBeCloseTo(275, 2)
  expect(after.out).toBeCloseTo(before.out, 2)
  expect(after.balance - before.balance).toBeCloseTo(275, 2)
})

test('the running total ignores the period buttons', async ({ page }) => {
  await gotoDashboard(page)
  const allTime = await running(page)

  await page.getByRole('button', { name: '30 days' }).click()
  // The period-scoped figures below re-fetch; these must not.
  const thirtyDays = await running(page)

  expect(thirtyDays.out).toBeCloseTo(allTime.out, 2)
  expect(thirtyDays.in).toBeCloseTo(allTime.in, 2)
  expect(thirtyDays.balance).toBeCloseTo(allTime.balance, 2)
})

test('the dashboard defaults to 60 days and remembers the selected period', async ({ page }) => {
  await gotoDashboard(page)

  const selector = page.getByRole('group', { name: 'Reporting period' })
  await expect(selector.getByRole('button', { name: '60 days', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await selector.getByRole('button', { name: '90 days', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('group', { name: 'Reporting period' }).getByRole('button', { name: '90 days', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('the period selector stays compact and safe on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await page.evaluate(() => {
    window.localStorage.setItem('tcg-tracking:period', 'not-a-period')
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  const selector = page.locator('select#reporting-period')
  await expect(selector).toBeVisible()
  await expect(selector).toHaveValue('60d')

  await selector.selectOption('90d')
  await page.reload()
  await expect(page.locator('select#reporting-period')).toHaveValue('90d')

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
})
