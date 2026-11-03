import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySnapshot } from '../src/schema.js';
import { createLegacyEngine } from '../src/legacy-engine.js';
import { loadSnapshot, commitSnapshot, receipt } from '../src/storage.js';
import { fixture, options, testDb, transaction } from './helpers.js';

async function seeded() {
  const db = testDb(), base = await loadSnapshot(db);
  await commitSnapshot(db, base, fixture(), 'seed-000000000000', 'seed', { ok: true });
  return db;
}
test('D1 stores exact money and original IDs, row order and timestamps', async () => {
  const db = await seeded(), snapshot = await loadSnapshot(db);
  assert.equal(snapshot.tables['บัญชี'].rows[0].account_id, 'ACC1');
  assert.equal(snapshot.tables['บัญชี'].rows[0]._row, 3);
  const row = await db.prepare('SELECT money_json FROM ledger_records WHERE table_name = ? AND record_id = ?').bind('บัญชี','ACC1').first();
  assert.equal(JSON.parse(row.money_json).opening_balance, 1000001);
});
test('transaction and audit commit atomically with receipt', async () => {
  const db = await seeded(), before = await loadSnapshot(db), engine = createLegacyEngine(before, options());
  const result = engine.api.saveTransaction(transaction());
  await commitSnapshot(db, before, engine.snapshot(), 'write-00000000001', 'hash1', result);
  const loaded = await loadSnapshot(db);
  assert.equal(loaded.tables['รายการเงิน'].rows.length, 1);
  assert.equal(loaded.tables['ประวัติการแก้ไข'].rows.length, 1);
  assert.deepEqual(await receipt(db, 'write-00000000001', 'hash1'), result);
});
test('stale concurrent writes roll back every row and audit', async () => {
  const db = await seeded(), before = await loadSnapshot(db);
  const first = createLegacyEngine(before, options()), second = createLegacyEngine(before, options());
  const a = first.api.saveTransaction(transaction({ amount: 1 })), b = second.api.saveTransaction(transaction({ amount: 2 }));
  await commitSnapshot(db, before, first.snapshot(), 'write-00000000001', 'a', a);
  await assert.rejects(commitSnapshot(db, before, second.snapshot(), 'write-00000000002', 'b', b), error => error.code === 'REVISION_CONFLICT');
  const loaded = await loadSnapshot(db);
  assert.equal(loaded.tables['รายการเงิน'].rows.length, 1);
  assert.equal(loaded.tables['รายการเงิน'].rows[0].amount, 1);
  assert.equal(loaded.tables['ประวัติการแก้ไข'].rows.length, 1);
  assert.equal(await receipt(db, 'write-00000000002', 'b'), null);
});
test('network replay returns same receipt without adding money twice', async () => {
  const db = await seeded(), before = await loadSnapshot(db), engine = createLegacyEngine(before, options());
  const result = engine.api.saveTransaction(transaction());
  await commitSnapshot(db, before, engine.snapshot(), 'write-00000000001', 'same', result);
  assert.deepEqual(await commitSnapshot(db, before, engine.snapshot(), 'write-00000000001', 'same', result), result);
  assert.equal((await loadSnapshot(db)).tables['รายการเงิน'].rows.length, 1);
  await assert.rejects(receipt(db, 'write-00000000001', 'different'), error => error.code === 'IDEMPOTENCY_CONFLICT');
});
test('failure after transaction insert rolls back ledger, revision and receipt', async () => {
  const db = await seeded(), before = await loadSnapshot(db), engine = createLegacyEngine(before, options());
  const result = engine.api.saveTransaction(transaction());
  const after = engine.snapshot();
  // Force a UNIQUE source-row failure after the transaction write in the batch.
  after.tables['ประวัติการแก้ไข'].rows.push({ ...after.tables['ประวัติการแก้ไข'].rows[0], audit_id: 'DUPLICATE-ROW' });
  await assert.rejects(commitSnapshot(db, before, after, 'write-00000000001', 'bad', result), error => error.code === 'COMMIT_FAILED');
  const loaded = await loadSnapshot(db);
  assert.equal(loaded.revision, before.revision);
  assert.equal(loaded.tables['รายการเงิน'].rows.length, 0);
  assert.equal(await receipt(db, 'write-00000000001', 'bad'), null);
});
test('storage rejects silent removal of historical records', async () => {
  const db = await seeded(), before = await loadSnapshot(db), after = structuredClone(before);
  after.tables['บัญชี'].rows.pop();
  await assert.rejects(commitSnapshot(db, before, after, 'write-00000000001', 'del', {}), /VOID/);
});
