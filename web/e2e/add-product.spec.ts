/**
 * Adding a product, and the name writing itself.
 *
 * Joseph, looking at the dialog: "This feels awkward. The name is blank and doesn't have
 * auto fill but also the set is there which is great."
 *
 * He was right, and the reason was structural: Name came first, with focus, while Game,
 * Product type and Set — everything needed to *build* that name — were collected after it.
 * The old placeholder was "Vivid Voltage Booster Box", which is exactly set plus type,
 * typed out by hand every time.
 */
import { expect, test } from '@playwright/test'

import { gotoInventory, uniqueName } from './helpers'

/** Open Add product and return the dialog. */
async function openDialog(page: import('@playwright/test').Page) {
  await gotoInventory(page)
  await page.getByRole('button', { name: 'Add product' }).first().click()
  return page.getByRole('dialog').locator('form')
}

test('the name writes itself from the set and the type', async ({ page }) => {
  const dialog = await openDialog(page)
  const setName = uniqueName('Pitch Black Night')

  await dialog.getByLabel('Product type').selectOption({ label: 'Sealed Case' })
  await dialog.getByPlaceholder('Start typing, or pick one below').fill(setName)

  await expect(dialog.getByLabel('Name')).toHaveValue(`${setName} Sealed Case`)
})

test('the name follows the type as well as the set', async ({ page }) => {
  const dialog = await openDialog(page)
  const setName = uniqueName('Follows Type')

  await dialog.getByPlaceholder('Start typing, or pick one below').fill(setName)
  await dialog.getByLabel('Product type').selectOption({ label: 'Booster Box' })
  await expect(dialog.getByLabel('Name')).toHaveValue(`${setName} Booster Box`)

  await dialog.getByLabel('Product type').selectOption({ label: 'Sealed Case' })
  await expect(dialog.getByLabel('Name')).toHaveValue(`${setName} Sealed Case`)
})

test('a name typed by hand is never overwritten again', async ({ page }) => {
  const dialog = await openDialog(page)
  const mine = uniqueName('My Own Name')

  await dialog.getByLabel('Product type').selectOption({ label: 'Booster Box' })
  await dialog.getByPlaceholder('Start typing, or pick one below').fill('Something')
  await dialog.getByLabel('Name').fill(mine)

  // Changing the set afterwards must not throw the correction away. This is the whole
  // reason the suggestion tracks a "touched" flag rather than just following the inputs:
  // silently discarding work somebody watched themselves do is worse than not helping.
  await dialog.getByPlaceholder('Start typing, or pick one below').fill('Something Else')
  await expect(dialog.getByLabel('Name')).toHaveValue(mine)

  await dialog.getByLabel('Product type').selectOption({ label: 'Sealed Case' })
  await expect(dialog.getByLabel('Name')).toHaveValue(mine)
})

test('a card is named by the person, not by the set', async ({ page }) => {
  const dialog = await openDialog(page)

  await dialog.getByLabel('Product type').selectOption({ label: 'Single' })
  await dialog.getByPlaceholder('Start typing, or pick one below').fill('Fabled')

  // "Fabled Single" would be a wrong name on every card in the set, and if anyone ever
  // forgot to overwrite it the reports would fill with identical rows.
  await expect(dialog.getByLabel('Name')).toHaveValue('')
})

test('the derived name is what actually gets saved', async ({ page }) => {
  const dialog = await openDialog(page)
  const setName = uniqueName('Persisted Set')

  await dialog.getByLabel('Product type').selectOption({ label: 'Booster Box' })
  await dialog.getByPlaceholder('Start typing, or pick one below').fill(setName)
  await dialog.getByLabel('Quantity').fill('1')
  await dialog.getByLabel('Total paid').fill('250.00')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toBeHidden()

  await page.getByPlaceholder('Search products…').fill(setName)
  await expect(
    page.getByRole('row', { name: new RegExp(`${setName} Booster Box`) }),
  ).toBeVisible({ timeout: 10_000 })
})
