import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { authRoute, session } from '../src/auth.js';
import { fixture, testDb, transaction } from './helpers.js';
import { commitSnapshot, loadSnapshot } from '../src/storage.js';
import { executeFinance } from '../src/finance.js';

async function setup() {
  const env = { DB: testDb(), APP_ORIGIN: 'http://127.0.0.1:8787', APP_ENV: 'local', LOCAL_DEV_LOGIN: 'true',
    DEBT_PAYMENTS_ENABLED: 'false', ASSETS: { fetch: async request => new Response('synthetic asset: ' + new URL(request.url).pathname) } };
  const response = await authRoute(new Request(env.APP_ORIGIN + '/auth/local', { method: 'POST', headers: { Origin: env.APP_ORIGIN } }), env);
  const cookie = response.headers.get('Set-Cookie').split(';')[0];
  const auth = await session(new Request(env.APP_ORIGIN, { headers: { Cookie: cookie } }), env);
  function request(path, body, key = 'synthetic-000000001', headers = {}) {
    return new Request(env.APP_ORIGIN + path, { method: body ? 'POST' : 'GET', headers: {
      Cookie: cookie, Origin: env.APP_ORIGIN, 'X-CSRF-Token': auth.csrf_token, 'Content-Type': 'application/json',
      'Idempotency-Key': key, ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  return { env, request };
}
test('all ledger and export endpoints reject unauthenticated access', async () => {
  const { env } = await setup();
  for (const path of ['/api/session','/api/export','/api/reconcile','/api/rpc']) {
    const response = await worker.fetch(new Request(env.APP_ORIGIN + path), env);
    assert.equal(response.status, 401);
  }
  assert.equal((await worker.fetch(new Request(env.APP_ORIGIN), env)).status, 302);
  assert.equal((await worker.fetch(new Request(env.APP_ORIGIN + '/login'), env)).status, 200);
  assert.equal((await worker.fetch(new Request(env.APP_ORIGIN + '/cloud.css'), env)).status, 200);
});
test('RPC allowlist and CSRF reject calls without changing the database', async () => {
  const { env, request } = await setup();
  assert.equal((await worker.fetch(request('/api/rpc', { method: 'ss_', args: [] }), env)).status, 404);
  assert.equal((await worker.fetch(request('/api/rpc', { method: 'getBootstrap', args: [] }, undefined, { 'X-CSRF-Token': 'wrong' }), env)).status, 403);
  assert.equal((await loadSnapshot(env.DB)).revision, 0);
});
test('company categories and old company forms cannot write through the Finance browser API', async () => {
  const { env, request } = await setup();
  const initial = fixture();
  const categories = initial.tables['หมวดหมู่'].rows;
  categories.push({ ...categories[0], _row: categories.length + 3, category_id: 'JOB', category_name: 'ติดตั้งเครื่อง งานศาล 3260' });
  const old = executeFinance(initial, 'saveTransaction', [transaction({ expense_owner: 'COMPANY' })]);
  const recurring = executeFinance(old.snapshot, 'createRecurring', [transaction({ expense_owner: 'COMPANY', recurring_name: 'บริษัทจำลอง', start_date: '2026-11-03', due_day: 3 })]);
  await commitSnapshot(env.DB, await loadSnapshot(env.DB), recurring.snapshot, 'seed-company', 'seed-company', {});
  const before = await loadSnapshot(env.DB);
  const recurringId = before.tables['รายการประจำ'].rows[0].recurring_id;
  const calls = [
    ['saveTransaction', [transaction({ expense_owner: 'COMPANY' })]],
    ['saveTransaction', [transaction({ transaction_type: 'INCOME', category_id: 'JOB' })]],
    ['saveTransaction', [transaction({ transaction_type: 'INCOME', category_id: 'RF' })]],
    ['updateTransaction', [old.result.id, { amount: 20 }]],
    ['voidTransaction', [old.result.id, 'ทดสอบ']],
    ['payRecurring', [{ recurring_id: recurringId }]],
    ['createCategory', [{ category_group: 'OFFICE', category_name: 'หมวดจำลอง' }]],
    ['createCompanyProject', ['งานจำลอง']],
  ];
  for (const [i, [method, args]] of calls.entries()) {
    const response = await worker.fetch(request('/api/rpc', { method, args }, `synthetic-company-${i}`), env);
    assert.equal(response.status, 409, method);
    assert.equal((await response.json()).code, 'COMPANY_SOURCE_REQUIRED');
  }
  const bootstrap = await (await worker.fetch(request('/api/rpc', { method: 'getBootstrap', args: [] }), env)).json();
  assert.deepEqual(bootstrap.categories.filter(item => item.company_only).map(item => item.category_id).sort(), ['JOB','RF']);
  assert.equal(bootstrap.company, undefined);
  assert.deepEqual(await loadSnapshot(env.DB), before);
  assert.equal((await worker.fetch(request('/api/rpc', { method: 'saveTransaction', args: [transaction({})] }), env)).status, 200);
});
test('end-to-end API creates account once and returns no-store protected results', async () => {
  const { env, request } = await setup();
  const body = { method: 'createAccount', args: [{ account_name: 'บัญชีจำลอง', account_type: 'BANK', opening_balance: '500.25', opening_date: '2026-11-03', include_in_available: true }] };
  const first = await worker.fetch(request('/api/rpc', body), env);
  assert.equal(first.status, 200); assert.equal(first.headers.get('Cache-Control'), 'no-store');
  assert.equal(first.headers.get('X-Frame-Options'), 'DENY');
  const result = await first.json(); assert.equal(result.dashboard.real_cash, 500.25);
  assert.deepEqual(await (await worker.fetch(request('/api/rpc', body), env)).json(), result);
  const current = await loadSnapshot(env.DB); assert.equal(current.tables['บัญชี'].rows.length, 1);
  assert.equal(current.tables['รายการเงิน'].rows.length, 0);
  const backup = await (await worker.fetch(request('/api/export'), env)).json();
  assert.equal(backup.format, 'finance-sheets-v1'); assert.equal(backup.expected.cash_cents, 50025);
});
test('import preview is read-only and commit requires matching source totals', async () => {
  const { env, request } = await setup();
  const payload = { format: 'finance-sheets-v1', time_zone: 'Asia/Bangkok', tables: {} };
  const response = await worker.fetch(request('/api/import/preview', { export: payload }), env);
  assert.equal(response.status, 200);
  const plan = await response.json(); assert.equal(plan.snapshot, undefined);
  assert.equal((await loadSnapshot(env.DB)).revision, 0);
  const commit = await worker.fetch(request('/api/import/commit', { export: payload, confirm_digest: plan.digest, expected_revision: plan.revision }), env);
  assert.equal(commit.status, 409);
});
