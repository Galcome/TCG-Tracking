import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequest, ApiError, SessionChangedError, isWorthRetrying, type TransportResponse } from '../lib/transport.ts';
import { createSessionGuard } from '../lib/session.ts';
import { createApi } from '../lib/api.ts';
const ok = (body: unknown): TransportResponse => ({ ok: true, status: 200, statusText: 'OK', json: async () => body });
test('fresh ID token on every request; callers cannot override Authorization', async () => {
  const headers: unknown[] = []; let count = 0;
  const request = createRequest({ baseUrl: 'https://api.example.test/', isCurrent: () => true,
    getIdToken: async () => 'token-' + (++count), transport: async (url, init) => {
      assert.equal(url, 'https://api.example.test/api/v1/members/me'); headers.push(init.headers); return ok({id:'member'});
    } });
  await request('/api/v1/members/me', { headers: {Authorization: 'wrong'} });
  await request('/api/v1/members/me');
  assert.deepEqual(headers.map(h=>(h as Record<string,string>).Authorization), ['Bearer token-1', 'Bearer token-2']);
});
test('missing token does not reach the server', async () => {
  const request = createRequest({baseUrl:'https://example.test',isCurrent:()=>true,getIdToken:async()=>null,transport:async()=>{throw Error('must not send');}});
  await assert.rejects(request('/api/v1/members/me'), (e: unknown)=>e instanceof ApiError&&e.status===401);
});
test('switching accounts during token refresh prevents the write', async () => {
  const guard=createSessionGuard(); const isCurrent=guard.update('first');
  const request=createRequest({baseUrl:'https://example.test',isCurrent,getIdToken:async()=>{guard.update('second');return 'first-token';},
    transport:async()=>{throw Error('must not send');}});
  await assert.rejects(request('/api/v1/products',{method:'POST',body:'{}'}),SessionChangedError);
});
test('late response from prior account is rejected even after switching back', async () => {
  const guard=createSessionGuard(); const isCurrent=guard.update('first');
  const request=createRequest({baseUrl:'https://example.test',isCurrent,getIdToken:async()=>'token',
    transport:async()=>{guard.update('second');guard.update('first');return ok({secret:'old data'});}});
  await assert.rejects(request('/api/v1/products'),SessionChangedError);
});
test('a signout while JSON is decoding also rejects old account data', async () => {
  const guard=createSessionGuard(); const isCurrent=guard.update('first');
  const request=createRequest({baseUrl:'https://example.test',isCurrent,getIdToken:async()=>'token',
    transport:async()=>({...ok(null),json:async()=>{guard.invalidate();return {id:'old'};}})});
  await assert.rejects(request('/api/v1/products'),SessionChangedError);
});
test('multipart upload does not force JSON Content-Type and keeps the adapter body', async () => {
  const body={opaque:'native or browser form'}; let called=false;
  const request=createRequest({baseUrl:'https://example.test',isCurrent:()=>true,getIdToken:async()=>'token',
    transport:async(_, options)=>{called=true;assert.equal(options.body,body);assert.equal(options.headers?.['Content-Type'],undefined);return ok({cards:[]});}});
  await createApi(request).readCards(body);assert.ok(called);
});
test('HTTP validation, membership errors and empty responses remain distinguishable', async () => {
  for(const [status,detail] of [[403,'Not a member'],[422,[{msg:'Quantity must be positive'}]]] as const) {
    const request=createRequest({baseUrl:'https://example.test',isCurrent:()=>true,getIdToken:async()=>'token',
      transport:async()=>({ok:false,status,statusText:'Failed',json:async()=>({detail})})});
    await assert.rejects(request('/api/v1/products'),(e:unknown)=>e instanceof ApiError && e.status===status && !isWorthRetrying(e));
  }
  const request=createRequest({baseUrl:'https://example.test',isCurrent:()=>true,getIdToken:async()=>'token',
    transport:async()=>({ok:true,status:204,statusText:'',json:async()=>{throw Error('no body');}})});
  assert.equal(await request('/api/v1/products/1'),undefined);
  assert.ok(isWorthRetrying(new ApiError(503,'Unavailable')));
  assert.ok(!isWorthRetrying(new SessionChangedError()));
});
test('product payload money stays a decimal string and search is safely encoded', async () => {
  const calls: {path:string;body?:unknown}[]=[];
  const api=createApi(async <T>(path:string,options={})=>{
    calls.push({path,body:(options as {body?:unknown}).body});return {remaining_cost:'90071992547409.91'} as T;
  });
  await api.createProduct({name:'Card',game_id:'game',product_type_id:'single',initial_purchase:{quantity:1,amount:'90071992547409.91'}});
  assert.equal(JSON.parse(calls[0].body as string).initial_purchase.amount,'90071992547409.91');
  await api.products({q:'A&B 日本',offset:30,limit:30});
  assert.match(calls[1].path,/q=A%26B%20/);assert.match(calls[1].path,/offset=30/);
});
