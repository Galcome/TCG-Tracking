import { test, expect, type Page } from '@playwright/test';
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
  await page.getByRole('button', { name: 'Void grading submission', exact: true }).click();
  await page.getByLabel('Reason', { exact: true }).fill('Cancelled before shipment');
  await page.getByRole('button', { name: 'Cancel submission', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const rows = await (await request.get(API + '/api/v1/grading?product_id=' + source.id)).json();
  expect(rows.find((s: { id: string }) => s.id === cancelled.id).status).toBe('voided');
  await send();
  await page.reload();
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
  await page.getByRole('button', { name: 'Crack open', exact: true }).click();
  await page.getByLabel('Boxes per case', { exact: true }).fill('6');
  await page.getByLabel('Child name', { exact: true }).fill('Expo inline split boxes');
  await page.getByLabel('Store', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Crack it open', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await (await request.get(API + '/api/v1/products/' + source.id)).json()).stats.quantity_on_hand).toBe(1);
  await page.getByRole('textbox', { name: 'Inventory', exact: true }).fill('1');
  await page.getByLabel('Vault', { exact: true }).fill('1');
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
  const history = page.getByRole('group', { name: 'Transformation ' + transformation.id, exact: true });
  await expect(history.getByText('Inherited purchase date 2025-01-02 · Bulk write-off $0.00', { exact: true })).toBeVisible();
  await history.getByRole('button', { name: 'Output: ' + child.name, exact: true }).first().click();
  await expect(page.getByText('Cost $900.01', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo crack', exact: true }).click();
  await page.getByLabel('Reason', { exact: true }).fill('Reverse complete case opening');
  await page.getByRole('button', { name: 'Undo transformation', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Cost $0.00', { exact: true })).toBeVisible();
  const restored = await (await request.get(API + '/api/v1/products/' + source.id)).json();
  expect(restored.stats.quantity_on_hand).toBe(1);
  expect(restored.stats.remaining_cost).toBe('900.01');
  const output = await (await request.get(API + '/api/v1/products/' + child.id)).json();
  expect(output.stats.quantity_on_hand).toBe(0);
});
test('money adjustments use exact cents and transfer void restores both balances', async ({ page, request }) => {
  await signIn(page);
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
  await expect(page.getByText('On hand 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Profit $25.00', { exact: true })).toBeVisible();
  const accountsAfterSale = await (await request.get(API + '/api/v1/money/accounts')).json();
  expect(accountsAfterSale.items.find((a: { name: string }) => a.name === 'Expo test shop').balance).toBe('75.00');
  await page.getByRole('button', { name: 'Sales', exact: true }).click();
  await page.getByLabel('Search by product', { exact: true }).fill('Expo sale journey');
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
  await page.getByRole('button', { name: 'Inventory', exact: true }).click();
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  const availableGames = await (await request.get(API + '/api/v1/games')).json();
  const setsResponse = await request.get(API + '/api/v1/sets?game=' + availableGames[0].slug);
  expect(setsResponse.ok()).toBeTruthy();
  const knownSets = await setsResponse.json();
  expect(knownSets.items.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Find a set', exact: true }).click();
  await page.getByRole('dialog', { name: 'Choose a set', exact: true }).getByRole('button', { name: knownSets.items[0].name, exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Expo mutation journey');
  await page.getByLabel('Quantity', { exact: true }).fill('2');
  await page.getByLabel('Total paid', { exact: true }).fill('83.33');
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
  await page.getByLabel('Search products', { exact: true }).fill('Expo mutation journey');
  await page.getByRole('button', { name: 'Expo mutation journey', exact: true }).click();
  await expect(page.getByText('Cost $84.33', { exact: true })).toBeVisible();
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
  await expect(page.getByText('Cost $94.33', { exact: true })).toBeVisible();
  await expect(page.getByText('On hand 3', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Move stock', exact: true }).click();
  await page.getByLabel('How many', { exact: true }).fill('1');
  await page.getByRole('dialog', { name: /^Move stock/ }).getByRole('button', { name: 'Move stock', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Move stock/ })).toHaveCount(0);
  expect((await readProduct()).stats.by_bucket).toMatchObject({ inventory: 2, store: 1, vault: 0 });
  await expect(page.getByText('Cost $94.33', { exact: true })).toBeVisible();
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
  await expect(page.getByText('Cost $104.33', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Adjust stock', exact: true }).click();
  await page.getByLabel('Change', { exact: true }).fill('-1');
  await page.getByRole('button', { name: 'Save adjustment', exact: true }).click();
  await expect(page.getByText('On hand 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Void adjustment', exact: true }).click();
  await page.getByLabel('Reason', { exact: true }).fill('Count verified in test');
  await page.getByRole('button', { name: 'Void transaction', exact: true }).click();
  await expect(page.getByText('On hand 3', { exact: true })).toBeVisible();
  await expect(page.getByText('Cost $104.33', { exact: true })).toBeVisible();
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
async function signIn(page: Page) {
  await firebaseFixture(page);await page.goto('/');
  await page.getByLabel('Email',{exact:true}).fill('e2e@example.test');
  await page.getByLabel('Password',{exact:true}).fill('test-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
}
test('session restoration and signout use the real Firebase SDK; API membership gates the dashboard',async({page})=>{
  await signIn(page);
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
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
    await page.getByRole('button',{name:'Inventory',exact:true}).click();
    await page.getByLabel('Search products',{exact:true}).fill(name);
    await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Expo mutation journey',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
    await page.screenshot({ path: 'output/playwright/expo-inventory-' + width + '.png', fullPage: true });
    await page.getByRole('button',{name,exact:true}).click();
    await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
    await expect(page.getByText('Cost $83.33',{exact:true})).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  });
}
