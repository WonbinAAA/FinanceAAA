import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('uncertain HTTP 500 retains the original request ID for a safe user retry', async () => {
  const saved = new Map(), ids = []; let attempts = 0;
  const context = vm.createContext({ window: {}, crypto, TextEncoder, Response, document: { querySelector: () => null, getElementById: () => null },
    sessionStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) },
    fetch: async (path, init) => {
      if (path === '/api/session') return Response.json({ csrf_token: 'synthetic-csrf' });
      ids.push(init.headers['Idempotency-Key']); attempts++;
      return attempts === 1 ? Response.json({ error: 'uncertain result', code: 'INTERNAL_ERROR' }, { status: 500 }) : Response.json({ ok: true });
    } });
  vm.runInContext(readFileSync(new URL('../public/cloud.js', import.meta.url), 'utf8'), context);
  await assert.rejects(context.window.financeRpc('saveTransaction', [{ amount: '1.01' }]));
  assert.equal(saved.size, 1);
  assert.equal((await context.window.financeRpc('saveTransaction', [{ amount: '1.01' }])).ok, true);
  assert.equal(ids[0], ids[1]); assert.equal(saved.size, 0);
});
