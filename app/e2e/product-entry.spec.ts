import { test, expect, type Page } from '@playwright/test'

const API = 'http://127.0.0.1:8101'

async function firebaseFixture(page: Page) {
  const now = Math.floor(Date.now() / 1000)
  const token = [{ alg: 'none' }, {
    sub: 'e2e-user', user_id: 'e2e-user', iat: now, exp: now + 3600, auth_time: now,
    email: 'e2e@example.test', aud: 'test-firebase-project',
  }].map((part) => Buffer.from(JSON.stringify(part)).toString('base64url')).join('.') + '.test-signature'
  await page.route('https://identitytoolkit.googleapis.com/**', async (route) => {
    const lookup = route.request().url().includes(':lookup')
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(lookup
        ? { users: [{ localId: 'e2e-user', email: 'e2e@example.test', emailVerified: true, providerUserInfo: [] }] }
        : { localId: 'e2e-user', email: 'e2e@example.test', idToken: token, refreshToken: 'test-refresh', expiresIn: '3600', registered: true }),
    })
  })
  await page.route('https://securetoken.googleapis.com/**', async (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ id_token: token, access_token: token, refresh_token: 'test-refresh', expires_in: '3600', user_id: 'e2e-user', token_type: 'Bearer' }),
  }))
}

async function signIn(page: Page) {
  await firebaseFixture(page)
  await page.goto('/')
  await page.getByLabel('Email', { exact: true }).fill('e2e@example.test')
  await page.getByLabel('Password', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Account', exact: true })).toBeVisible()
}

async function chooseType(page: Page, typeName: string) {
  await page.getByRole('dialog', { name: 'Add product', exact: true }).getByRole('button', { name: /^Product type:/ }).click()
  await page.getByRole('dialog', { name: 'Product type', exact: true })
    .getByRole('button', { name: typeName, exact: true }).click()
}

function setSuggestions(gameId: string, setName = 'Stellar Crown') {
  return {
    items: [
      { id: 'recent-set', game_id: gameId, name: setName, released_on: '2026-01-01', uses: 3 },
      { id: 'new-set', game_id: gameId, name: 'New Calendar Set', released_on: '2026-02-01', uses: 0 },
    ],
    did_you_mean: setName,
  }
}

test('sealed entry derives names, keeps manual corrections, and keeps optional fields collapsed', async ({ page, request }) => {
  const games = await (await request.get(API + '/api/v1/games')).json()
  const types = await (await request.get(API + '/api/v1/product-types')).json()
  const sealed = types.find((type: { slug: string }) => type.slug === 'booster-box')
  expect(sealed).toBeTruthy()

  await page.route(API + '/api/v1/sets**', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(setSuggestions(games[0].id)) })
  })
  await signIn(page)
  await page.getByRole('button', { name: (page.viewportSize()?.width ?? 1280) >= 1000 ? 'Inventory' : 'Stock', exact: true }).click()
  await page.getByRole('button', { name: 'Add product', exact: true }).click()
  await chooseType(page, sealed.name)

  await page.getByLabel('Set', { exact: true }).fill('Stelar')
  await expect(page.getByRole('button', { name: 'Did you mean Stellar Crown?', exact: true })).toBeVisible()
  await expect(page.getByText('Recent', { exact: true })).toBeVisible()
  await expect(page.getByText('New', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Did you mean Stellar Crown?', exact: true }).click()
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Stellar Crown Booster Box')

  await expect(page.getByLabel('Shipping', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Grading company', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Show optional details', exact: true }).click()
  await expect(page.getByLabel('Shipping', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Collector number', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Grading company', { exact: true })).toHaveCount(0)

  await page.getByLabel('Total paid', { exact: true }).fill('10.00')
  const posted: Record<string, unknown>[] = []
  await page.route(API + '/api/v1/products', async (route) => {
    posted.push(route.request().postDataJSON() as Record<string, unknown>)
    if (posted.length === 1) {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ detail: 'Retry this fixture' }) })
    } else {
      await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' })
    }
  })
  await page.getByRole('button', { name: 'Save product', exact: true }).click()
  await expect.poll(() => posted[0]?.name).toBe('Stellar Crown Booster Box')
  await expect(page.getByText('Retry this fixture', { exact: true })).toBeVisible()

  await page.getByLabel('Name', { exact: true }).fill('My sealed product')
  await page.getByLabel('Set', { exact: true }).fill('Different set')
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('My sealed product')
  await page.getByRole('button', { name: 'Save product', exact: true }).click()
  await expect.poll(() => posted[1]?.name).toBe('My sealed product')
})

test('raw and graded card entry stays manual and slab fields are type-appropriate', async ({ page, request }) => {
  const games = await (await request.get(API + '/api/v1/games')).json()
  const types = await (await request.get(API + '/api/v1/product-types')).json()
  const raw = types.find((type: { slug: string }) => type.slug === 'single')
  const graded = types.find((type: { slug: string }) => type.slug === 'graded-card')
  expect(raw).toBeTruthy()
  expect(graded).toBeTruthy()

  await page.route(API + '/api/v1/sets**', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(setSuggestions(games[0].id)) })
  })
  await signIn(page)
  await page.getByRole('button', { name: (page.viewportSize()?.width ?? 1280) >= 1000 ? 'Inventory' : 'Stock', exact: true }).click()
  await page.getByRole('button', { name: 'Add product', exact: true }).click()
  await chooseType(page, raw.name)
  await page.getByLabel('Set', { exact: true }).fill('Stellar')
  await expect(page.getByRole('button', { name: 'Stellar Crown', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Stellar Crown', exact: true }).click()
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('')
  await page.getByRole('button', { name: 'Show optional details', exact: true }).click()
  await expect(page.getByLabel('Grading company', { exact: true })).toHaveCount(0)

  await chooseType(page, graded.name)
  await expect(page.getByLabel('Grading company', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('')
  await chooseType(page, raw.name)
  await expect(page.getByLabel('Grading company', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Save product', exact: true }).click()
  await expect(page.getByText('Name is required.', { exact: true })).toBeVisible()
})
