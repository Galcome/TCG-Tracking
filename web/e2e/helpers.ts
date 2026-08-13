/**
 * Shared steps for the end-to-end suite.
 *
 * Every spec works on its own uniquely-named product and asserts on that product's own
 * figures, because the database is shared and store-wide totals move underneath you.
 * Where a spec does need a store-wide number, it measures the change rather than the
 * value.
 */
import { expect, type Page } from '@playwright/test'

let counter = 0

/** Unique per run and per call, so searches match exactly one product. */
export function uniqueName(prefix: string): string {
  counter += 1
  return `${prefix} ${Date.now().toString(36)}-${counter}`
}

/** Money as a number, from text like "+$130.50" or "$1,450.00". */
export function amount(text: string | null): number {
  if (!text) return NaN
  const cleaned = text.replace(/[^0-9.-]/g, '')
  return Number(cleaned)
}

/** The stock list with no bucket filter. The heading names the place, so it is "All stock". */
export async function gotoInventory(page: Page) {
  await page.goto('/inventory')
  await expect(page.getByRole('heading', { name: 'All stock' })).toBeVisible()
}

/**
 * Create a product with an opening purchase, through the real Add product dialog.
 * Returns the name so the caller can find it again.
 */
export async function addProduct(
  page: Page,
  options: { name?: string; quantity: number; total: string; shipping?: string },
): Promise<string> {
  const name = options.name ?? uniqueName('E2E Box')

  await gotoInventory(page)
  await page.getByRole('button', { name: 'Add product' }).click()

  const dialog = page.locator('form')
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('Quantity').fill(String(options.quantity))
  await dialog.getByLabel('Total paid').fill(options.total)

  if (options.shipping) {
    await dialog.getByText('Advanced').click()
    await dialog.getByLabel('Shipping').fill(options.shipping)
  }

  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  return name
}

/** Regex-safe form of a product name, which carries base-36 digits and hyphens. */
export function rx(name: string): RegExp {
  return new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
}

/**
 * Open a product's own page, where every figure belongs to it alone.
 *
 * Waits for the searched-for row rather than clicking the first link: search is debounced
 * by 250ms, so clicking straight away opens whichever product happened to be listed first.
 *
 * Clicks the product's *name*, which is how a person gets here. The row also carries an
 * explicit "Open" action; both lead to the same page, and the name is the one somebody
 * reaches for first.
 */
export async function openProduct(page: Page, name: string) {
  await gotoInventory(page)
  await page.getByPlaceholder('Search products…').fill(name)

  const row = page.getByRole('row', { name: rx(name) })
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.getByRole('link', { name }).click()

  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 10_000 })
}

/** The value out of a named stat tile: the label's sibling paragraph. */
export function stat(page: Page, label: string) {
  return page
    .getByText(label, { exact: true })
    .locator('xpath=..')
    .locator('p')
    .nth(1)
}

export async function statAmount(page: Page, label: string): Promise<number> {
  return amount(await stat(page, label).innerText())
}

export async function recordSale(
  page: Page,
  options: { quantity: number; total: string; channel?: string; platformFees?: string },
) {
  await page.getByRole('button', { name: 'Record sale' }).first().click()
  const dialog = page.locator('form')

  await dialog.getByLabel('Quantity').fill(String(options.quantity))
  await dialog.getByLabel('Total received').fill(options.total)

  if (options.channel) {
    const known = dialog.getByRole('button', { name: options.channel, exact: true })
    if (await known.count()) {
      await known.click()
    } else {
      await dialog.getByRole('button', { name: 'Other', exact: true }).click()
      await dialog.getByPlaceholder('Card shop, show, trade…').fill(options.channel)
    }
  }

  if (options.platformFees !== undefined) {
    await dialog.getByLabel('Platform fees').fill(options.platformFees)
  }

  await dialog.getByRole('button', { name: 'Record sale' }).click()
  await expect(dialog).toBeHidden()
}
