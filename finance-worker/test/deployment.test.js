import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDeployTarget } from '../scripts/deployment-plan.mjs';

const id = '11111111-2222-4333-8444-555555555555';
const env = { CLOUDFLARE_ACCOUNT_ID: '1'.repeat(32), CLOUDFLARE_API_TOKEN: 'synthetic-credential' };
const config = () => ({ name: 'finance-aaa-preview', vars: { APP_ID: 'finance-aaa-preview', AUTH_MODE: 'public', APP_ENV: 'preview',
  APP_ORIGIN: 'https://finance-aaa-preview.example.workers.dev' }, d1_databases: [{ binding: 'DB', database_name: 'finance-aaa-preview', database_id: id }] });
function fake(worker, database = { uuid: id, name: 'finance-aaa-preview' }) {
  return async url => url.includes('/d1/database/') ? Response.json({ success: true, result: database })
    : worker === null ? new Response('', { status: 404 }) : Response.json({ success: true, result: worker });
}
test('deployment checks a new Worker against the explicitly selected D1 database', async () => {
  const plan = await validateDeployTarget(config(), env, fake(null));
  assert.equal(plan.newWorker, true); assert.equal(plan.worker, 'finance-aaa-preview');
});
test('deployment accepts only an existing Finance Worker bound to its own database', async () => {
  const worker = { bindings: [{ name: 'APP_ID', type: 'plain_text', text: 'finance-aaa-preview' }, { name: 'DB', type: 'd1', id }] };
  assert.equal((await validateDeployTarget(config(), env, fake(worker))).newWorker, false);
  worker.bindings[0].text = 'another-application';
  await assert.rejects(validateDeployTarget(config(), env, fake(worker)), /Existing resources were preserved/);
});
test('deployment refuses a database belonging to another application and an origin for another Worker', async () => {
  await assert.rejects(validateDeployTarget(config(), env, fake(null, { uuid: id, name: 'another-db' })), /intended Finance/);
  const wrong = config(); wrong.vars.APP_ORIGIN = 'https://another-worker.example.workers.dev';
  await assert.rejects(validateDeployTarget(wrong, env, fake(null)), /origin/);
});
test('missing permissions are not treated as an absent Worker and no resources are changed', async () => {
  const methods = [];
  await assert.rejects(validateDeployTarget(config(), env, async (url, options) => {
    methods.push(options.method || 'GET');
    return url.includes('/d1/database/') ? Response.json({ success: true, result: { uuid: id, name: 'finance-aaa-preview' } })
      : Response.json({ success: false }, { status: 403 });
  }), /verification failed/);
  assert.ok(methods.every(method => method === 'GET'));
});
