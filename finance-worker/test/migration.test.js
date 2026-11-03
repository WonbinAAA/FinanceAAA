import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySnapshot } from '../src/schema.js';
import { prepareImport, reconciliation } from '../src/migration.js';
import { createLegacyEngine } from '../src/legacy-engine.js';
import { fixture, options, transaction } from './helpers.js';

function exported(snapshot) { return { format: 'finance-sheets-v1', time_zone: 'Asia/Bangkok', tables: snapshot.tables, expected: reconciliation(snapshot) }; }
test('import preserves IDs, original row order, VOID, DRAFT and audit history', async () => {
  const engine = createLegacyEngine(fixture(), options());
  const first = engine.api.saveTransaction(transaction());
  engine.api.voidTransaction(first.id, 'ตัวอย่างยกเลิก');
  engine.api.saveTransaction(transaction({ status: 'DRAFT', source_type: 'IMPORT' }));
  const source = engine.snapshot(), plan = await prepareImport(emptySnapshot(), exported(source));
  assert.equal(plan.ok, true); assert.equal(plan.comparison.ok, true);
  assert.deepEqual(plan.snapshot.tables['รายการเงิน'].rows, source.tables['รายการเงิน'].rows);
  assert.deepEqual(plan.snapshot.tables['ประวัติการแก้ไข'].rows, source.tables['ประวัติการแก้ไข'].rows);
  assert.equal(plan.reconciliation.cash_cents, 1000001);
});
test('reimport skips unchanged records and different data never overwrites an ID', async () => {
  const source = fixture();
  const again = await prepareImport(source, exported(source));
  assert.equal(again.ok, true); assert.equal(again.added, 0); assert.ok(again.skipped > 0);
  const changed = exported(source); changed.tables = structuredClone(changed.tables);
  changed.tables['บัญชี'].rows[0].opening_balance = 888;
  const conflict = await prepareImport(source, changed);
  assert.equal(conflict.ok, false); assert.ok(conflict.conflicts.some(c => c.reason === 'SAME_ID_DIFFERENT_DATA'));
  assert.equal(source.tables['บัญชี'].rows[0].opening_balance, 10000.01);
});
test('old history cannot silently be merged into a database already in use', async () => {
  const fresh = fixture(), engine = createLegacyEngine(fresh, options());
  engine.api.saveTransaction(transaction());
  const plan = await prepareImport(fresh, exported(engine.snapshot()));
  assert.equal(plan.ok, false);
  assert.ok(plan.conflicts.some(c => c.reason === 'USED_DATABASE_REQUIRES_OPENING_BALANCE_PLAN'));
});
test('import rejects duplicate IDs, extra precision, invalid dates and broken references', async () => {
  const duplicate = exported(fixture());
  duplicate.tables['บัญชี'].rows.push({ ...duplicate.tables['บัญชี'].rows[0], _row: 8 });
  await assert.rejects(prepareImport(emptySnapshot(), duplicate), /ซ้ำ/);
  const money = exported(fixture()); money.tables['บัญชี'].rows[0].opening_balance = '0.001';
  await assert.rejects(prepareImport(emptySnapshot(), money), /ทศนิยม/);
  const date = exported(fixture()); date.tables['บัญชี'].rows[0].opening_date = '2026-02-30';
  await assert.rejects(prepareImport(emptySnapshot(), date), /วันที่/);
  const engine = createLegacyEngine(fixture(), options()); engine.api.saveTransaction(transaction());
  const ref = exported(engine.snapshot()); ref.tables['บัญชี'].rows = [];
  await assert.rejects(prepareImport(emptySnapshot(), ref), /อ้างอิง/);
});
test('reconciliation catches source cash/account/company discrepancies', async () => {
  const source = exported(fixture()); source.expected.cash_cents += 1;
  const plan = await prepareImport(emptySnapshot(), source);
  assert.equal(plan.ok, false); assert.deepEqual(plan.comparison.differences, ['cash_cents']);
  assert.equal(plan.reconciliation.financial_verified, false);
});
test('legacy debt data is preserved and explicitly left unverified', async () => {
  const source = fixture(), debts = source.tables['หนี้สิน'];
  debts.rows.push({ _row: 3, ...Object.fromEntries(debts.headers.map(key => [key, ''])), debt_id: 'DEB-OLD', user_id: 'USR001',
    debt_name: 'เจ้าหนี้จำลอง', status: 'ACTIVE', opening_balance: 1000, start_date: '2026-01-01', due_day: 3 });
  const plan = await prepareImport(emptySnapshot(), exported(source));
  assert.equal(plan.ok, true);
  assert.equal(plan.reconciliation.debt_review.status, 'NEEDS_STATEMENT_REVIEW');
  assert.deepEqual(plan.reconciliation.debt_review.unresolved_debt_ids, ['DEB-OLD']);
  assert.equal(plan.snapshot.tables['หนี้สิน'].rows[0].opening_balance, 1000);
});
