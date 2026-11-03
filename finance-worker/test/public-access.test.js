import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import worker from '../src/worker.js';
import { testDb } from './helpers.js';
import { loadSnapshot } from '../src/storage.js';

function setup() {
  const env = { DB: testDb(), APP_ORIGIN: 'https://finance-aaa-preview.example.workers.dev', APP_ENV: 'preview',
    AUTH_MODE: 'public', DEBT_PAYMENTS_ENABLED: 'true', ASSETS: { fetch: async () => new Response('public finance app') } };
  const url = path => env.APP_ORIGIN + path;
  async function visitor() {
    const response = await worker.fetch(new Request(url('/api/session')), env);
    assert.equal(response.status, 200);
    const body = await response.json(), cookie = response.headers.get('Set-Cookie')?.split(';')[0];
    return { body, cookie, response,
      request: (path, data, key = crypto.randomUUID(), headers = {}) => new Request(url(path), {
        method: data ? 'POST' : 'GET', headers: { Cookie: cookie, Origin: env.APP_ORIGIN, 'Content-Type': 'application/json',
          'X-CSRF-Token': body.csrf_token, 'Idempotency-Key': key, ...headers }, ...(data ? { body: JSON.stringify(data) } : {}) }) };
  }
  return { env, url, visitor };
}
test('public pages open without login or Google credentials and old login URLs return to the app', async () => {
  const { env, url } = setup();
  for (const path of ['/', '/migration', '/app.js', '/styles.css']) assert.equal((await worker.fetch(new Request(url(path)), env)).status, 200);
  const oldLogin = await worker.fetch(new Request(url('/login')), env);
  assert.equal(oldLogin.status, 302); assert.equal(oldLogin.headers.get('Location'), '/');
  for (const path of ['/auth/google', '/auth/callback', '/auth/local']) assert.equal((await worker.fetch(new Request(url(path)), env)).status, 404);
});
test('anonymous session needs no identity and creates no financial records', async () => {
  const { env, visitor } = setup(), first = await visitor(), second = await visitor();
  assert.equal(first.body.public_access, true);
  assert.equal(first.body.email, undefined);
  assert.notEqual(first.body.csrf_token, second.body.csrf_token);
  assert.match(first.response.headers.get('Set-Cookie'), /HttpOnly; SameSite=Lax.*Secure/);
  assert.ok(Object.values((await loadSnapshot(env.DB)).tables).every(table => table.rows.length === 0));
});
test('all visitors share the owner-approved public ledger; cash is written once', async () => {
  const { env, visitor } = setup(), first = await visitor(), second = await visitor();
  const account = await worker.fetch(first.request('/api/rpc', { method: 'createAccount', args: [{ account_name: 'บัญชีจำลอง', account_type: 'BANK',
    opening_balance: '100.25', opening_date: '2026-11-04', include_in_available: true }] }), env);
  assert.equal(account.status, 200);
  const accountId = (await account.json()).id;
  const body = { method: 'saveTransaction', args: [{ transaction_date: '2026-11-04', transaction_type: 'EXPENSE', account_id: accountId,
    category_id: 'CAT-EXPENSE', amount: '0.01', expense_owner: 'PERSONAL', description: 'รายการจำลองในหน่วยความจำ' }] };
  const key = crypto.randomUUID();
  const saved = await (await worker.fetch(first.request('/api/rpc', body, key), env)).json();
  const replay = await (await worker.fetch(second.request('/api/rpc', body, key), env)).json();
  assert.equal(replay.id, saved.id);
  const bootstrap = await worker.fetch(second.request('/api/rpc', { method: 'getBootstrap', args: [] }), env);
  assert.equal((await bootstrap.json()).dashboard.real_cash, 100.24);
  assert.equal((await loadSnapshot(env.DB)).tables['รายการเงิน'].rows.length, 1);
  const backup = await worker.fetch(second.request('/api/export'), env);
  assert.equal(backup.status, 200);
});
test('public writes still require same-origin JSON requests, CSRF and idempotency keys', async () => {
  const { env, visitor } = setup(), user = await visitor(), body = { method: 'getBootstrap', args: [] };
  assert.equal((await worker.fetch(user.request('/api/rpc', body, undefined, { Origin: 'https://another.example' }), env)).status, 403);
  assert.equal((await worker.fetch(user.request('/api/rpc', body, undefined, { 'X-CSRF-Token': 'wrong' }), env)).status, 403);
  assert.equal((await worker.fetch(user.request('/api/rpc', body, undefined, { 'Content-Type': 'text/plain' }), env)).status, 415);
  assert.equal((await loadSnapshot(env.DB)).revision, 0);
});
test('an expired anonymous session renews automatically and preserves pending write receipts', async () => {
  const { env, visitor } = setup(), first = await visitor();
  const body = { method: 'createAccount', args: [{ account_name: 'บัญชีทดสอบ', account_type: 'CASH', opening_balance: '0',
    opening_date: '2026-11-04', include_in_available: true }] }, key = crypto.randomUUID();
  const saved = await (await worker.fetch(first.request('/api/rpc', body, key), env)).json();
  await env.DB.prepare('DELETE FROM auth_sessions').run();
  assert.equal((await worker.fetch(first.request('/api/rpc', body, key), env)).status, 401);
  const renewed = await visitor();
  assert.deepEqual(await (await worker.fetch(renewed.request('/api/rpc', body, key), env)).json(), saved);
  assert.equal((await loadSnapshot(env.DB)).tables['บัญชี'].rows.length, 1);
});
test('browser renews public sessions without redirecting to login or changing the request ID', async () => {
  const pending = new Map(), ids = []; let sessionCount = 0, writeCount = 0, redirects = 0;
  const context = vm.createContext({ window: {}, crypto, TextEncoder, Response,
    document: { querySelector: () => null, getElementById: () => null }, location: { assign: () => { redirects++; } },
    sessionStorage: { getItem: key => pending.get(key), setItem: (key,value) => pending.set(key,value), removeItem: key => pending.delete(key) },
    fetch: async (path, init) => {
      if (path === '/api/session') return Response.json({ csrf_token: 'csrf-' + (++sessionCount), public_access: true });
      ids.push(init.headers['Idempotency-Key']);
      return ++writeCount === 1 ? Response.json({ code: 'SESSION_EXPIRED' }, { status: 401 }) : Response.json({ ok: true });
    } });
  vm.runInContext(readFileSync(new URL('../public/cloud.js', import.meta.url), 'utf8'), context);
  assert.equal((await context.window.financeRpc('saveTransaction', [{ amount: '0.01' }])).ok, true);
  assert.equal(sessionCount, 2); assert.equal(redirects, 0); assert.equal(ids[0], ids[1]); assert.equal(pending.size, 0);
});
