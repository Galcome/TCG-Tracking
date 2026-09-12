import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, type GroupBy } from '../lib/api.ts';
import { createRequest } from '../lib/transport.ts';

test('grouped reports send the selected period and catalogue filters for every grouping', async () => {
  const urls: URL[] = [];
  const request = createRequest({
    baseUrl: 'https://api.example.test', isCurrent: () => true,
    getIdToken: async () => 'test-token',
    transport: async url => {
      urls.push(new URL(url));
      return { ok: true, status: 200, statusText: 'OK', json: async () => [] };
    },
  });
  const api = createApi(request);
  const groups: GroupBy[] = ['game', 'product', 'product-type', 'set-performance', 'marketplace', 'seller'];
  for (const group of groups) {
    await api.group(group, '90d', { game_id: 'game-1', set_id: 'set-1', product_type_id: 'type-1' });
  }
  urls.forEach((url, index) => {
    assert.equal(url.pathname, `/api/v1/reports/by-${groups[index]}`);
    assert.equal(url.searchParams.get('period'), '90d');
    assert.equal(url.searchParams.get('game_id'), 'game-1');
    assert.equal(url.searchParams.get('set_id'), 'set-1');
    assert.equal(url.searchParams.get('product_type_id'), 'type-1');
  });
});

test('report reads preserve exact monetary strings, explicit zero and unknown values', async () => {
  const rows = [{ key: 'fixture', label: 'Fixture', realized_profit: '90071992547409.91',
    cost_of_sales: '0.00', roi: null, profit_per_day: null, avg_days_held: 0 }];
  const request = createRequest({
    baseUrl: 'https://api.example.test', isCurrent: () => true,
    getIdToken: async () => 'test-token',
    transport: async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => rows }),
  });
  assert.deepEqual(await createApi(request).group('game', '60d'), rows);
});
