import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { authRoute, session, sha256 } from '../src/auth.js';
import { fixture, testDb, transaction } from './helpers.js';
import { commitSnapshot, loadSnapshot } from '../src/storage.js';
import { executeFinance } from '../src/finance.js';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { PDFDocument } from 'pdf-lib';

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

test('reports export the displayed filter, separate transfers, and reject stale or unauthenticated requests', async () => {
  const { env, request } = await setup();
  env.COMPANY_LEDGER = { fetch: async () => Response.json({ owner: { id: 'owner' }, entries: [], refs: [] }) };
  const font = await readFile(new URL('../public/Sarabun-Regular.ttf', import.meta.url));
  env.ASSETS = { fetch: async () => new Response(font) };
  let snapshot = fixture();
  for (const entry of [
    transaction({ transaction_type: 'INCOME', category_id: 'IN', amount: 100 }),
    transaction({ amount: 3.25, description: '=1+1 & อาหาร' }),
    transaction({ transaction_type: 'TRANSFER', to_account_id: 'ACC2', amount: 15 }),
    transaction({ status: 'DRAFT', amount: 99 }),
    transaction({ transaction_date: '2026-10-31', amount: 25 }),
  ]) snapshot = executeFinance(snapshot, 'saveTransaction', [entry]).snapshot;
  await commitSnapshot(env.DB, await loadSnapshot(env.DB), snapshot, 'seed-report', 'seed-report', {});
  const before = await loadSnapshot(env.DB);
  const filters = { month: '2026-11' };
  const list = await (await worker.fetch(request('/api/rpc', { method: 'getDisplayTransactions', args: [filters] }), env)).json();
  assert.equal(list.length, 4);
  const digest = await sha256(JSON.stringify(list));
  const path = '/api/transactions/report';
  const body = { format: 'xlsx', filters, digest };
  assert.equal((await worker.fetch(new Request(env.APP_ORIGIN + path, { method: 'POST' }), env)).status, 401);
  assert.equal((await worker.fetch(request(path, body, undefined, { 'X-CSRF-Token': 'wrong' }), env)).status, 403);
  const stale = await worker.fetch(request(path, { ...body, filters: { month: '2026-10' } }), env);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'REPORT_VIEW_CHANGED');
  const xlsx = await worker.fetch(request(path, body), env);
  assert.equal(xlsx.status, 200);
  assert.equal(xlsx.headers.get('Cache-Control'), 'no-store');
  const files = unzipSync(new Uint8Array(await xlsx.arrayBuffer()));
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.match(sheet, /<autoFilter ref="A5:H9"\/>/);
  assert.match(sheet, /<c r="E10" s="5"><f>ROUND\(SUM\(E6:E9\),2\)<\/f><v>100<\/v>/);
  assert.match(sheet, /<c r="F10" s="5">[^<]*<f>[^<]*<\/f><v>3\.25<\/v>/);
  assert.match(sheet, /<c r="G10" s="5">[^<]*<f>[^<]*<\/f><v>15<\/v>/);
  assert.match(sheet, /<v>96\.75<\/v>/);
  assert.match(sheet, /=1\+1 &amp; อาหาร/);
  assert.match(sheet, /ฉบับร่าง/);
  assert.doesNotMatch(sheet, /<f>=1\+1|<v>99<\/v>|<v>25<\/v>/);
  const pdf = await worker.fetch(request(path, { ...body, format: 'pdf' }), env);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('Content-Type'), 'application/pdf');
  const doc = await PDFDocument.load(await pdf.arrayBuffer());
  assert.equal(doc.getPageCount(), 1);
  assert.ok(Math.abs(doc.getPage(0).getWidth() - 595.28) < 0.01);
  assert.deepEqual(await loadSnapshot(env.DB), before);
});
