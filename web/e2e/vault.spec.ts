/**
 * The Vault, on screen.
 *
 * The two things worth driving a browser for are both about what is *not* shown: a vaulted
 * item must not appear in the ageing report, and the Vault view must not carry a
 * days-to-sell figure. It is measured on appreciation, not velocity.
 */
import { expect, test, type Page } from '@playwright/test'

import { gotoInventory, openProduct, uniqueName } from './helpers'

async function addVaulted(page: Page, name: string, total: string) {
  await gotoInventory(page)
  await page.getByRole('button', { name: 'Add product' }).first().click()

  const dialog = page.locator('form')
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('Quantity').fill('1')
  await dialog.getByLabel('Total paid').fill(total)
  await dialog.getByRole('button', { name: /^Vault/ }).click()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
}

test('a vaulted item is not reported as money asleep', async ({ page }) => {
  const name = uniqueName('Parked Thing')
  await addVaulted(page, name, '900.00')

  await page.goto('/reports')
  await expect(page.getByText('The Vault')).toBeVisible({ timeout: 10_000 })

  // It is in the Vault view...
  await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible()
  // ...and it says outright that this is not a warning.
  await expect(page.getByText(/it is not a warning/)).toBeVisible()
  await expect(page.getByText(/because it is not asleep/)).toBeVisible()
})

test('the Vault is measured on what it gained, not how fast it moves', async ({ page }) => {
  const name = uniqueName('Appreciating')
  await addVaulted(page, name, '100.00')

  await page.goto('/reports')
  const row = page.getByRole('row', { name: new RegExp(name) })
  await expect(row).toBeVisible({ timeout: 10_000 })

  // Never valued stays honest rather than reporting cost as worth.
  await expect(row.getByText('not valued')).toBeVisible()

  await row.getByRole('button', { name: 'Value it' }).click()
  const dialog = page.locator('form')
  await dialog.getByLabel('Per unit, today').fill('160.00')
  await expect(dialog.getByText(/never becomes cost basis/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Save it' }).click()
  await expect(dialog).toBeHidden()

  const valued = page.getByRole('row', { name: new RegExp(name) })
  await expect(valued).toContainText('$160.00')
  await expect(valued).toContainText('+$60.00')

  // The estimate must not have touched cost basis.
  await openProduct(page, name)
  await expect(page.getByText('$100.00').first()).toBeVisible()
})
