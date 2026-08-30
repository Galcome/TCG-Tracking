/**
 * The operator-controlled side of free market estimates.
 *
 * The provider is deliberately intercepted here: this test proves the Product Detail
 * workflow and request shape without making a live TCGCSV call or depending on today's feed.
 */
import { expect, test } from '@playwright/test'

import { addProduct, openProduct, uniqueName } from './helpers'

type MappingRequest = {
  product_id: string
  provider: 'tcgcsv'
  external_product_id: string
  external_group_id: string
  external_category_id: string
  subtype_name: string
}

test('first pricing mapping includes the product and enables a manual refresh', async ({ page }) => {
  const productName = await addProduct(page, {
    name: uniqueName('Pricing Box'),
    quantity: 1,
    total: '100.00',
  })

  let mapping: Record<string, unknown> | null = null
  await page.route('**/api/v1/pricing/mappings**', async (route) => {
    const request = route.request()
    if (request.method() === 'GET') {
      await route.fulfill({ json: mapping ? [mapping] : [] })
      return
    }

    if (request.method() === 'POST') {
      const body = request.postDataJSON() as MappingRequest
      mapping = {
        id: 'mapping-e2e',
        ...body,
        condition: null,
        language: null,
        match_status: 'confirmed',
        notes: null,
        created_by_member_id: null,
        created_at: '2026-08-29T12:00:00Z',
        updated_at: '2026-08-29T12:00:00Z',
      }
      await route.fulfill({ status: 201, json: mapping })
      return
    }

    await route.continue()
  })

  let refreshRequested = false
  await page.route('**/api/v1/pricing/refresh', async (route) => {
    expect(route.request().method()).toBe('POST')
    refreshRequested = true
    await route.fulfill({
      json: {
        attempted: 1,
        refreshed: 1,
        skipped: 0,
        stale: 0,
        unavailable: 0,
        source_revision: 'e2e-feed',
        errors: [],
      },
    })
  })

  await openProduct(page, productName)
  const panel = page
    .getByRole('heading', { name: 'Free-source market estimate' })
    .locator('..')
    .locator('..')
  const category = '3'
  const group = '3170'
  const externalProduct = '12345'
  const subtype = 'Holofoil'

  await panel.getByLabel('Category ID').fill(category)
  await panel.getByLabel('Group ID').fill(group)
  await panel.getByLabel('Product ID').fill(externalProduct)
  await panel.getByLabel('Subtype / printing').fill(subtype)

  const createRequest = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && request.url().endsWith('/api/v1/pricing/mappings'),
  )
  await panel.getByRole('button', { name: 'Confirm mapping' }).click()
  const body = (await (await createRequest).postDataJSON()) as MappingRequest

  expect(body).toEqual({
    product_id: expect.any(String),
    provider: 'tcgcsv',
    external_product_id: externalProduct,
    external_group_id: group,
    external_category_id: category,
    subtype_name: subtype,
  })
  expect(body.product_id).not.toBe('')
  expect(mapping?.product_id).toBe(body.product_id)
  await expect(panel.getByText('Mapping is confirmed.')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Disable mapping' })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Refresh confirmed estimates' })).toBeEnabled()

  await panel.getByRole('button', { name: 'Refresh confirmed estimates' }).click()
  await expect.poll(() => refreshRequested).toBe(true)
  await expect(panel.getByText(/Checked 1: 1 refreshed/)).toBeVisible()
})

test('catalog discovery fills exact product and subtype identifiers before confirmation', async ({
  page,
}) => {
  const productName = await addProduct(page, {
    name: uniqueName('Catalog Discovery Box'),
    quantity: 1,
    total: '100.00',
  })

  await page.route('**/api/v1/pricing/mappings*', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: [] })
      return
    }
    await route.continue()
  })
  await page.route('**/api/v1/pricing/catalog/categories', async (route) => {
    await route.fulfill({
      json: [{ category_id: 3, name: 'Pokemon', display_name: 'Pokémon' }],
    })
  })
  await page.route('**/api/v1/pricing/catalog/groups*', async (route) => {
    expect(new URL(route.request().url()).searchParams.get('category_id')).toBe('3')
    await route.fulfill({
      json: [
        {
          group_id: 3170,
          category_id: 3,
          name: 'Silver Tempest',
          abbreviation: 'SIT',
          published_on: null,
        },
      ],
    })
  })
  await page.route('**/api/v1/pricing/catalog/products*', async (route) => {
    const url = new URL(route.request().url())
    expect(url.searchParams.get('category_id')).toBe('3')
    expect(url.searchParams.get('group_id')).toBe('3170')
    expect(url.searchParams.get('q')).toBe('Lugia')
    await route.fulfill({
      json: [
        {
          product_id: 42,
          category_id: 3,
          group_id: 3170,
          name: 'Lugia V',
          clean_name: 'Lugia V',
          image_url: null,
          url: null,
          subtypes: ['Holofoil', 'Normal'],
        },
      ],
    })
  })

  await openProduct(page, productName)
  const panel = page
    .getByRole('heading', { name: 'Free-source market estimate' })
    .locator('..')
    .locator('..')

  await panel.getByRole('button', { name: 'Load free catalog options' }).click()
  await panel.getByLabel('Catalog category').selectOption({ label: 'Pokémon (3)' })
  await panel.getByLabel('Catalog group').selectOption({ label: 'Silver Tempest (3170)' })
  await panel.getByLabel('Search catalog products').fill('Lugia')
  await panel.getByRole('button', { name: 'Find products' }).click()
  await panel.getByRole('button', { name: 'Use this listing' }).click()

  await expect(panel.getByLabel('Category ID')).toHaveValue('3')
  await expect(panel.getByLabel('Group ID')).toHaveValue('3170')
  await expect(panel.getByLabel('Product ID')).toHaveValue('42')
  await expect(panel.getByLabel('Subtype / printing')).toHaveValue('Holofoil')
})
