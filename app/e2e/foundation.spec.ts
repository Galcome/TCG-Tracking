import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('mobile detail prioritizes contextual actions and preserves pricing drafts in disclosures', async ({ page, request }) => {
  const games = await (await request.get(API + '/api/v1/games')).json();
  const types = await (await request.get(API + '/api/v1/product-types')).json();
  const product = await (await request.post(API + '/api/v1/products', { data: {
    name: 'Long product identity for mobile hierarchy regression', game_id: games[0].id,
    product_type_id: types.find((type: { slug: string }) => type.slug === 'single').id,
    initial_purchase: { quantity: 1, amount: '10.01', funding: [] },
  } })).json();
  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(page);
  await page.goto('/products/' + product.id);
  await expect(page.getByRole('button', { name: 'Record sale', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move stock', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New sale', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit product', exact: true })).toHaveCount(0);
  const manage = page.getByRole('button', { name: 'Manage product', exact: true });
  await expect(manage).toHaveAttribute('aria-expanded', 'false');
  await manage.click();
  await expect(manage).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Edit product', exact: true })).toBeVisible();
  const pricing = page.getByRole('button', { name: 'Market pricing', exact: true });
  await pricing.click();
  await page.getByLabel('Category ID', { exact: true }).fill('3');
  await pricing.click();
  await expect(page.getByLabel('Category ID', { exact: true })).toBeHidden();
  await pricing.click();
  await expect(page.getByLabel('Category ID', { exact: true })).toHaveValue('3');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('compact shell keeps navigation reachable and global forms reuse the protected workflows', async ({ page, request }) => {
  const games = await (await request.get(API + '/api/v1/games')).json();
  const types = await (await request.get(API + '/api/v1/product-types')).json();
  const product = await (await request.post(API + '/api/v1/products', { data: { name: 'Global sale picker card', game_id: games[0].id,
    product_type_id: types.find((item: { slug: string }) => item.slug === 'single').id,
    initial_purchase: { quantity: 1, amount: '0.00', funding: [] } } })).json();
  await page.setViewportSize({width:390,height:900});
  await signIn(page);
  for (const width of [320, 390, 768, 1536]) {
    await page.setViewportSize({ width, height: 900 });
    const navigation = page.getByLabel('Main navigation', { exact: true });
    await expect(navigation.getByRole('button', { name: 'Dashboard', exact: true })).toBeEnabled();
    await expect(navigation.getByRole('button')).toHaveCount(width < 1000 ? 5 : 7);
    const navigationBox = await navigation.boundingBox();
    if (width < 1000) {
      expect(navigationBox!.y).toBeGreaterThan(600);
      expect(navigationBox!.y + navigationBox!.height).toBeGreaterThanOrEqual(895);
    }
    for (const label of width < 1000 ? ['Dashboard', 'Stock', 'Add', 'Sales', 'More'] : ['Dashboard', 'Inventory', 'Store', 'Vault', 'Sales', 'Money', 'Reports']) {
      const box = await navigation.getByRole('button', { name: label, exact: true }).boundingBox();
      expect(box, label + ' must be rendered without scrolling').not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(901);
      expect(box!.height).toBeGreaterThanOrEqual(48);
    }
  }
  await page.setViewportSize({ width: 390, height: 900 });
  if ((page.viewportSize()?.width ?? 1280) < 1000) await page.getByRole('button', { name: 'Add', exact: true }).click();
  const quickActions = page.getByRole('dialog', { name: 'Quick actions', exact: true });
  await expect(quickActions).toBeVisible();
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Quick actions', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  if ((page.viewportSize()?.width ?? 1280) < 1000) await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: (page.viewportSize()?.width ?? 1280) < 1000 ? 'Record sale' : 'New sale', exact: true }).click();
  await page.getByLabel('Search products in stock', { exact: true }).fill(product.name);
  await page.getByRole('button', { name: product.name + ' · 1 in stock', exact: true }).click();
  await expect(page.getByLabel('Total received', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel('Main navigation', { exact: true }).getByRole('button', { name: (page.viewportSize()?.width ?? 1280) >= 1000 ? 'Inventory' : 'Stock', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Stock:/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('button', { name: 'Stock: In stock', exact: true }).click();
  await page.getByRole('dialog', { name: (page.viewportSize()?.width ?? 1280) >= 1000 ? 'Inventory' : 'Stock', exact: true }).getByRole('button', { name: 'All products', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Stock product: ' + product.name, exact: true })).toBeVisible();
  await expect(page.getByText('All products', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stock: All products', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('dialog', { name: 'More', exact: true }).getByRole('button', { name: 'Vault', exact: true }).click();
  await expect(page).toHaveURL(/\/vault$/);
  expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test('responsive stock cards preserve action guards and keep controls within the viewport', async ({ page, request }) => {
  const games = await (await request.get(API + '/api/v1/games')).json();
  const types = await (await request.get(API + '/api/v1/product-types')).json();
  const product = await (await request.post(API + '/api/v1/products', { data: {
    name: 'Stock action fixture', game_id: games[0].id,
    product_type_id: types.find((item: { slug: string }) => item.slug === 'single').id,
    initial_purchase: { quantity: 1, amount: '10.00', funding: [] },
  } })).json();
  const ripProduct = await (await request.post(API + '/api/v1/products', { data: {
    name: 'Rip-ready booster box', game_id: games[0].id,
    product_type_id: types.find((item: { slug: string }) => item.slug === 'booster-box').id,
    set_name: 'Rip-ready set', initial_purchase: { quantity: 1, amount: '100.00', bucket: 'store', funding: [] },
  } })).json();
  const emptyRipProduct = { ...ripProduct, id: '99999999-9999-4999-8999-999999999999', name: 'Empty booster box', stats: { ...ripProduct.stats, quantity_on_hand: 0, by_bucket: { inventory: 0, store: 0, vault: 0 } } };
  await page.route(API + '/api/v1/products?*', route => route.fulfill({ json: {
    items: [product, ripProduct, emptyRipProduct,
      { ...product, id: '77777777-7777-4777-8777-777777777777', name: 'Empty stock fixture', stats: { ...product.stats, quantity_on_hand: 0, by_bucket: { inventory: 0, store: 0, vault: 0 } } },
      { ...product, id: '88888888-8888-4888-8888-888888888888', name: 'Archived stock fixture', is_archived: true },
    ], total: 5, bucket_totals: { inventory: 2, store: 1, vault: 0 },
  } }));
  await signIn(page);
  await page.goto('/inventory');
  for (const width of [320, 390, 1536]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of ['Stock action fixture', 'Empty stock fixture', 'Archived stock fixture']) {
      const card = page.getByRole('group', { name: 'Stock product: ' + name, exact: true });
      await expect(card.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
      for (const label of ['Sell', 'Move']) {
        const action = card.getByRole('button', { name: label, exact: true });
        if (name === product.name) await expect(action).toBeEnabled(); else await expect(action).toBeDisabled();
        const box = await action.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(48);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      }
    }
    const ripCard = page.getByRole('group', { name: 'Stock product: Rip-ready booster box', exact: true });
    await expect(ripCard.getByRole('button', { name: 'Rip', exact: true })).toBeEnabled();
    await expect(page.getByRole('group', { name: 'Stock product: Stock action fixture', exact: true }).getByRole('button', { name: 'Rip', exact: true })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Stock product: Empty booster box', exact: true }).getByRole('button', { name: 'Rip', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBeTruthy();
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole('button', { name: 'Store 1', exact: true }).click();
  await page.getByRole('group', { name: 'Stock product: Rip-ready booster box', exact: true }).getByRole('button', { name: 'Rip', exact: true }).click();
  const rip = page.getByRole('dialog', { name: 'Rip open — Rip-ready booster box', exact: true });
  await expect(rip).toBeVisible();
  await expect(rip.getByRole('button', { name: 'Ripped out of: Store (1)', exact: true })).toBeVisible();
  await rip.getByRole('button', { name: 'Close', exact: true }).click();
  const active = page.getByRole('group', { name: 'Stock product: ' + product.name, exact: true });
  await active.getByRole('button', { name: 'Sell', exact: true }).click();
  await expect(page.getByLabel('Total received', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await active.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Move stock', exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
});

test('split purchase funding and mixed sale proceeds create exact separate account postings', async ({ page, request }) => {
  const games = await (await request.get(API + '/api/v1/games')).json();
  const types = await (await request.get(API + '/api/v1/product-types')).json();
  const accounts = (await (await request.get(API + '/api/v1/money/accounts')).json()).items.filter((a: { is_active: boolean; kind: string }) => a.is_active && a.kind !== 'store_credit');
  expect(accounts.length).toBeGreaterThanOrEqual(2);
  const product = await (await request.post(API + '/api/v1/products', { data: { name: 'Exact split account card', game_id: games[0].id,
    product_type_id: types.find((item: { slug: string }) => item.slug === 'single').id } })).json();
  await signIn(page);
  await page.goto('/products/' + product.id);
  await openProductSections(page);
  await page.getByRole('button', { name: 'Add purchase', exact: true }).click();
  await page.getByLabel('Total paid', { exact: true }).fill('10.01');
  await page.getByRole('button', { name: 'Show optional details', exact: true }).click();
  await page.getByLabel('Shipping', { exact: true }).fill('0.29');
  await page.getByRole('button', { name: 'Split funding', exact: true }).click();
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: new RegExp(`^Funding ${i + 1} account:`) }).click();
    await page.getByRole('dialog').last().getByRole('button', { name: accounts[i].name, exact: true }).click();
    await page.getByLabel(`Funding ${i + 1} amount`, { exact: true }).fill(i === 0 ? '5.10' : '5.20');
  }
  await page.getByRole('button', { name: 'Save purchase', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const funded = await (await request.get(API + '/api/v1/products/' + product.id)).json();
  expect(funded.stats.remaining_cost).toBe('10.30');
  const funding = (await (await request.get(API + '/api/v1/money/movements?kind=funding&limit=200')).json()).items.find((m: { product_name: string }) => m.product_name === product.name);
  expect(funding.legs.map((leg: { amount: string }) => leg.amount).sort()).toEqual(['-5.10','-5.20']);
  await page.getByRole('button', { name: 'Record sale', exact: true }).click();
  const now = new Date();
  const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  const saleDate = page.getByLabel('Sale date', { exact: true });
  await expect(saleDate).toHaveAttribute('type', 'date');
  await expect(saleDate).toHaveValue(today);
  await expect(saleDate).toHaveAttribute('max', today);
  await page.getByLabel('Total received', { exact: true }).fill('20.00');
  await page.getByRole('button', { name: 'Split proceeds', exact: true }).click();
  await page.getByRole('button', { name: /^Proceeds 1 account:/ }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: accounts[0].name, exact: true }).click();
  await page.getByLabel('Proceeds 1 amount', { exact: true }).fill('10.00');
  await page.getByRole('button', { name: 'Proceeds 2 kind: Existing account', exact: true }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'New store credit', exact: true }).click();
  await page.getByLabel('Proceeds 2 store', { exact: true }).fill('Exact split shop');
  await page.getByLabel('Proceeds 2 amount', { exact: true }).fill('10.00');
  await page.getByRole('dialog').getByRole('button', { name: 'Record sale', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const sold = await (await request.get(API + '/api/v1/products/' + product.id)).json();
  expect(sold.stats.realized_profit).toBe('9.70');
  const proceeds = (await (await request.get(API + '/api/v1/money/movements?kind=proceeds&limit=200')).json()).items.find((m: { product_name: string }) => m.product_name === product.name);
  expect(proceeds.legs.map((leg: { amount: string }) => leg.amount)).toEqual(['10.00','10.00']);
  expect(proceeds.legs.some((leg: { account_kind: string }) => leg.account_kind === 'store_credit')).toBe(true);
});

test('one sale form records several products to one buyer with shared fees', async ({ page, request }) => {
  const games = await (await request.get(API + '/api/v1/games')).json();
  const types = await (await request.get(API + '/api/v1/product-types')).json();
  const single = types.find((item: { slug: string }) => item.slug === 'single').id;
  const make = async (name: string) => (await (await request.post(API + '/api/v1/products', { data: { name, game_id: games[0].id,
    product_type_id: single, initial_purchase: { quantity: 1, amount: '5.00', funding: [] } } })).json());
  const first = await make('Order line Pikachu');
  const second = await make('Order line Eevee');
  await signIn(page);
  await page.goto('/products/' + first.id);
  await page.getByRole('button', { name: 'Record sale', exact: true }).click();
  await page.getByLabel('Total received', { exact: true }).fill('20.00');
  await page.getByRole('button', { name: 'Add another item', exact: true }).click();
  await page.getByLabel('Find another product', { exact: true }).fill('Order line Eevee');
  await page.getByRole('button', { name: 'Order line Eevee · 1 in stock', exact: true }).click();
  await expect(page.getByLabel('Sold for', { exact: true })).toHaveValue('20.00');
  await page.getByLabel('Order line Eevee sold for', { exact: true }).fill('30.00');
  await page.getByLabel('Platform fees', { exact: true }).fill('5.00');
  await expect(page.getByText('Realized profit (order)')).toBeVisible();
  await expect(page.getByText(/Order line Eevee · 1 sold · fees \$3\.00/)).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Record 2-item sale', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const sales = (await (await request.get(API + '/api/v1/sales?limit=200')).json()).items
    .filter((sale: { product_id: string }) => sale.product_id === first.id || sale.product_id === second.id);
  expect(sales).toHaveLength(2);
  expect(new Set(sales.map((sale: { order_id: string }) => sale.order_id)).size).toBe(1);
  expect(sales.map((sale: { platform_fees: string }) => sale.platform_fees).sort()).toEqual(['2.00', '3.00']);
});

test('optional grading valuations retry separately from committed grading and preserve zero', async ({ page, request }) => {
  const games = await (await request.get(API + '/api/v1/games')).json();
  const types = await (await request.get(API + '/api/v1/product-types')).json();
  const source = await (await request.post(API + '/api/v1/products', { data: { name: 'Grading valuation card', game_id: games[0].id,
    product_type_id: types.find((item: { slug: string }) => item.slug === 'single').id,
    initial_purchase: { quantity: 1, amount: '10.01', funding: [] } } })).json();
  await signIn(page);
  await page.goto('/products/' + source.id);
  await openProductSections(page);
  let sends = 0;
  let returns = 0;
  page.on('request', req => {
    if (req.method() === 'POST' && req.url() === API + '/api/v1/grading') sends++;
    if (req.method() === 'POST' && req.url().endsWith('/return')) returns++;
  });
  await page.getByRole('button', { name: 'Send to grading', exact: true }).click();
  await page.getByRole('button', { name: 'After sending: Skip valuation', exact: true }).click();
  await page.getByRole('button', { name: 'Ask for raw value', exact: true }).click();
  await page.getByRole('button', { name: 'Send it', exact: true }).click();
  await expect(page.getByText('Raw value before grading — Grading valuation card', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Value per unit (CAD)', { exact: true })).toHaveValue('');
  await page.getByLabel('Value per unit (CAD)', { exact: true }).fill('0.00');
  await page.route(API + '/api/v1/valuations', route => route.fulfill({ status: 409, json: { detail: 'Valuation retry fixture' } }), { times: 1 });
  await page.getByRole('button', { name: 'Save valuation', exact: true }).click();
  await expect(page.getByText('Valuation retry fixture', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save valuation', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(sends).toBe(1);
  await page.getByRole('button', { name: 'Record grading return', exact: true }).click();
  await page.getByLabel('Grade', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'After returning: Skip valuation', exact: true }).click();
  await page.getByRole('button', { name: 'Ask for graded value', exact: true }).click();
  await page.getByRole('button', { name: 'Record it', exact: true }).click();
  await expect(page.getByText(/Value after grading — Grading valuation card/)).toBeVisible();
  await page.getByRole('button', { name: 'Skip valuation', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(returns).toBe(1);
});

test('catalogue archive preserves money, history blocks deletion and mistaken empty products can be deleted', async ({ page, request }) => {
  const games = await (await request.get(API + '/api/v1/games')).json();
  const types = await (await request.get(API + '/api/v1/product-types')).json();
  const identity = { game_id: games[0].id, product_type_id: types.find((item: { slug: string }) => item.slug === 'single').id };
  const tracked = await (await request.post(API + '/api/v1/products', { data: { ...identity, name: 'Archive safeguard card',
    initial_purchase: { quantity: 1, amount: '10.01', funding: [] } } })).json();
  await signIn(page);
  await page.goto('/products/' + tracked.id);
  await openProductSections(page);
  await page.getByRole('button', { name: 'Delete mistaken product', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Permanently delete', exact: true })).toBeDisabled();
  await page.getByLabel('Type DELETE to confirm', { exact: true }).fill('DELETE');
  await page.getByRole('button', { name: 'Permanently delete', exact: true }).click();
  await expect(page.getByText(/This product has transaction history and cannot be deleted/)).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Archive product', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm archive', exact: true }).click();
  await expect(page).toHaveURL(/\/inventory$/);
  const archived = await (await request.get(API + '/api/v1/products/' + tracked.id)).json();
  expect(archived.is_archived).toBe(true);
  expect(archived.stats.remaining_cost).toBe('10.01');
  expect(archived.stats.quantity_on_hand).toBe(1);
  await page.goto('/products/' + tracked.id);
  await openProductSections(page);
  await page.getByRole('button', { name: 'Restore archived product', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm restore', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Archive product', exact: true })).toBeVisible();
  const mistaken = await (await request.post(API + '/api/v1/products', { data: { ...identity, name: 'Mistaken empty card' } })).json();
  await page.goto('/products/' + mistaken.id);
  await openProductSections(page);
  await page.getByRole('button', { name: 'Delete mistaken product', exact: true }).click();
  await page.getByLabel('Type DELETE to confirm', { exact: true }).fill('DELETE');
  await page.getByRole('button', { name: 'Permanently delete', exact: true }).click();
  await expect(page).toHaveURL(/\/inventory$/);
  expect((await request.get(API + '/api/v1/products/' + mistaken.id)).status()).toBe(404);
});

test('pricing requires explicit printing confirmation and keeps mapping writes out of the ledger', async ({ page, request }) => {
  const games = await (await request.get(API + '/api/v1/games')).json();
  const types = await (await request.get(API + '/api/v1/product-types')).json();
  const created = await request.post(API + '/api/v1/products', { data: { name: 'Pricing confirmation card', game_id: games[0].id,
    product_type_id: types.find((item: { slug: string }) => item.slug === 'single').id,
    initial_purchase: { quantity: 1, amount: '10.01', funding: [] } } });
  expect(created.ok()).toBeTruthy();
  const product = await created.json();
  await page.route(API + '/api/v1/pricing/refresh', route => route.fulfill({ json: {
    attempted: 1, refreshed: 0, skipped: 0, stale: 1, unavailable: 0, errors: ['Provider unavailable test fixture'],
  } }));
  await signIn(page);
  await page.goto('/products/' + product.id);
  await openProductSections(page);
  const controls = page.getByRole('group', { name: 'Pricing controls', exact: true });
  await controls.getByRole('button', { name: 'Confirm mapping', exact: true }).click();
  await expect(controls.getByText('Product ID is required.', { exact: true })).toBeVisible();
  await controls.getByLabel('Category ID', { exact: true }).fill('3');
  await controls.getByLabel('Group ID', { exact: true }).fill('123');
  await controls.getByLabel('Product ID', { exact: true }).fill('456');
  await controls.getByLabel('Subtype / printing', { exact: true }).fill('Reverse Holofoil');
  const save = page.waitForResponse(r => r.request().method() === 'POST' && r.url() === API + '/api/v1/pricing/mappings');
  await controls.getByRole('button', { name: 'Confirm mapping', exact: true }).click();
  expect((await save).ok()).toBeTruthy();
  await expect(controls.getByText('Mapping is confirmed. Saving confirms the identity again.', { exact: true })).toBeVisible();
  await controls.getByRole('button', { name: 'Disable mapping', exact: true }).click();
  await expect(controls.getByRole('button', { name: 'Re-enable mapping', exact: true })).toBeVisible();
  await expect(controls.getByRole('button', { name: 'Refresh all confirmed estimates', exact: true })).toBeDisabled();
  await controls.getByRole('button', { name: 'Re-enable mapping', exact: true }).click();
  await expect(controls.getByRole('button', { name: 'Disable mapping', exact: true })).toBeVisible();
  await controls.getByRole('button', { name: 'Refresh all confirmed estimates', exact: true }).click();
  await expect(controls.getByText(/Provider unavailable test fixture/)).toBeVisible();
  const latest = await (await request.get(API + '/api/v1/products/' + product.id)).json();
  expect(latest.stats.remaining_cost).toBe('10.01');
  expect(latest.stats.quantity_on_hand).toBe(1);
});

test('catalog discovery fills an unconfirmed draft and never changes stock or cost', async ({ page, request }) => {
  const games = await (await request.get(API + '/api/v1/games')).json();
  const types = await (await request.get(API + '/api/v1/product-types')).json();
  const created = await request.post(API + '/api/v1/products', { data: {
    name: 'Discovery raw card', game_id: games[0].id,
    product_type_id: types.find((item: { slug: string }) => item.slug === 'single').id,
    initial_purchase: { quantity: 1, amount: '10.01', funding: [] },
  } });
  expect(created.ok()).toBeTruthy();
  const product = await created.json();
  await page.route(API + '/api/v1/pricing/catalog/categories', route => route.fulfill({ json: [
    { category_id: 3, name: 'Pokemon', display_name: 'Pokémon' },
  ] }));
  await page.route(API + '/api/v1/pricing/catalog/groups?*', route => route.fulfill({ json: [
    { group_id: 123, category_id: 3, name: 'Discovery set', abbreviation: null, published_on: null },
  ] }));
  await page.route(API + '/api/v1/pricing/catalog/products?*', route => route.fulfill({ json: [
    { product_id: 456, category_id: 3, group_id: 123, name: 'Discovery provider card', clean_name: null,
      image_url: null, url: null, subtypes: ['Reverse Holofoil', 'Normal'] },
  ] }));
  await signIn(page);
  await page.goto('/products/' + product.id);
  await openProductSections(page);
  const controls = page.getByRole('group', { name: 'Pricing controls', exact: true });
  await controls.getByRole('button', { name: 'Load free catalog options', exact: true }).click();
  await controls.getByRole('button', { name: 'Catalog category: Choose a category', exact: true }).click();
  await page.getByRole('dialog', { name: 'Catalog category', exact: true }).getByRole('button', { name: 'Pokémon (3)', exact: true }).click();
  await controls.getByRole('button', { name: 'Catalog group: Choose a group', exact: true }).click();
  await page.getByRole('dialog', { name: 'Catalog group', exact: true }).getByRole('button', { name: 'Discovery set (123)', exact: true }).click();
  await controls.getByLabel('Search catalog products', { exact: true }).fill('Discovery');
  await controls.getByRole('button', { name: 'Find products', exact: true }).click();
  await controls.getByRole('button', { name: 'Use this listing', exact: true }).click();
  await expect(controls.getByLabel('Product ID', { exact: true })).toHaveValue('456');
  await expect(controls.getByLabel('Subtype / printing', { exact: true })).toHaveValue('Normal');
  const mappings = await (await request.get(API + '/api/v1/pricing/mappings?product_id=' + product.id)).json();
  expect(mappings).toEqual([]);
  const latest = await (await request.get(API + '/api/v1/products/' + product.id)).json();
  expect(latest.stats.remaining_cost).toBe('10.01');
  expect(latest.stats.quantity_on_hand).toBe(1);
});

test('dashboard separates period trading from lifetime cash and preserves exact cents', async ({ page }) => {
  const fixtureId = '66666666-6666-4666-8666-666666666666';
  await page.route(API + '/api/v1/reports/attention', route => route.fulfill({ json: {
    sales_missing_cost: 0, products_with_negative_stock: 1,
    negative_stock_products: [{ id: fixtureId, name: 'Dashboard correction fixture', quantity: -1 }],
  } }));
  await page.route(API + '/api/v1/reports/by-marketplace?*', route => route.fulfill({ json: [{
    key: 'fixture', label: 'Fixture channel', revenue: '20.00', realized_profit: '9.00',
  }] }));
  await page.route(API + '/api/v1/sales?*', route => route.fulfill({ json: { total: 1, items: [{
    id: fixtureId, product_id: fixtureId, product: { id: fixtureId, name: 'Dashboard sale fixture' },
    quantity: 1, amount: '20.00', platform_fees: '1.00', payment_fees: '0.00', shipping_paid: '0.00',
    net_proceeds: '19.00', cost_basis: '10.00', realized_profit: '9.00', has_unknown_cost: false,
    days_held_weighted: null, sale_date: '2026-09-13', sold_by_member_id: null,
    marketplace: 'Fixture channel', notes: null, status: 'active',
  }] } }));
  await page.route(API + '/api/v1/reports/by-month', route => route.fulfill({ json: [{
    month: '2026-09-01', spent: '90071992547409.92', revenue: '0.00', realized_profit: '-0.01', units_bought: 2, units_sold: 0,
  }] }));
  await page.route(API + '/api/v1/dashboard?*', route => route.fulfill({ json: {
    realized_profit: '90071992547409.91', roi: null, inventory_at_cost: '10.01', total_invested: '20.01',
    purchases_in_period: '0.29', cost_of_sales: '0.00', cost_written_off: '3.01', total_sales: '0.00',
    average_sale: null, units_in_stock: 1, sale_count: 0, sales_missing_cost: 0, undated_sales: 1,
    products_with_negative_stock: 0, net_proceeds: '5.00', fees_paid: '1.01', store_credit: '2.00',
    cash_received: '3.00', cash_balance: '-17.01',
    expenses: '1.00', expenses_by_category: [{ category: 'supplies', amount: '1.00' }], net_profit: '90071992547408.91',
    market_value: '12.00', priced_cost: '10.01', unrealized_gain: '1.99', priced_units: 1, stale_units: 1,
  } }));
  await signIn(page);
  await expect(page.getByText('$90,071,992,547,408.91', { exact: true })).toBeVisible();
  await expect(page.getByText('Expenses $1.00', { exact: true })).toBeVisible();
  await expect(page.getByText('Market value of stock', { exact: true })).toBeVisible();
  await expect(page.getByText('$12.00', { exact: true })).toBeVisible();
  await expect(page.getByText('$1.99', { exact: true })).toHaveCSS('color', 'rgb(116, 228, 179)');
  await expect(page.getByText('Priced 1 of 1 unit · 1 on stale quotes', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole('button', { name: 'Lifetime cash context', exact: true }).click();
  await expect(page.getByText('Bulk cost written off · lifetime, not cash', { exact: true })).toBeVisible();
  await expect(page.getByText('Store credit received · not cash', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sales insights', exact: true }).click();
  await expect(page.getByText('Where it sold', { exact: true })).toBeVisible();
  await expect(page.getByText('Fixture channel', { exact: true })).toBeVisible();
  await expect(page.getByText('$20.00 gross', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Recent sales', exact: true }).click();
  await page.getByRole('button', { name: 'Edit sale: Dashboard sale fixture', exact: true }).click();
  await expect(page.getByLabel('Total received', { exact: true })).toHaveValue('20.00');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Monthly trend', exact: true }).click();
  const trend = page.getByRole('group', { name: 'Monthly trading trend', exact: true });
  await expect(trend.getByText('Spent $90,071,992,547,409.92', { exact: true })).toBeVisible();
  await expect(trend.getByText('Revenue $0.00', { exact: true })).toBeVisible();
  await expect(trend.getByText('Realized profit -$0.01', { exact: true })).toBeVisible();
  // Signed figures carry the theme's gain/loss tones; costs stay neutral.
  await expect(trend.getByText('-$0.01', { exact: true })).toHaveCSS('color', 'rgb(255, 155, 166)');
  await expect(page.getByText('$90,071,992,547,408.91', { exact: true })).toHaveCSS('color', 'rgb(116, 228, 179)');
  await page.getByRole('button', { name: 'Period cost and trading', exact: true }).click();
  await expect(page.getByText('Expenses · Supplies', { exact: true })).toBeVisible();
  for (const width of [390, 768, 1536]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBeTruthy();
  }
  await page.getByRole('button', { name: 'Correct negative stock: Dashboard correction fixture', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/products/' + fixtureId + '$'));
});

test('photo suggestions preserve identity and manual input without creating inventory', async ({ page, request }) => {
  const games = await (await request.get(API + '/api/v1/games')).json();
  const types = await (await request.get(API + '/api/v1/product-types')).json();
  const created = await request.post(API + '/api/v1/products', { data: { name: 'Photo suggestion box', game_id: games[0].id,
    product_type_id: types.find((item: { slug: string }) => item.slug === 'booster-box').id,
    initial_purchase: { quantity: 1, amount: '10.01', funding: [] } } });
  expect(created.ok()).toBeTruthy();
  const product = await created.json();
  await page.route(API + '/api/v1/vision/status', route => route.fulfill({ json: { available: true, cards: [] } }));
  let uploads = 0;
  await page.route(API + '/api/v1/vision/cards', route => {
    uploads++;
    expect(route.request().headers()['content-type']).toContain('multipart/form-data; boundary=');
    expect(route.request().postDataBuffer()?.toString()).toContain('name="photo"');
    return route.fulfill({ json: { available: true, cards: [{ name: 'Photo card', set_name: 'Photo set',
      collector_number: '001/100', variant: 'Reverse Holo', language: 'Japanese' }] } });
  });
  let writes = 0;
  page.on('request', req => { if (req.method() === 'POST' && /\/products$|\/transformations\/rip$/.test(req.url())) writes++; });
  await signIn(page);
  await page.goto('/products/' + product.id);
  await openProductSections(page);
  await page.getByRole('button', { name: 'Rip open', exact: true }).click();
  await page.getByRole('textbox', { name: 'Hit 1 name', exact: true }).fill('Manual card retained');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose photos', exact: true }).click();
  await (await chooser).setFiles({ name: 'cards.png', mimeType: 'image/png', buffer: Buffer.from('fixture image') });
  await expect(page.getByRole('textbox', { name: 'Hit 2 name', exact: true })).toHaveValue('Photo card');
  await expect(page.getByRole('textbox', { name: 'Hit 1 name', exact: true })).toHaveValue('Manual card retained');
  await expect(page.getByRole('textbox', { name: 'Hit 2 Set', exact: true })).toHaveValue('Photo set');
  await expect(page.getByRole('textbox', { name: 'Hit 2 Collector number', exact: true })).toHaveValue('001/100');
  await expect(page.getByRole('textbox', { name: 'Hit 2 Variant', exact: true })).toHaveValue('Reverse Holo');
  await expect(page.getByRole('textbox', { name: 'Hit 2 Language', exact: true })).toHaveValue('Japanese');
  await expect(page.getByRole('textbox', { name: 'Hit 2 value', exact: true })).toHaveValue('');
  expect(uploads).toBe(1);
  expect(writes).toBe(0);
});
test('lineage retries independently and keeps deep trees readable without changing ledger cost', async ({ page, request }) => {
  const games = await (await request.get(API + '/api/v1/games')).json();
  const types = await (await request.get(API + '/api/v1/product-types')).json();
  const created = await request.post(API + '/api/v1/products', { data: { name: 'CSV lineage root', game_id: games[0].id,
    product_type_id: types.find((item: { slug: string }) => item.slug === 'single').id,
    initial_purchase: { quantity: 1, amount: '10.01', funding: [] } } });
  expect(created.ok()).toBeTruthy();
  const product = await created.json();
  let reads = 0;
  const tree = [{ product_id: product.id, product_name: 'Depth 1 fixture', depth: 1, quantity_produced: 1, cost: '10.01', children: [
    { product_id: product.id, product_name: 'Depth 2 fixture', depth: 2, quantity_produced: 1, cost: '10.01', children: [
      { product_id: product.id, product_name: 'Depth 3 fixture', depth: 3, quantity_produced: 1, cost: '0.00', children: [
        { product_id: product.id, product_name: 'Depth 4 fixture', depth: 4, quantity_produced: 1, cost: null, children: [] },
      ] },
    ] },
  ] }];
  await page.route(API + '/api/v1/reports/lineage/' + product.id, route => {
    reads++;
    return route.fulfill({ status: reads === 1 ? 403 : 200, contentType: 'application/json', body: JSON.stringify(reads === 1
      ? { detail: 'Lineage read test rejection' }
      : { product_id: product.id, product_name: product.name, cost: '10.01', realized_profit: '0.00', remaining_cost: '10.01',
        written_off: '0.00', roi: null, units_sold: 0, units_remaining: 1, tree }) });
  });
  await signIn(page);
  await page.goto('/products/' + product.id);
  await openProductSections(page);
  const lineage = page.getByRole('group', { name: 'Lineage report', exact: true });
  await expect(lineage.getByText('Lineage read test rejection', { exact: true })).toBeVisible();
  await lineage.getByRole('button', { name: 'Try again', exact: true }).click();
  const deepest = lineage.getByRole('group', { name: 'Lineage node: Depth 4 fixture', exact: true });
  await expect(deepest.getByText('Unknown', { exact: true })).toBeVisible();
  await expect(lineage.getByRole('group', { name: 'Lineage node: Depth 3 fixture', exact: true }).getByText('$0.00', { exact: true })).toBeVisible();
  for (const width of [390, 768, 1536]) {
    await page.setViewportSize({ width, height: 900 });
    const heading = deepest.getByRole('button', { name: 'Depth 4 fixture', exact: true });
    await heading.scrollIntoViewIfNeeded();
    await expect(heading).toBeInViewport();
    const box = await heading.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.screenshot({ path: 'output/playwright/expo-lineage-' + width + '.png', fullPage: true });
  }
  const after = await (await request.get(API + '/api/v1/products/' + product.id)).json();
  expect(after.stats.remaining_cost).toBe('10.01');
});
test('inventory CSV downloads every page and refuses a failed follow-up page', async ({ page }) => {
  let fail = false;
  const offsets: number[] = [];
  const rows = Array.from({ length: 201 }, (_, index) => ({ id: 'csv-product-' + index, name: 'CSV product ' + index,
    set_name: null, language: null, game: { name: 'Pokémon' }, product_type: { name: 'Single' },
    stats: { quantity_on_hand: 1, by_bucket: { inventory: 1, store: 0, vault: 0 }, average_unit_cost: '0.00', remaining_cost: '0.00', realized_profit: '0.00' } }));
  await page.route(API + '/api/v1/products?*', route => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 50);
    offsets.push(offset);
    if (fail && offset > 0) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ detail: 'Export page failure fixture' }) });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: rows.slice(offset, offset + limit), total: rows.length, offset, limit }) });
  });
  const downloads: string[] = [];
  page.on('download', download => downloads.push(download.suggestedFilename()));
  await signIn(page);
  if ((page.viewportSize()?.width ?? 1280) < 1000) await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Reports', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all inventory CSV', exact: true }).click();
  const download = await downloaded;
  const path = await download.path();
  const body = await readFile(path!, 'utf8');
  expect(body.startsWith('\ufeff"product"')).toBeTruthy();
  expect(body.split('\r\n')).toHaveLength(202);
  expect(body).toContain('"CSV product 200"');
  expect(offsets).toEqual([0, 200]);
  fail = true;
  await page.getByRole('button', { name: 'Export all inventory CSV', exact: true }).click();
  await expect(page.getByText('Export page failure fixture', { exact: true })).toBeVisible();
  expect(downloads).toHaveLength(1);
});
test('sales CSV keeps filters, all pages, unknown values and explicit zero', async ({ page }) => {
  const requests: URL[] = [];
  const rows = Array.from({ length: 201 }, (_, index) => ({ id: 'csv-sale-' + index, product_id: 'product',
    product: { id: 'product', name: index === 0 ? '=CSV formula fixture' : 'CSV sale fixture ' + index,
      set_name: null, language: null, game: { name: 'Pokémon' }, product_type: { name: 'Single' } },
    quantity: 1, amount: '1.00', platform_fees: '0.00', payment_fees: '0.00', shipping_paid: '0.00', net_proceeds: '1.00',
    cost_basis: index === 0 ? null : '0.00', realized_profit: index === 0 ? null : '0.00', has_unknown_cost: index === 0,
    days_held_weighted: index === 0 ? null : 0, sale_date: null, sold_by_member_id: null, marketplace: 'CSV channel', notes: null, status: 'active' }));
  await page.route(API + '/api/v1/sales?*', route => {
    const url = new URL(route.request().url());
    requests.push(url);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 50);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: rows.slice(offset, offset + limit), total: rows.length, offset, limit }) });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Sales', exact: true }).click();
  await page.getByLabel('Search by product', { exact: true }).fill('CSV sale fixture');
  await expect.poll(() => requests.some(url => url.searchParams.get('q') === 'CSV sale fixture')).toBeTruthy();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export sales CSV', exact: true }).click();
  const path = await (await downloaded).path();
  const body = await readFile(path!, 'utf8');
  const lines = body.split('\r\n');
  expect(lines).toHaveLength(202);
  expect(lines[1]).toContain('"\'=CSV formula fixture"');
  expect(lines[1].split(',').slice(14, 19)).toEqual(['""', '""', '""', '""', '""']);
  expect(lines[2].split(',').slice(14, 19)).toEqual(['"0.00"', '"0.00"', '"0.00"', '""', '"0"']);
  const exportRequests = requests.filter(url => url.searchParams.get('limit') === '200');
  expect(exportRequests.map(url => url.searchParams.get('offset'))).toEqual(['0', '200']);
  expect(exportRequests.every(url => url.searchParams.get('period') === '60d' && url.searchParams.get('q') === 'CSV sale fixture')).toBeTruthy();
});
test('Reports rollups show honest empty states without invented values', async ({ page }) => {
  for (const path of ['by-tier', 'by-set', 'aging']) {
    await page.route(API + '/api/v1/reports/' + path, route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  }
  await page.route(API + '/api/v1/reports/attention', route => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ sales_missing_cost: 0, products_with_negative_stock: 0, negative_stock_products: [] }) }));
  await signIn(page);
  if ((page.viewportSize()?.width ?? 1280) < 1000) await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Reports', exact: true }).click();
  for (const text of ['No tier sales yet.', 'No set holdings or sales yet.', 'No remaining purchase lots.', 'No data issues found.']) {
    await expect(page.getByText(text, { exact: true })).toBeVisible();
  }
});
test('Reports rollups separate realized returns from holdings and recover independently', async ({ page }) => {
  let tierReads = 0;
  const paths: URL[] = [];
  await page.route(API + '/api/v1/reports/by-tier', route => {
    paths.push(new URL(route.request().url()));
    tierReads++;
    return route.fulfill({ status: tierReads === 1 ? 403 : 200, contentType: 'application/json',
      body: JSON.stringify(tierReads === 1 ? { detail: 'Tier read test rejection' } : [{
        key: 'fixture-tier', label: 'Fixture tier', products_traded: 1, units_sold: 1,
        realized_profit: '0.00', cost_of_sales: '10.01', roi: 0, average_roi: null,
        best_roi: null, worst_roi: null, median_roi: null, avg_days_held: 0,
      }]) });
  });
  await page.route(API + '/api/v1/reports/by-set', route => {
    paths.push(new URL(route.request().url()));
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify([{
      set_id: '33333333-3333-4333-8333-333333333333', name: 'Fixture set holdings', game_slug: 'pokemon',
      units_sold: 1, realized_profit: '-0.01', cost_of_sales: '1.00', sold_roi: null,
      units_in_store: 2, store_cost: '90071992547409.91', oldest_store_days: null,
      units_in_vault: 3, vault_cost: '12.34',
    }]) });
  });
  await page.route(API + '/api/v1/reports/aging', route => {
    paths.push(new URL(route.request().url()));
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify([
      { purchase_id: 'lot-unknown', product_id: '44444444-4444-4444-8444-444444444444', product_name: 'Unknown age fixture', game_slug: 'pokemon', units: 1, cost: '0.00', purchase_date: null, days_held: null },
      { purchase_id: 'lot-zero', product_id: '55555555-5555-4555-8555-555555555555', product_name: 'Zero age fixture', game_slug: 'pokemon', units: 1, cost: '10.01', purchase_date: '2026-09-12', days_held: 0 },
    ]) });
  });
  await page.route(API + '/api/v1/reports/attention', route => {
    paths.push(new URL(route.request().url()));
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      sales_missing_cost: 2, products_with_negative_stock: 1,
      negative_stock_products: [{ id: '66666666-6666-4666-8666-666666666666', name: 'Negative stock fixture', quantity: -1 }],
    }) });
  });
  await signIn(page);
  if ((page.viewportSize()?.width ?? 1280) < 1000) await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Reports', exact: true }).click();
  await expect(page.getByText('Tier read test rejection', { exact: true })).toBeVisible();
  const set = page.getByRole('group', { name: 'Set: Fixture set holdings', exact: true });
  await expect(set.getByText('-$0.01', { exact: true })).toBeVisible();
  await expect(set.getByText('$90,071,992,547,409.91', { exact: true })).toBeVisible();
  await expect(set.getByText('$12.34', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  const tier = page.getByRole('group', { name: 'Tier: Fixture tier', exact: true });
  await expect(tier.getByText('$0.00', { exact: true })).toBeVisible();
  await expect(tier.getByText('0.0%', { exact: true })).toBeVisible();
  await expect(tier.getByText('Unknown', { exact: true }).first()).toBeVisible();
  const unknownAge = page.getByRole('group', { name: 'Aging lot: Unknown age fixture', exact: true });
  const zeroAge = page.getByRole('group', { name: 'Aging lot: Zero age fixture', exact: true });
  await expect(unknownAge.getByText('$0.00', { exact: true })).toBeVisible();
  await expect(unknownAge.getByText('Unknown age · no purchase date', { exact: true })).toBeVisible();
  await expect(zeroAge.getByText('$10.01', { exact: true })).toBeVisible();
  await expect(zeroAge.getByText('0d held · bought 2026-09-12', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Negative stock fixture', exact: true })).toBeVisible();
  await expect.poll(() => paths.length >= 5).toBeTruthy();
  expect(paths.every(url => url.search === '')).toBeTruthy();
  for (const width of [390, 768, 1536]) {
    await page.setViewportSize({ width, height: 900 });
    const setHeading = set.getByText('Fixture set holdings', { exact: true });
    await setHeading.scrollIntoViewIfNeeded();
    await expect(setHeading).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.screenshot({ path: 'output/playwright/expo-rollups-' + width + '.png', fullPage: true });
  }
});
test('Reports filters requests, preserves unknown and zero, and retries failed reads', async ({ page, request }) => {
  const games = await (await request.get(API + '/api/v1/games')).json();
  const types = await (await request.get(API + '/api/v1/product-types')).json();
  const game = games[0];
  const type = types.find((item: { slug: string }) => item.slug === 'single');
  const setId = '22222222-2222-4222-8222-222222222222';
  await page.route(API + '/api/v1/sets?*', route => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ items: [{ id: setId, game_id: game.id, name: 'Report fixture set', released_on: null, uses: 0 }], did_you_mean: null }) }));
  const base = { revenue: '0.00', cost_of_sales: '0.00', inventory_at_cost: '10.01',
    units_in_stock: 1, sale_count: 1, sales_missing_cost: 0, units_sold: 1, units_purchased: 2,
    units_by_age: { d0_30: 0, d31_90: 1, d91_180: 0, d180_plus: 0 } };
  let failed = false;
  const urls: URL[] = [];
  await page.route(API + '/api/v1/reports/by-*', route => {
    const url = new URL(route.request().url());
    // Dashboard now reads game performance too; inject this failure in Reports only.
    if (new URL(page.url()).pathname !== '/reports') return route.fulfill({ json: [] });
    if (url.pathname.endsWith('by-month')) return route.fulfill({ contentType: 'application/json', body: '[]' });
    urls.push(url);
    if (!failed) {
      failed = true;
      return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ detail: 'Report read test rejection' }) });
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify([
      { ...base, key: 'unknown', label: 'Unknown report fixture', realized_profit: '90071992547409.91', roi: null, avg_days_held: null, sell_through: null, profit_per_day: null },
      { ...base, key: 'zero', label: 'Zero report fixture', realized_profit: '0.00', roi: 0, avg_days_held: 0, sell_through: 0, profit_per_day: '0.00' },
    ]) });
  });
  await signIn(page);
  if ((page.viewportSize()?.width ?? 1280) < 1000) await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Reports', exact: true }).click();
  await expect(page.getByText('Report read test rejection', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  const unknown = page.getByRole('group', { name: 'Unknown report fixture', exact: true });
  const zero = page.getByRole('group', { name: 'Zero report fixture', exact: true });
  await expect(unknown.getByText('Unknown', { exact: true })).toHaveCount(4);
  await expect(unknown.getByText('$90,071,992,547,409.91', { exact: true })).toBeVisible();
  await expect(zero.getByText('0d', { exact: true })).toBeVisible();
  await expect(zero.getByText('0.0%', { exact: true })).toHaveCount(2);
  await expect(zero.getByText('$0.00', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Filter by game: All games', exact: true }).click();
  await page.getByRole('button', { name: game.name, exact: true }).click();
  await page.getByRole('button', { name: 'Filter by set: All sets', exact: true }).click();
  await page.getByRole('button', { name: 'Report fixture set', exact: true }).click();
  await page.getByRole('button', { name: 'Filter by product type: All types', exact: true }).click();
  await page.getByRole('button', { name: type.name, exact: true }).click();
  await page.getByRole('button', { name: 'Channel', exact: true }).click();
  await expect.poll(() => urls.some(url => url.pathname.endsWith('by-marketplace') &&
    url.searchParams.get('game_id') === game.id && url.searchParams.get('set_id') === setId &&
    url.searchParams.get('product_type_id') === type.id && url.searchParams.get('period') === '60d')).toBeTruthy();
  await page.getByRole('button', { name: 'Days held', exact: true }).click();
  await expect(page.getByRole('group').first()).toHaveAttribute('aria-label', 'Zero report fixture');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect.poll(() => urls.some(url => url.pathname.endsWith('by-marketplace') &&
    !url.searchParams.has('game_id') && !url.searchParams.has('set_id') && !url.searchParams.has('product_type_id'))).toBeTruthy();
  for (const width of [390, 768, 1536]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.screenshot({ path: 'output/playwright/expo-reports-' + width + '.png', fullPage: true });
  }
});
test('reporting period defaults to 60 days and stays shared across navigation and reload', async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole('button', { name: 'Reporting period: 60 days', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reporting period: 60 days', exact: true }).click();
  await page.getByRole('button', { name: '90 days', exact: true }).click();
  await page.getByRole('button', { name: 'Sales', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reporting period: 90 days', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reporting period: 90 days', exact: true }).click();
  await page.getByRole('button', { name: '30 days', exact: true }).click();
  if ((page.viewportSize()?.width ?? 1280) < 1000) await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Reports', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reporting period: 30 days', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reporting period: 30 days', exact: true })).toBeVisible();
  // The persistence assertion waits for AsyncStorage's asynchronous write before reload.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('tcg-tracking:period'))).toBe('30d');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Reporting period: 30 days', exact: true })).toBeVisible();
});
test('Vault keeps market quotes separate from unknown manual value and recovers from read errors', async ({ page }) => {
  const name = 'Vault quote separation fixture';
  let reads = 0;
  await page.route(API + '/api/v1/reports/vault', route => {
    reads++;
    return route.fulfill({ status: reads === 1 ? 403 : 200, contentType: 'application/json', body: JSON.stringify(reads === 1
      ? { detail: 'Vault report temporarily unavailable' }
      : [{ product_id: '11111111-1111-4111-8111-111111111111', product_name: name, units: 2, cost: '10.00',
        value: null, valued_on: null, days_since_valued: null, appreciation: null, appreciation_pct: null,
        annualised: null, days_held: 700, days_in_store_first: 30,
        market_estimate: { value: '99.99', captured_on: '2025-01-02', status: 'stale', provider: 'tcgcsv', source_revision: 'test' } }]) });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Vault', exact: true }).click();
  await expect(page.getByText('Vault report temporarily unavailable', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  const holding = page.getByRole('group', { name, exact: true });
  await expect(holding.getByText('Unknown', { exact: true }).first()).toBeVisible();
  await holding.getByRole('button', { name: 'Valuation details', exact: true }).click();
  await expect(holding.getByText('Not valued yet', { exact: true })).toBeVisible();
  await expect(holding.getByText('$99.99', { exact: true })).toBeVisible();
  await expect(holding.getByText('Stale', { exact: true })).toBeVisible();
  await expect(holding.getByText('tcgcsv', { exact: true })).toBeVisible();
  await page.getByLabel('Search Vault holdings', { exact: true }).fill('no matching holding');
  await expect(page.getByText('No Vault holdings match that search.', { exact: true })).toBeVisible();
  await page.getByLabel('Search Vault holdings', { exact: true }).fill('');
  for (const width of [390, 768, 1536]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(holding).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.screenshot({ path: 'output/playwright/expo-vault-' + width + '.png', fullPage: true });
  }
});
test('Vault manual valuations preserve zero, dated estimates and accounting for slabs', async ({ page, request }) => {
  const games = await (await request.get(API + '/api/v1/games')).json();
  const types = await (await request.get(API + '/api/v1/product-types')).json();
  const created = await request.post(API + '/api/v1/products', { data: {
    name: 'Expo manually valued Vault slabs', game_id: games[0].id,
    product_type_id: types.find((t: { slug: string }) => t.slug === 'graded-card').id,
    grading_company: 'PSA', grade: '10', cert_number: 'VAULT-042',
    initial_purchase: { quantity: 2, amount: '10.00', bucket: 'vault', funding: [] },
  } });
  expect(created.ok()).toBeTruthy();
  const product = await created.json();
  const readHolding = async () => (await (await request.get(API + '/api/v1/reports/vault')).json())
    .find((row: { product_id: string }) => row.product_id === product.id);
  expect((await readHolding()).value).toBeNull();
  await signIn(page);
  await page.getByRole('button', { name: 'Vault', exact: true }).click();
  const holding = page.getByRole('group', { name: product.name, exact: true });
  await expect(holding).toBeVisible();
  await expect(holding.getByText('Unknown', { exact: true }).first()).toBeVisible();
  await holding.getByRole('button', { name: 'Record valuation', exact: true }).click();
  await expect(page.getByLabel('Value per unit (CAD)', { exact: true })).toHaveValue('');
  await page.getByLabel('Value per unit (CAD)', { exact: true }).fill('19.99');
  await page.getByLabel('As at', { exact: true }).fill('2025-06-02');
  await page.getByLabel('Note', { exact: true }).fill('Manual slab estimate, no price feed');
  await page.route(API + '/api/v1/valuations', route => route.fulfill({ status: 409, contentType: 'application/json',
    body: JSON.stringify({ detail: 'Temporary valuation test rejection' }) }), { times: 1 });
  await page.getByRole('button', { name: 'Save valuation', exact: true }).click();
  await expect(page.getByText('Temporary valuation test rejection', { exact: true })).toBeVisible();
  expect((await readHolding()).value).toBeNull();
  const valuation = page.waitForRequest(r => r.method() === 'POST' && r.url() === API + '/api/v1/valuations');
  await page.getByRole('button', { name: 'Save valuation', exact: true }).click();
  expect((await valuation).postDataJSON()).toMatchObject({ product_id: product.id, value: '19.99', captured_on: '2025-06-02' });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await readHolding()).toMatchObject({ units: 2, value: '19.99', cost: '10.00', appreciation: '29.98', valued_on: '2025-06-02' });
  await expect(holding.getByText('$19.99', { exact: true }).first()).toBeVisible();
  // Zero is an explicit estimate, never "not valued"; the latest dated snapshot wins.
  await holding.getByRole('button', { name: 'Record valuation', exact: true }).click();
  await page.getByLabel('Value per unit (CAD)', { exact: true }).fill('0.00');
  await page.getByLabel('As at', { exact: true }).fill('2025-06-03');
  await page.getByRole('button', { name: 'Save valuation', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await readHolding()).toMatchObject({ value: '0.00', cost: '10.00', appreciation: '-10.00', valued_on: '2025-06-03' });
  const older = await request.post(API + '/api/v1/valuations', { data: {
    product_id: product.id, value: '99.99', captured_on: '2025-06-01', notes: 'Older estimate',
  } });
  expect(older.ok()).toBeTruthy();
  expect((await readHolding()).value).toBe('0.00');
  await page.goto('/products/' + product.id);
  await openProductSections(page);
  await expect(page.getByRole('button', { name: 'Record valuation', exact: true })).toBeVisible();
  await expect(page.getByText('Remaining cost $10.00', { exact: true })).toBeVisible();
  await expect(page.getByText('Realized profit $0.00', { exact: true })).toBeVisible();
  const after = await (await request.get(API + '/api/v1/products/' + product.id)).json();
  expect(after.stats.quantity_on_hand).toBe(2);
  expect(after.stats.remaining_cost).toBe('10.00');
  expect(after.stats.realized_profit).toBe('0.00');
});
test('grading can cancel an unreturned submission and reuse an existing graded product', async ({ page, request }) => {
  const games = await (await request.get(API + '/api/v1/games')).json();
  const types = await (await request.get(API + '/api/v1/product-types')).json();
  const create = async (name: string, slug: string) => {
    const response = await request.post(API + '/api/v1/products', { data: {
      name, game_id: games[0].id, product_type_id: types.find((t: { slug: string }) => t.slug === slug).id,
      ...(slug === 'single' ? { initial_purchase: { quantity: 1, amount: '10.29', funding: [] } }
        : { grading_company: 'PSA', grade: '10' }),
    } });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const source = await create('Expo existing-target raw card', 'single');
  const child = await create('Expo existing slab target', 'graded-card');
  const send = async () => {
    const response = await request.post(API + '/api/v1/grading', { data: { product_id: source.id, grading_company: 'PSA' } });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const cancelled = await send();
  await signIn(page);
  await page.goto('/products/' + source.id);
  await openProductSections(page);
  await page.getByRole('button', { name: 'Void grading submission', exact: true }).click();
  await page.getByLabel('Reason', { exact: true }).fill('Cancelled before shipment');
  await page.getByRole('button', { name: 'Cancel submission', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const rows = await (await request.get(API + '/api/v1/grading?product_id=' + source.id)).json();
  expect(rows.find((s: { id: string }) => s.id === cancelled.id).status).toBe('voided');
  await send();
  await page.reload();
  await openProductSections(page);
  await page.getByRole('button', { name: 'Record grading return', exact: true }).click();
  await page.getByLabel('Grade', { exact: true }).fill('10');
  await page.getByRole('button', { name: /^Graded card:/ }).click();
  await page.getByRole('button', { name: 'Use an existing graded card', exact: true }).click();
  await page.getByLabel('Find an existing graded card', { exact: true }).fill(child.name);
  await page.getByRole('button', { name: new RegExp('^' + child.name) }).click();
  let childCreates = 0;
  page.on('request', r => { if (r.method() === 'POST' && r.url() === API + '/api/v1/products') childCreates++; });
  await page.getByRole('button', { name: 'Record it', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(childCreates).toBe(0);
  const output = await (await request.get(API + '/api/v1/products/' + child.id)).json();
  expect(output.stats.remaining_cost).toBe('10.29');
  expect(output.stats.quantity_on_hand).toBe(1);
});
test('rip previews unsaved hits using FIFO and ignores late allocations without writing stock', async ({ page, request }) => {
  const games = await (await request.get(API + '/api/v1/games')).json();
  const types = await (await request.get(API + '/api/v1/product-types')).json();
  const created = await request.post(API + '/api/v1/products', { data: {
    name: 'Preview FIFO box', game_id: games[0].id,
    product_type_id: types.find((t: { slug: string }) => t.slug === 'booster-box').id,
    initial_purchase: { quantity: 1, amount: '10.01', purchase_date: '2025-01-01', funding: [] },
  } });
  expect(created.ok()).toBeTruthy();
  const source = await created.json();
  const bought = await request.post(API + '/api/v1/purchases', { data: {
    product_id: source.id, quantity: 1, amount: '100.00', purchase_date: '2025-01-02', funding: [],
  } });
  expect(bought.ok()).toBeTruthy();
  let childCreates = 0;
  page.on('request', r => { if (r.method() === 'POST' && r.url() === API + '/api/v1/products') childCreates++; });
  let releaseOld!: () => void;
  const oldGate = new Promise<void>(resolve => { releaseOld = resolve; });
  await page.route(API + '/api/v1/transformations/rip/preview', async route => {
    if (route.request().postDataJSON().hits[0]?.cost !== '3.00') return route.continue();
    const response = await route.fetch();
    await oldGate;
    await route.fulfill({ response });
  });
  await signIn(page);
  await page.goto('/products/' + source.id);
  await openProductSections(page);
  await page.getByRole('button', { name: 'Rip open', exact: true }).click();
  await page.getByLabel('Hit 1 name', { exact: true }).fill('Unsaved preview hit');
  await expect(page.getByText('Allocated cost: $10.01', { exact: true })).toBeVisible();
  const oldRequest = page.waitForRequest(r => r.url() === API + '/api/v1/transformations/rip/preview'
    && r.postDataJSON().hits[0]?.cost === '3.00');
  await page.getByLabel('Hit 1 cost override', { exact: true }).fill('3.00');
  await oldRequest;
  await page.getByLabel('Hit 1 cost override', { exact: true }).fill('4.00');
  await expect(page.getByText('Allocated cost: $4.00', { exact: true })).toBeVisible();
  const oldResponse = page.waitForResponse(r => r.url() === API + '/api/v1/transformations/rip/preview'
    && r.request().postDataJSON().hits[0]?.cost === '3.00');
  releaseOld();
  await oldResponse;
  await expect(page.getByText('Allocated cost: $4.00', { exact: true })).toBeVisible();
  await expect(page.getByText('Allocated cost: $3.00', { exact: true })).toHaveCount(0);
  expect(childCreates).toBe(0);
  const unchanged = await (await request.get(API + '/api/v1/products/' + source.id)).json();
  expect(unchanged.stats.quantity_on_hand).toBe(2);
  expect(unchanged.stats.remaining_cost).toBe('110.01');
  await page.getByRole('dialog', { name: 'Rip open — Preview FIFO box', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
});

test('manual rip retains confirmed identity after a rejected write and never invents profit', async ({ page, request }) => {
  const games = await (await request.get(API + '/api/v1/games')).json();
  const types = await (await request.get(API + '/api/v1/product-types')).json();
  const created = await request.post(API + '/api/v1/products', { data: {
    name: 'Expo rip box', game_id: games[0].id,
    product_type_id: types.find((t: { slug: string }) => t.slug === 'booster-box').id,
    initial_purchase: { quantity: 1, amount: '150.01', purchase_date: '2025-01-02', funding: [] },
  } });
  expect(created.ok()).toBeTruthy();
  const source = await created.json();
  await signIn(page);
  await page.goto('/products/' + source.id);
  await openProductSections(page);
  await page.getByRole('button', { name: 'Rip open', exact: true }).click();
  await page.getByLabel('Hit 1 name', { exact: true }).fill('Expo manually identified hit');
  await page.getByLabel('Hit 1 value', { exact: true }).fill('500.29');
  await page.getByLabel('Hit 1 quantity', { exact: true }).fill('2');
  await page.getByLabel('Hit 1 Set', { exact: true }).fill('Rip set');
  await page.getByLabel('Hit 1 Collector number', { exact: true }).fill('042');
  await page.getByLabel('Hit 1 Variant', { exact: true }).fill('Reverse holo');
  await page.getByLabel('Hit 1 Language', { exact: true }).fill('Japanese');
  await page.getByRole('button', { name: 'Create new product', exact: true }).click();
  let childCreates = 0;
  page.on('request', r => { if (r.method() === 'POST' && r.url() === API + '/api/v1/products') childCreates++; });
  const ripUrl = API + '/api/v1/transformations/rip';
  await page.route(ripUrl, route => route.fulfill({ status: 409, contentType: 'application/json',
    body: JSON.stringify({ detail: 'Temporary rip test rejection' }) }), { times: 1 });
  await page.getByRole('button', { name: 'Log the hits', exact: true }).click();
  await expect(page.getByText('Temporary rip test rejection', { exact: true })).toBeVisible();
  const ripping = page.waitForResponse(r => r.request().method() === 'POST' && r.url() === ripUrl);
  await page.getByRole('button', { name: 'Log the hits', exact: true }).click();
  const response = await ripping;
  expect(response.ok()).toBeTruthy();
  const transformation = await response.json();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(childCreates).toBe(1);
  expect(transformation.inherited_purchase_date).toBe('2025-01-02');
  const child = await (await request.get(API + '/api/v1/products/' + transformation.outputs[0].product_id)).json();
  expect(child).toMatchObject({ set_name: 'Rip set', collector_number: '042', variant: 'Reverse holo', language: 'Japanese' });
  expect(child.stats.remaining_cost).toBe('150.01');
  expect(child.stats.quantity_on_hand).toBe(2);
  expect(child.stats.realized_profit).toBe('0.00');
});
test('grading retains stock until return and carries exact fees plus card identity', async ({ page, request }) => {
  const games = await (await request.get(API + '/api/v1/games')).json();
  const types = await (await request.get(API + '/api/v1/product-types')).json();
  const created = await request.post(API + '/api/v1/products', { data: {
    name: 'Expo grading card', game_id: games[0].id,
    product_type_id: types.find((t: { slug: string }) => t.slug === 'single').id,
    set_name: 'Grading set', collector_number: '042', language: 'Japanese', variant: 'Foil',
    initial_purchase: { quantity: 1, amount: '560.01', purchase_date: '2025-01-02', funding: [] },
  } });
  expect(created.ok()).toBeTruthy();
  const source = await created.json();
  await signIn(page);
  await page.goto('/products/' + source.id);
  await openProductSections(page);
  await expect(page.getByRole('button', { name: 'Crack open', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Rip open', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Send to grading', exact: true }).click();
  await page.getByLabel('Grading, postage and insurance', { exact: true }).fill('30.29');
  await page.getByRole('button', { name: 'Send it', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('On hand 1', { exact: true })).toBeVisible();
  const readSubmissions = async () => (await request.get(API + '/api/v1/grading?product_id=' + source.id)).json();
  const submission = (await readSubmissions())[0];
  expect(submission.status).toBe('out');
  expect(submission.fees).toBe('30.29');
  await expect(page.getByRole('button', { name: 'Send to grading', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Record grading return', exact: true }).click();
  await page.getByLabel('Grade', { exact: true }).fill('10');
  await page.getByLabel('Cert number', { exact: true }).fill('CERT-EXPO-042');
  await page.getByLabel('Anything else it cost', { exact: true }).fill('0.29');
  await expect(page.getByLabel('Now called', { exact: true })).toHaveValue('Expo grading card — PSA 10');
  let childCreates = 0;
  page.on('request', r => { if (r.method() === 'POST' && r.url() === API + '/api/v1/products') childCreates++; });
  const returnUrl = API + '/api/v1/grading/' + submission.id + '/return';
  await page.route(returnUrl, route => route.fulfill({ status: 409, contentType: 'application/json',
    body: JSON.stringify({ detail: 'Temporary grading test rejection' }) }), { times: 1 });
  await page.getByRole('button', { name: 'Record it', exact: true }).click();
  await expect(page.getByText('Temporary grading test rejection', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry return', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(childCreates).toBe(1);
  expect((await readSubmissions())[0].status).toBe('returned');
  const transformations = await (await request.get(API + '/api/v1/transformations?product_id=' + source.id)).json();
  const transformation = transformations.find((t: { kind: string }) => t.kind === 'grade');
  expect(transformation.inherited_purchase_date).toBe('2025-01-02');
  const child = await (await request.get(API + '/api/v1/products/' + transformation.outputs[0].product_id)).json();
  expect(child.stats.remaining_cost).toBe('590.59');
  expect(child.stats.quantity_on_hand).toBe(1);
  expect(child).toMatchObject({ collector_number: '042', language: 'Japanese', variant: 'Foil', cert_number: 'CERT-EXPO-042', grade: '10' });
});
test('crack form validates the split and carries exact cost into inline-created boxes', async ({ page, request }) => {
  const games = await (await request.get(API + '/api/v1/games')).json();
  const types = await (await request.get(API + '/api/v1/product-types')).json();
  const created = await request.post(API + '/api/v1/products', { data: {
    name: 'Expo split case', game_id: games[0].id,
    product_type_id: types.find((t: { slug: string }) => t.slug === 'sealed-case').id,
    set_name: 'Journey set', language: 'English',
    initial_purchase: { quantity: 1, amount: '900.01', purchase_date: '2025-01-02', funding: [] },
  } });
  expect(created.ok()).toBeTruthy();
  const source = await created.json();
  await signIn(page);
  await page.goto('/products/' + source.id);
  await openProductSections(page);
  await page.getByRole('button', { name: 'Crack open', exact: true }).click();
  await page.getByLabel('Boxes per case', { exact: true }).fill('6');
  await page.getByLabel('Child name', { exact: true }).fill('Expo inline split boxes');
  await page.getByRole('textbox', { name: 'Store', exact: true }).fill('4');
  await page.getByRole('button', { name: 'Crack it open', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await (await request.get(API + '/api/v1/products/' + source.id)).json()).stats.quantity_on_hand).toBe(1);
  await page.getByRole('textbox', { name: 'Inventory', exact: true }).fill('1');
  await page.getByRole('textbox', { name: 'Vault', exact: true }).fill('1');
  let childCreates = 0;
  page.on('request', r => { if (r.method() === 'POST' && r.url() === API + '/api/v1/products') childCreates++; });
  await page.route(API + '/api/v1/transformations/crack', route => route.fulfill({
    status: 409, contentType: 'application/json', body: JSON.stringify({ detail: 'Temporary crack test rejection' }),
  }), { times: 1 });
  const creation = page.waitForRequest(r => r.method() === 'POST' && r.url() === API + '/api/v1/products');
  await page.getByRole('button', { name: 'Crack it open', exact: true }).click();
  expect((await creation).postDataJSON().initial_purchase).toBeUndefined();
  await expect(page.getByText('Temporary crack test rejection', { exact: true })).toBeVisible();
  const cracking = page.waitForResponse(r => r.request().method() === 'POST' && r.url() === API + '/api/v1/transformations/crack');
  await page.getByRole('button', { name: 'Crack it open', exact: true }).click();
  const response = await cracking;
  expect(response.ok()).toBeTruthy();
  expect(childCreates).toBe(1);
  const transformed = await response.json();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(transformed.inherited_purchase_date).toBe('2025-01-02');
  const child = await (await request.get(API + '/api/v1/products/' + transformed.outputs[0].product_id)).json();
  expect(child.stats.by_bucket).toMatchObject({ inventory: 1, store: 4, vault: 1 });
  expect(child.stats.remaining_cost).toBe('900.01');
  expect(child.set_name).toBe('Journey set');
  expect(child.language).toBe('English');
  expect(child.product_type.slug).toBe('booster-box');
});
test('transformation history links outputs and reverses the whole cost chain', async ({ page, request }) => {
  const games = await (await request.get(API + '/api/v1/games')).json();
  const types = await (await request.get(API + '/api/v1/product-types')).json();
  const create = async (name: string, slug: string, purchase = false) => {
    const response = await request.post(API + '/api/v1/products', { data: {
      name, game_id: games[0].id, product_type_id: types.find((t: { slug: string }) => t.slug === slug).id,
      ...(purchase ? { initial_purchase: { quantity: 1, amount: '900.01', purchase_date: '2025-01-02', funding: [] } } : {}),
    } });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const source = await create('Expo lineage case', 'sealed-case', true);
  const child = await create('Expo lineage boxes', 'booster-box');
  const response = await request.post(API + '/api/v1/transformations/crack', { data: {
    product_id: source.id, quantity: 1, occurred_on: '2026-01-02',
    outputs: [{ product_id: child.id, quantity: 4, bucket: 'store' }, { product_id: child.id, quantity: 2, bucket: 'vault' }],
  } });
  expect(response.ok()).toBeTruthy();
  const transformation = await response.json();
  expect(transformation.inherited_purchase_date).toBe('2025-01-02');
  await signIn(page);
  await page.goto('/products/' + source.id);
  await openProductSections(page);
  const history = page.getByRole('group', { name: 'Transformation ' + transformation.id, exact: true });
  await expect(history.getByText('Inherited purchase date 2025-01-02 · Bulk write-off $0.00', { exact: true })).toBeVisible();
  await history.getByRole('button', { name: 'Output: ' + child.name, exact: true }).first().click();
  await openProductSections(page);
  await expect(page.getByText('Remaining cost $900.01', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo crack', exact: true }).click();
  await page.getByLabel('Reason', { exact: true }).fill('Reverse complete case opening');
  await page.getByRole('button', { name: 'Undo transformation', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Remaining cost $0.00', { exact: true })).toBeVisible();
  const restored = await (await request.get(API + '/api/v1/products/' + source.id)).json();
  expect(restored.stats.quantity_on_hand).toBe(1);
  expect(restored.stats.remaining_cost).toBe('900.01');
  const output = await (await request.get(API + '/api/v1/products/' + child.id)).json();
  expect(output.stats.quantity_on_hand).toBe(0);
});
test('money adjustments use exact cents and transfer void restores both balances', async ({ page, request }) => {
  await signIn(page);
  if ((page.viewportSize()?.width ?? 1280) < 1000) await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Money', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Money', exact: true })).toBeVisible();
  const readAccounts = async () => (await request.get(API + '/api/v1/money/accounts')).json();
  const before = await readAccounts();
  const joint = before.items.find((a: { kind: string }) => a.kind === 'joint');
  const member = before.items.find((a: { name: string }) => a.name === 'E2E Tester');
  const cents = (s: string) => BigInt(s.replace('.', ''));
  await page.getByRole('group', { name: joint.name, exact: true }).getByRole('button', { name: 'Adjust', exact: true }).click();
  await page.getByLabel('How much', { exact: true }).fill('19.99');
  await page.getByLabel('Audit note', { exact: true }).fill('Expo exact-cent adjustment');
  const adjustment = page.waitForRequest(r => r.method() === 'POST' && r.url() === API + '/api/v1/money/adjustments');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  expect((await adjustment).postDataJSON().amount).toBe(1999);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const adjusted = await readAccounts();
  expect(cents(adjusted.joint_balance)).toBe(cents(before.joint_balance) + 1999n);
  await page.getByRole('group', { name: joint.name, exact: true }).getByRole('button', { name: 'Move money', exact: true }).click();
  await page.getByRole('button', { name: /^Into:/ }).click();
  await page.getByRole('button', { name: member.name + ' · Partner owed', exact: true }).click();
  await page.getByLabel('How much', { exact: true }).fill('0.29');
  await page.getByLabel('Note', { exact: true }).fill('Expo transfer reversal');
  await page.getByRole('button', { name: 'Move it', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const moved = await readAccounts();
  expect(cents(moved.joint_balance)).toBe(cents(adjusted.joint_balance) - 29n);
  expect(cents(moved.total_owed)).toBe(cents(adjusted.total_owed) - 29n);
  await page.getByRole('group', { name: 'Expo transfer reversal', exact: true }).getByRole('button', { name: 'Void', exact: true }).click();
  await page.getByLabel('Reason', { exact: true }).fill('Reverse test transfer');
  await page.getByRole('dialog').getByRole('button', { name: 'Void it', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const restored = await readAccounts();
  expect(restored.joint_balance).toBe(adjusted.joint_balance);
  expect(restored.total_owed).toBe(adjusted.total_owed);
  await page.getByRole('group', { name: 'Expo exact-cent adjustment', exact: true }).getByRole('button', { name: 'Void', exact: true }).click();
  await page.getByLabel('Reason', { exact: true }).fill('Reverse test adjustment');
  await page.getByRole('dialog').getByRole('button', { name: 'Void it', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await readAccounts()).joint_balance).toBe(before.joint_balance);
});
test('an expense takes two fields from Add, pays from joint and lowers net profit', async ({ page, request }) => {
  await signIn(page);
  const board = async () => (await request.get(API + '/api/v1/dashboard?period=all')).json();
  const cents = (s: string) => BigInt(s.replace('.', ''));
  const before = await board();
  if ((page.viewportSize()?.width ?? 1280) < 1000) await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: (page.viewportSize()?.width ?? 1280) < 1000 ? 'Add expense' : 'New expense', exact: true }).click();
  await page.getByLabel('How much', { exact: true }).fill('12.34');
  await page.getByRole('button', { name: 'Shipping supplies', exact: true }).click();
  const created = page.waitForResponse(r => r.request().method() === 'POST' && r.url() === API + '/api/v1/money/expenses');
  await page.getByRole('button', { name: 'Save expense', exact: true }).click();
  const response = await created;
  const sent = response.request().postDataJSON();
  expect(sent.category).toBe('shipping_supplies');
  expect(sent.amount).toBe('12.34');
  expect(sent.occurred_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(sent.paid_from).toHaveLength(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const after = await board();
  expect(cents(after.net_profit)).toBe(cents(before.net_profit) - 1234n);
  expect(after.realized_profit).toBe(before.realized_profit);
  const { id } = await response.json();
  expect((await request.post(API + '/api/v1/money/movements/' + id + '/void', { data: { reason: 'e2e cleanup' } })).ok()).toBeTruthy();
  expect((await board()).net_profit).toBe(before.net_profit);
});

test('common actions sit one tap from where they are needed', async ({ page, request }) => {
  const games = await (await request.get(API + '/api/v1/games')).json();
  const types = await (await request.get(API + '/api/v1/product-types')).json();
  const name = 'Tap trim box ' + Date.now();
  const box = await (await request.post(API + '/api/v1/products', { data: {
    name, game_id: games[0].id, product_type_id: types.find((t: { slug: string }) => t.slug === 'booster-box').id,
    initial_purchase: { quantity: 1, amount: '50.00', purchase_date: '2025-01-01', funding: [] },
  } })).json();
  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(page);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Rip a box', exact: true }).click();
  await page.getByLabel('Find a box or pack', { exact: true }).fill(name);
  await page.getByRole('button', { name: `Rip ${name} · 1 in stock`, exact: true }).click();
  const rip = page.getByRole('dialog', { name: 'Rip open — ' + name, exact: true });
  await expect(rip).toBeVisible();
  await rip.getByRole('button', { name: 'Close', exact: true }).click();

  await page.goto('/products/' + box.id);
  await expect(page.getByRole('button', { name: 'Add purchase', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rip open', exact: true })).toBeVisible();

  const missing = 'Nothing like this ' + Date.now();
  await page.goto('/inventory');
  await page.getByLabel('Search products', { exact: true }).fill(missing);
  await page.getByRole('button', { name: `Add "${missing}"`, exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(missing);
});

test('sale preview, store-credit proceeds and void preserve server money and stock', async ({ page, request }) => {
  const games = await (await request.get(API + '/api/v1/games')).json();
  const types = await (await request.get(API + '/api/v1/product-types')).json();
  const created = await request.post(API + '/api/v1/products', { data: {
    name: 'Expo sale journey', game_id: games[0].id, product_type_id: types[0].id,
    initial_purchase: { quantity: 2, amount: '100.00', bucket: 'inventory' },
  } });
  expect(created.ok()).toBeTruthy();
  const product = await created.json();
  await signIn(page);
  await page.goto('/products/' + product.id);
  await openProductSections(page);
  await page.getByRole('button', { name: 'Record sale', exact: true }).click();
  await page.getByLabel('Total received', { exact: true }).fill('80.00');
  await page.getByLabel('Platform fees', { exact: true }).fill('5.00');
  await page.getByRole('button', { name: /^Money went to:/ }).click();
  await page.getByRole('button', { name: /Store credit/, exact: false }).click();
  await page.getByLabel('Store holding the credit', { exact: true }).fill('Expo test shop');
  await expect(page.getByText('Net proceeds', { exact: true })).toBeVisible();
  const saleResponse = page.waitForResponse(r => r.request().method() === 'POST' && r.url() === API + '/api/v1/sales');
  await page.getByRole('dialog', { name: /^Record sale/ }).getByRole('button', { name: 'Record sale', exact: true }).click();
  expect((await saleResponse).ok()).toBeTruthy();
  await expect(page.getByRole('dialog', { name: /^Record sale/ })).toHaveCount(0);
  await expect(page.getByText('On hand 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Realized profit $25.00', { exact: true })).toBeVisible();
  const accountsAfterSale = await (await request.get(API + '/api/v1/money/accounts')).json();
  expect(accountsAfterSale.items.find((a: { name: string }) => a.name === 'Expo test shop').balance).toBe('75.00');
  await page.getByRole('button', { name: 'Sales', exact: true }).click();
  const filteredSales = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/sales'
    && new URL(response.url()).searchParams.get('q') === 'Expo sale journey');
  await page.getByLabel('Search by product', { exact: true }).fill('Expo sale journey');
  await filteredSales;
  await expect(page.getByRole('button', { name: 'Void', exact: true })).toHaveCount(1);
  await expect(page.getByText('Expo sale journey', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Void', exact: true }).click();
  await page.getByLabel('Reason', { exact: true }).fill('Sale reversed in test');
  await page.getByRole('button', { name: 'Void transaction', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const restored = await (await request.get(API + '/api/v1/products/' + product.id)).json();
  expect(restored.stats.quantity_on_hand).toBe(2);
  expect(restored.stats.remaining_cost).toBe('100.00');
  expect(restored.stats.realized_profit).toBe('0.00');
  const accountsAfterVoid = await (await request.get(API + '/api/v1/money/accounts')).json();
  expect(accountsAfterVoid.items.find((a: { name: string }) => a.name === 'Expo test shop').balance).toBe('0.00');
});
test('product, purchase, move and audited reversal preserve exact server totals', async ({ page, request }) => {
  await signIn(page);
  await page.getByRole('button', { name: (page.viewportSize()?.width ?? 1280) >= 1000 ? 'Inventory' : 'Stock', exact: true }).click();
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  const availableGames = await (await request.get(API + '/api/v1/games')).json();
  const setsResponse = await request.get(API + '/api/v1/sets?game=' + availableGames[0].slug);
  expect(setsResponse.ok()).toBeTruthy();
  const knownSets = await setsResponse.json();
  expect(knownSets.items.length).toBeGreaterThan(0);
  await page.getByRole('dialog', { name: 'Add product', exact: true }).getByRole('button', { name: knownSets.items[0].name, exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Expo mutation journey');
  await page.getByLabel('Quantity', { exact: true }).fill('2');
  await page.getByLabel('Total paid', { exact: true }).fill('83.33');
  await page.getByRole('button', { name: 'Show optional details', exact: true }).click();
  await page.getByLabel('Shipping', { exact: true }).fill('1.00');
  await page.getByLabel('Collector number', { exact: true }).fill('042');
  await page.getByLabel('Variant', { exact: true }).fill('Foil');
  await page.getByRole('button', { name: /^Paid from:/ }).click();
  await page.getByRole('button', { name: 'No account recorded', exact: true }).click();
  const beforeUnfundedPurchase = await (await request.get(API + '/api/v1/money/accounts')).json();
  const creation = page.waitForRequest(r => r.method() === 'POST' && r.url() === API + '/api/v1/products');
  await page.getByRole('button', { name: 'Save product', exact: true }).click();
  expect((await creation).postDataJSON().initial_purchase.funding).toEqual([]);
  await expect(page.getByRole('heading', { name: 'Add product', exact: true })).toHaveCount(0);
  const afterUnfundedPurchase = await (await request.get(API + '/api/v1/money/accounts')).json();
  expect(afterUnfundedPurchase.total_owed).toBe(beforeUnfundedPurchase.total_owed);
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]+$/);
  await openProductSections(page);
  await expect(page.getByText('Remaining cost $84.33', { exact: true })).toBeVisible();
  const productId = new URL(page.url()).pathname.split('/').pop()!;
  const readProduct = async () => (await request.get(API + '/api/v1/products/' + productId)).json();
  expect((await readProduct()).collector_number).toBe('042');
  expect((await readProduct()).set_name).toBe(knownSets.items[0].name);
  await page.getByRole('button', { name: 'Edit product', exact: true }).click();
  await page.getByLabel('Variant', { exact: true }).fill('Reverse holo');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Edit/ })).toHaveCount(0);
  expect((await readProduct()).variant).toBe('Reverse holo');
  await page.getByRole('button', { name: 'Add purchase', exact: true }).click();
  await page.getByLabel('Quantity', { exact: true }).fill('1');
  await page.getByLabel('Total paid', { exact: true }).fill('10.00');
  await page.getByRole('button', { name: 'Save purchase', exact: true }).click();
  await expect(page.getByText('Remaining cost $94.33', { exact: true })).toBeVisible();
  await expect(page.getByText('On hand 3', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Move stock', exact: true }).click();
  await page.getByLabel('How many', { exact: true }).fill('1');
  await page.getByRole('dialog', { name: /^Move stock/ }).getByRole('button', { name: 'Move stock', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Move stock/ })).toHaveCount(0);
  expect((await readProduct()).stats.by_bucket).toMatchObject({ inventory: 2, store: 1, vault: 0 });
  await expect(page.getByText('Remaining cost $94.33', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Void move', exact: true }).click();
  await page.getByLabel('Reason', { exact: true }).fill('Wrong shelf in test');
  await page.getByRole('button', { name: 'Void transaction', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Void move', exact: true })).toHaveCount(0);
  const restored = await readProduct();
  expect(restored.stats.by_bucket).toMatchObject({ inventory: 3, store: 0, vault: 0 });
  expect(restored.stats.remaining_cost).toBe('94.33');
  expect(restored.history.find((row: { kind: string }) => row.kind === 'move').status).toBe('voided');
  await page.getByRole('button', { name: 'Edit purchase', exact: true }).first().click();
  await page.getByLabel('Total paid', { exact: true }).fill('20.00');
  await page.getByLabel('Why the change?', { exact: true }).fill('Receipt correction in test');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Remaining cost $104.33', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Adjust stock', exact: true }).click();
  await page.getByLabel('Change', { exact: true }).fill('-1');
  await page.getByRole('button', { name: 'Save adjustment', exact: true }).click();
  await expect(page.getByText('On hand 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Void adjustment', exact: true }).click();
  await page.getByLabel('Reason', { exact: true }).fill('Count verified in test');
  await page.getByRole('button', { name: 'Void transaction', exact: true }).click();
  await expect(page.getByText('On hand 3', { exact: true })).toBeVisible();
  await expect(page.getByText('Remaining cost $104.33', { exact: true })).toBeVisible();
});
const API = 'http://127.0.0.1:8101';
async function firebaseFixture(page: Page) {
  const now=Math.floor(Date.now()/1000);
  const token=[{alg:'none'}, {sub:'e2e-user',user_id:'e2e-user',iat:now,exp:now+3600,auth_time:now,email:'e2e@example.test',aud:'test-firebase-project'}]
    .map(part=>Buffer.from(JSON.stringify(part)).toString('base64url')).join('.')+'.test-signature';
  await page.route('https://identitytoolkit.googleapis.com/**', async route=>{
    const lookup=route.request().url().includes(':lookup');
    await route.fulfill({contentType:'application/json',body:JSON.stringify(lookup
      ? {users:[{localId:'e2e-user',email:'e2e@example.test',emailVerified:true,providerUserInfo:[]}]}
      : {localId:'e2e-user',email:'e2e@example.test',idToken:token,refreshToken:'test-refresh',expiresIn:'3600',registered:true})});
  });
  await page.route('https://securetoken.googleapis.com/**', async route=>route.fulfill({contentType:'application/json',
    body:JSON.stringify({id_token:token,access_token:token,refresh_token:'test-refresh',expires_in:'3600',user_id:'e2e-user',token_type:'Bearer'})}));
}
async function openProductSections(page: Page) {
  for (const title of ['Manage product', 'Market pricing', 'Rip, crack and grading', 'Cost lineage', 'Transaction history']) {
    const toggle = page.getByRole('button', { name: title, exact: true });
    await expect(toggle).toBeVisible();
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  }
}

async function signIn(page: Page) {
  await firebaseFixture(page);await page.goto('/');
  await page.getByLabel('Email',{exact:true}).fill('e2e@example.test');
  await page.getByLabel('Password',{exact:true}).fill('test-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('button',{name:'Account',exact:true})).toBeVisible();
}
test('bundled font failures fall back to readable text without blocking authentication', async ({ page }) => {
  let attemptedFonts = 0;
  await page.route('**/*.ttf', route => { attemptedFonts++; return route.abort(); });
  await signIn(page);
  await expect(page.getByLabel('Main navigation', { exact: true }).getByRole('button', { name: 'Dashboard', exact: true })).toBeEnabled();
  expect(attemptedFonts).toBeGreaterThan(0);
});

test('session restoration and signout use the real Firebase SDK; API membership gates the dashboard',async({page})=>{
  await signIn(page);
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Account',exact:true}).click();
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
});
test('a signed-in user denied membership cannot open product or dashboard data',async({page})=>{
  const protectedReads:string[]=[];
  page.on('request',request=>{if(request.url().startsWith(API+'/api/v1/dashboard'))protectedReads.push(request.url());});
  await page.route(API+'/api/v1/members/me',route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({detail:'Not a member of this store'})}));
  await signIn(page);
  await expect(page.getByText('Not a member of this store',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toHaveCount(0);
  expect(protectedReads).toEqual([]);
});
for(const width of [390,768,1536]) {
  test('inventory and deep-linked product history at '+width+'px',async({page,request})=>{
    await page.setViewportSize({width,height:900});
    const games=await (await request.get(API+'/api/v1/games')).json();
    const types=await (await request.get(API+'/api/v1/product-types')).json();
    const name='Expo parity card '+width;
    const created=await request.post(API+'/api/v1/products',{data:{name,game_id:games[0].id,
      product_type_id:types.find((t:{slug:string})=>t.slug==='raw-single'||t.slug==='single').id,
      collector_number:'042',language:'English',variant:'Foil',
      initial_purchase:{quantity:2,amount:'83.33',bucket:'inventory'}}});
    expect(created.ok()).toBeTruthy();
    await signIn(page);
    await page.getByLabel('Main navigation', { exact: true }).getByRole('button',{name:width >= 1000 ? 'Inventory' : 'Stock',exact:true}).click();
    const filtered = page.waitForResponse(r => {
      const url = new URL(r.url());
      return url.pathname === '/api/v1/products' && url.searchParams.get('q') === name;
    });
    await page.getByLabel('Search products',{exact:true}).fill(name);
    const response = await filtered;
    expect(response.ok()).toBeTruthy();
    const matches = (await response.json()).items as { name: string }[];
    await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
    // Search deliberately includes fuzzy matches; compare rendered matches to the API,
    // rather than incorrectly requiring an exact-name-only result.
    await expect(page.getByRole('button',{name:/^Expo parity card \d+$/})).toHaveCount(
      matches.filter(item => /^Expo parity card \d+$/.test(item.name)).length);
    await expect(page.getByRole('button',{name:'Expo mutation journey',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
    await page.screenshot({ path: 'output/playwright/expo-inventory-' + width + '.png', fullPage: true });
    await page.getByRole('button',{name,exact:true}).click();
    await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
    await expect(page.getByText('Remaining cost $83.33',{exact:true})).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  });
}
