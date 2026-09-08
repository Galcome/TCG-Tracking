import { test, expect, type Page } from '@playwright/test';
test('product, purchase, move and audited reversal preserve exact server totals', async ({ page, request }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Inventory', exact: true }).click();
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Expo mutation journey');
  await page.getByLabel('Quantity', { exact: true }).fill('2');
  await page.getByLabel('Total paid', { exact: true }).fill('83.33');
  await page.getByLabel('Shipping', { exact: true }).fill('1.00');
  await page.getByLabel('Collector number', { exact: true }).fill('042');
  await page.getByLabel('Variant', { exact: true }).fill('Foil');
  await page.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add product', exact: true })).toHaveCount(0);
  await page.getByLabel('Search products', { exact: true }).fill('Expo mutation journey');
  await page.getByRole('button', { name: 'Expo mutation journey', exact: true }).click();
  await expect(page.getByText('Cost $84.33', { exact: true })).toBeVisible();
  const productId = new URL(page.url()).pathname.split('/').pop()!;
  const readProduct = async () => (await request.get(API + '/api/v1/products/' + productId)).json();
  expect((await readProduct()).collector_number).toBe('042');
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
    await page.getByRole('button',{name,exact:true}).click();
    await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
    await expect(page.getByText('Cost $83.33',{exact:true})).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  });
}
