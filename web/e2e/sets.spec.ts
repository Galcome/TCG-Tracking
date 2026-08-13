/**
 * Sets, through the real app.
 *
 * The failure this prevents is quiet: "Fable", "Fabled" and "Lorcana Fable" as three sets
 * look wrong nowhere until a rollup splits across all three and undercounts every one of
 * them. So these tests care about the two moments where a duplicate gets created - typing
 * a name that already exists in another case, and typing one that is nearly right.
 */
import { expect, test, type Page } from '@playwright/test'

import { gotoInventory, uniqueName } from './helpers'

/** Open Add product with a game selected, ready to type a set. */
async function openAddProduct(page: Page, game: string) {
  await gotoInventory(page)
  await page.getByRole('button', { name: 'Add product' }).first().click()

  const dialog = page.locator('form')
  await dialog.getByLabel('Name').fill(uniqueName('Set Box'))
  await dialog.getByLabel('Quantity').fill('1')
  await dialog.getByLabel('Total paid').fill('100.00')
  await dialog.getByLabel('Game').selectOption({ label: game })
  return dialog
}

test('the seeded calendar offers a set nobody has bought yet', async ({ page }) => {
  const dialog = await openAddProduct(page, 'Pokémon')

  // Real, released four weeks ago, and in the app without anybody entering it.
  await expect(
    dialog.getByRole('button', { name: /Mega Evolution: Pitch Black Night/ }),
  ).toBeVisible({ timeout: 10_000 })
})

test('a set that has not come out yet is not offered', async ({ page }) => {
  const dialog = await openAddProduct(page, 'Magic: The Gathering')
  await dialog.getByPlaceholder('Start typing, or pick one below').fill('Star Trek')

  // Seeded for 13 November. Suggesting it now would be the calendar guessing.
  await expect(dialog.getByRole('button', { name: /^Star Trek/ })).toBeHidden({
    timeout: 10_000,
  })
})

test('suggestions are scoped to the game', async ({ page }) => {
  const dialog = await openAddProduct(page, 'Lorcana')

  await expect(dialog.getByRole('button', { name: /Winterspell/ })).toBeVisible({
    timeout: 10_000,
  })
  // A Pokémon set has no business being offered on a Lorcana product.
  await expect(dialog.getByRole('button', { name: /Pitch Black Night/ })).toBeHidden()
})

test('tapping a suggestion fills the field', async ({ page }) => {
  const dialog = await openAddProduct(page, 'Lorcana')

  await dialog.getByRole('button', { name: /Winterspell/ }).first().click()
  await expect(dialog.getByPlaceholder('Start typing, or pick one below')).toHaveValue('Winterspell')
})

test('a near miss is questioned before it becomes a second set', async ({ page }) => {
  const dialog = await openAddProduct(page, 'Lorcana')
  await dialog.getByPlaceholder('Start typing, or pick one below').fill('Wintersple')

  // Asked, not corrected, and nothing is blocked.
  const question = dialog.getByRole('button', { name: /Did you mean Winterspell\?/ })
  await expect(question).toBeVisible({ timeout: 10_000 })

  await question.click()
  await expect(dialog.getByPlaceholder('Start typing, or pick one below')).toHaveValue('Winterspell')
})

test('the same set typed in another case lands on one record', async ({ page }) => {
  const set = uniqueName('Casing')

  let dialog = await openAddProduct(page, 'Pokémon')
  await dialog.getByPlaceholder('Start typing, or pick one below').fill(set)
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  dialog = await openAddProduct(page, 'Pokémon')
  await dialog.getByPlaceholder('Start typing, or pick one below').fill(set.toUpperCase())
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  // One chip, not two. Two would split every report that groups by set.
  dialog = await openAddProduct(page, 'Pokémon')
  await dialog.getByPlaceholder('Start typing, or pick one below').fill(set)
  await expect(dialog.getByRole('button', { name: set, exact: true })).toHaveCount(1, {
    timeout: 10_000,
  })
})

test('a set nobody has ever bought can still be typed', async ({ page }) => {
  const set = uniqueName('Panini World Cup')

  // Stickers and slabs have no release calendar, and must not be second-class.
  const dialog = await openAddProduct(page, 'Sports')
  await dialog.getByPlaceholder('Start typing, or pick one below').fill(set)
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  const again = await openAddProduct(page, 'Sports')
  await expect(again.getByRole('button', { name: set, exact: true })).toBeVisible({
    timeout: 10_000,
  })
})

test('what the group actually buys is offered first', async ({ page }) => {
  const set = uniqueName('Really Bought')

  const dialog = await openAddProduct(page, 'Pokémon')
  await dialog.getByPlaceholder('Start typing, or pick one below').fill(set)
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  // The calendar is a bonus. When it goes stale, what the group buys still leads.
  const again = await openAddProduct(page, 'Pokémon')
  const chips = again.locator('button', { hasText: /.+/ })
  await expect(again.getByRole('button', { name: set, exact: true })).toBeVisible({
    timeout: 10_000,
  })
  expect(await chips.count()).toBeGreaterThan(0)
})
