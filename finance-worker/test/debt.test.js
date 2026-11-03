import test from 'node:test';
import assert from 'node:assert/strict';
import { createLegacyEngine } from '../src/legacy-engine.js';
import { executeFinance, debtReview } from '../src/finance.js';
import { prepareImport, reconciliation } from '../src/migration.js';
import { emptySnapshot } from '../src/schema.js';
import { fixture, options } from './helpers.js';

const input = extra => ({ debt_name: 'เจ้าหนี้จำลอง', principal_amount: '1000', interest_amount: '100', fee_amount: '50',
  start_date: '2026-11-03', due_day: 3, due_amount: 300, statement_reference: 'ใบแจ้งยอดจำลอง', ...extra });
const payment = (id, extra) => ({ debt_id: id, amount: '300', principal_amount: '200', interest_amount: '70', fee_amount: '30',
  transaction_date: '2026-11-03', account_id: 'ACC1', statement_reference: 'หลักฐานจำลอง', ...extra });
const engineWithDebt = () => { const engine = createLegacyEngine(fixture(), options()); const debt = engine.api.createDebt(input()).id; return { engine, id: debt, api: engine.api }; };

test('outstanding debt includes principal, unpaid interest and unpaid fees without moving cash', () => {
  const { api } = engineWithDebt(), debt = api.getDebts()[0];
  assert.equal(debt.balance, 1150);
  assert.deepEqual(debt.balance_breakdown, { principal: 1000, interest: 100, fees: 50 });
  assert.equal(debt.due_amount, 300); assert.equal(api.getDashboard().real_cash, 10000.01);
});
test('manual payment reduces each outstanding component and bank cash exactly once', () => {
  const { api, id, engine } = engineWithDebt();
  api.payDebt(payment(id));
  const debt = api.getDebts()[0];
  assert.equal(debt.balance, 850);
  assert.deepEqual(debt.balance_breakdown, { principal: 800, interest: 30, fees: 20 });
  assert.equal(debt.recorded_interest_paid, 70); assert.equal(debt.recorded_fees_paid, 30);
  assert.equal(debt.due_amount, 0);
  assert.equal(api.getDashboard().real_cash, 9700.01);
  assert.equal(api.getDashboard().today_expenses.personal_expense, 300);
  assert.equal(engine.snapshot().tables['รายการเงิน'].rows.length, 1);
  assert.equal(engine.snapshot().tables['รายการหนี้'].rows.filter(row => row.transaction_type === 'PAYMENT').length, 1);
});
test('interest-only payment is supported and component overpayment/mismatch/missing values are rejected', () => {
  const { api, id } = engineWithDebt();
  const before = api.getDashboard().real_cash;
  for (const extra of [{ amount: 50 },{ principal_amount: 1100, amount: 1200 },{ interest_amount: 101, amount: 331 },{ fee_amount: '' },{ statement_reference: '' }])
    assert.throws(() => api.payDebt(payment(id, extra)));
  assert.equal(api.getDashboard().real_cash, before);
  api.payDebt(payment(id, { amount: 20, principal_amount: 0, interest_amount: 20, fee_amount: 0 }));
  assert.deepEqual(api.getDebts()[0].balance_breakdown, { principal: 1000, interest: 80, fees: 50 });
});
test('statement snapshot records actual new charges without changing bank cash or inventing interest', () => {
  const { api, id, engine } = engineWithDebt();
  const cash = api.getDashboard().real_cash;
  api.adjustDebtBalance({ debt_id: id, principal_amount: 1000, interest_amount: 150, fee_amount: 50,
    transaction_date: '2026-11-03', statement_reference: 'ใบแจ้งยอดใหม่จำลอง', reason: 'ดอกเบี้ยค้างตามเอกสาร' });
  assert.equal(api.getDebts()[0].balance, 1200); assert.equal(api.getDashboard().real_cash, cash);
  assert.equal(engine.snapshot().tables['รายการเงิน'].rows.length, 0);
  assert.ok(engine.snapshot().tables['ประวัติการแก้ไข'].rows.some(row => row.record_type === 'DEBT_TRANSACTION'));
});
test('VOID restores the three components and bank cash together', () => {
  const { api, id } = engineWithDebt();
  const tx = api.payDebt(payment(id)); api.voidTransaction(tx.id, 'ยกเลิกจำลอง');
  assert.equal(api.getDebts()[0].balance, 1150);
  assert.deepEqual(api.getDebts()[0].balance_breakdown, { principal: 1000, interest: 100, fees: 50 });
  assert.equal(api.getDashboard().real_cash, 10000.01);
  assert.equal(api.getDebts()[0].recorded_interest_paid, 0);
});
test('legacy payments stay unverified until owner records a statement; no historical rates or cash correction', () => {
  const source = fixture();
  source.tables['หนี้สิน'].rows.push({ _row: 3, debt_id: 'OLD', user_id: 'USR001', debt_name: 'เจ้าหนี้เก่าจำลอง', opening_balance: 1000,
    start_date: '2026-01-01', status: 'ACTIVE', due_day: 3 });
  source.tables['รายการหนี้'].rows.push({ _row: 3, debt_transaction_id: 'OLD-PAYMENT', debt_id: 'OLD', transaction_type: 'PAYMENT',
    transaction_date: '2026-10-01', amount: 100, status: 'ACTIVE' });
  const engine = createLegacyEngine(source, options()), api = engine.api;
  assert.equal(api.getDebts()[0].balance, 900); assert.equal(api.getDebts()[0].balance_breakdown, null);
  assert.throws(() => api.payDebt(payment('OLD')), /ใบแจ้งยอด/);
  api.adjustDebtBalance({ debt_id: 'OLD', principal_amount: 950, interest_amount: 10, fee_amount: 5,
    transaction_date: '2026-11-03', statement_reference: 'ตัวเลขเจ้าของยืนยันจำลอง', reason: 'ตรวจตามใบแจ้งยอด' });
  assert.equal(api.getDebts()[0].balance, 965); assert.equal(api.getDashboard().real_cash, 10000.01);
  assert.equal(engine.snapshot().tables['รายการหนี้'].rows[0].amount, 100);
  assert.equal(engine.snapshot().tables['รายการหนี้'].rows[0].principal_amount, '');
  assert.equal(debtReview(engine.snapshot()).status, 'TOTAL_COMPONENTS_RECORDED');
});
test('backdated statement and VOID before a later statement require history review', () => {
  const { engine, api, id } = engineWithDebt(), paid = api.payDebt(payment(id));
  assert.throws(() => api.adjustDebtBalance({ debt_id: id, principal_amount: 800, interest_amount: 30, fee_amount: 20,
    transaction_date: '2026-11-02', statement_reference: 'ตัวอย่าง', reason: 'ย้อนหลัง' }), /ย้อนหลัง/);
  api.adjustDebtBalance({ debt_id: id, principal_amount: 800, interest_amount: 30, fee_amount: 20,
    transaction_date: '2026-11-03', statement_reference: 'ตัวอย่าง', reason: 'ยืนยันยอดหลังชำระ' });
  assert.throws(() => executeFinance(engine.snapshot(), 'voidTransaction', [paid.id, 'ทดสอบ']), error => error.code === 'DEBT_STATEMENT_CONFLICT');
});
test('zero statement preserves history and exact components survive export/import', async () => {
  const { engine, api, id } = engineWithDebt();
  api.adjustDebtBalance({ debt_id: id, principal_amount: 0, interest_amount: 0, fee_amount: 0,
    transaction_date: '2026-11-03', statement_reference: 'ยอดชำระครบจำลอง', reason: 'เจ้าหนี้ยืนยัน' });
  const snapshot = engine.snapshot();
  const plan = await prepareImport(emptySnapshot(), { format: 'finance-sheets-v1', time_zone: 'Asia/Bangkok',
    tables: snapshot.tables, expected: reconciliation(snapshot) });
  assert.equal(plan.ok, true); assert.equal(plan.reconciliation.debt_review.status, 'TOTAL_COMPONENTS_RECORDED');
  assert.equal(createLegacyEngine(plan.snapshot).api.getDebts()[0].balance, 0);
});
