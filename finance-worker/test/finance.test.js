import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createBook, formatDate } from '../src/legacy-store.js';
import { createLegacyEngine } from '../src/legacy-engine.js';
import { executeFinance } from '../src/finance.js';
import { emptySnapshot, moneyCents } from '../src/schema.js';
import { fixture, options, transaction } from './helpers.js';

test('empty database contains no accounts, transactions or personal identities', () => {
  const snapshot = emptySnapshot();
  assert.ok(Object.values(snapshot.tables).every(t => t.rows.length === 0));
  const engine = createLegacyEngine(snapshot, options());
  assert.equal(engine.api.getBootstrap().dashboard.real_cash, 0);
  assert.equal(engine.api.getBootstrap().accounts.length, 0);
});

test('explicit opening balance creates an account and audit without a transaction', () => {
  const result = executeFinance(emptySnapshot(), 'createAccount', [{ account_name: 'ทดสอบ', account_type: 'BANK',
    opening_balance: '123.45', opening_date: '2026-11-03', include_in_available: true }], options());
  assert.equal(result.result.dashboard.available_cash, 123.45);
  assert.equal(result.snapshot.tables['รายการเงิน'].rows.length, 0);
  assert.equal(result.snapshot.tables['ประวัติการแก้ไข'].rows.length, 1);
  assert.throws(() => executeFinance(emptySnapshot(), 'createAccount', [{ account_name: 'ทดสอบ', account_type: 'BANK', opening_date: '2026-11-03' }]), /ยอดเริ่มต้น/);
});

test('integer satang rejects extra precision, nonnumeric and unsafe values', () => {
  assert.equal(moneyCents('123.45'), 12345);
  assert.equal(moneyCents('-0.01'), -1);
  for (const value of ['0.001', '1e2', true, 'invalid', '9007199254740992']) assert.throws(() => moneyCents(value));
});

test('income, expense, transfer, edit and VOID preserve cash identities', () => {
  const engine = createLegacyEngine(fixture(), options()), api = engine.api;
  const income = api.saveTransaction(transaction({ transaction_type: 'INCOME', category_id: 'IN', amount: 12.34 }));
  const expense = api.saveTransaction(transaction({ amount: 0.01 }));
  api.updateTransaction(expense.id, { amount: 2.01 });
  const transfer = api.saveTransaction(transaction({ transaction_type: 'TRANSFER', to_account_id: 'ACC2', amount: 100 }));
  const dash = api.getDashboard();
  assert.equal(dash.real_cash, 10010.34);
  assert.equal(dash.available_cash, 9910.34);
  assert.equal(dash.income, 12.34); assert.equal(dash.personal_expense, 2.01);
  assert.equal(moneyCents(dash.opening_total) + moneyCents(dash.cash_inflow) - moneyCents(dash.cash_outflow), moneyCents(dash.real_cash));
  api.voidTransaction(expense.id, 'ทดสอบ'); api.voidTransaction(transfer.id, 'ทดสอบ');
  assert.equal(api.getDashboard().available_cash, 10012.35);
  assert.equal(api.getTransaction(income.id).status, 'ACTIVE');
  assert.ok(engine.snapshot().tables['ประวัติการแก้ไข'].rows.length >= 5);
});

test('company pool and project closure move ownership without moving bank cash', () => {
  const api = createLegacyEngine(fixture(), options()).api;
  api.createCompanyProject('งานจำลอง');
  api.saveTransaction(transaction({ transaction_type: 'INCOME', category_id: '', amount: 100,
    company_kind: 'ADVANCE', company_funding: 'PROJECT', project_name: 'งานจำลอง' }));
  const before = api.getDashboard().real_cash;
  api.closeCompanyProject('งานจำลอง', 100);
  assert.equal(api.getCompanySummary().pool.remaining, 100);
  assert.equal(api.getDashboard().real_cash, before);
  assert.equal(api.getCompanySummary().project_catalog[0].status, 'CLOSED');
  assert.equal(api.closeCompanyProject('งานจำลอง', 100).already_closed, true);
});

test('company receipt uses only manually selected claims and credits excess once', () => {
  const api = createLegacyEngine(fixture(), options()).api;
  api.saveTransaction(transaction({ expense_owner: 'COMPANY', amount: 20 }));
  api.saveTransaction(transaction({ expense_owner: 'COMPANY', amount: 30 }));
  const claims = api.getCompanySummary().claims;
  const preview = api.getCompanyReceiptPreview(50, '', []);
  assert.deepEqual(preview.allocations, []); assert.equal(preview.pool_amount, 50);
  const cash = api.getDashboard().real_cash;
  const id = api.saveTransaction(transaction({ transaction_type: 'INCOME', category_id: 'RF', amount: 50,
    company_surplus_to_pool: true, allocations: [{ claim_id: claims[0].claim_id, amount: 10 }],
    company_surplus_confirmed: true, company_expected_refund: 10, company_expected_pool: 40 })).id;
  assert.equal(api.getCompanySummary().remaining, 40);
  assert.equal(api.getCompanySummary().pool.remaining, 40);
  assert.equal(api.getDashboard().real_cash, cash + 50);
  assert.equal(api.getDashboard().income, 0);
  api.voidTransaction(id, 'ทดสอบ');
  assert.equal(api.getCompanySummary().remaining, 50);
  assert.equal(api.getCompanySummary().pool.remaining, 0);
});

test('company shortfall needs consent and frozen funding cannot be removed later', () => {
  const api = createLegacyEngine(fixture(), options()).api;
  const advance = api.saveTransaction(transaction({ transaction_type: 'INCOME', category_id: '', amount: 10,
    company_kind: 'ADVANCE', company_funding: 'POOL' }));
  const input = transaction({ expense_owner: 'COMPANY', amount: 20, company_funding: 'POOL' });
  assert.throws(() => api.saveTransaction(input), /ยืนยัน/);
  api.saveTransaction({ ...input, company_shortfall_confirmed: true, company_expected_personal: 10 });
  assert.equal(api.getCompanySummary().remaining, 10);
  assert.throws(() => api.voidTransaction(advance.id, 'ทดสอบ'), /ไม่เพียงพอ/);
});

test('DRAFT, recurring schedules and monthly plans do not move cash before confirmation', () => {
  const api = createLegacyEngine(fixture(), options()).api;
  api.saveTransaction(transaction({ status: 'DRAFT', source_type: 'IMPORT', amount: 20 }));
  const recurring = api.createRecurring({ recurring_name: 'ตัวอย่าง', transaction_type: 'EXPENSE', amount: 99,
    account_id: 'ACC1', category_id: 'EX', expense_owner: 'PERSONAL', start_date: '2026-11-01', due_day: 3 });
  assert.equal(api.getDashboard().real_cash, 10000.01);
  const schedule = api.getRecurringDue()[0];
  api.payRecurring({ recurring_id: schedule.recurring_id, amount: 99, account_id: 'ACC1', transaction_date: '2026-11-03' });
  assert.equal(api.getDashboard().real_cash, 9901.01);
  assert.equal(api.getDashboard().today_expenses.personal_expense, 99);
});

test('unconfirmed legacy debt payments cannot run through the public service', () => {
  assert.throws(() => executeFinance(fixture(), 'payDebt', [{}]), error => error.code === 'DEBT_REVIEW_REQUIRED');
});

test('read operations never mutate the stored snapshot', () => {
  const input = fixture(), before = JSON.stringify(input);
  for (const method of ['getBootstrap','getDashboard','getTransactions','getDebts','getCompanySummary','getRecurringDue']) executeFinance(input, method, [], options());
  assert.equal(JSON.stringify(input), before);
});

test('ported non-debt rules match the original v53 through a synthetic scenario', t => {
  const candidates = [new URL('../../.publish/FinanceAAA/personal-finance/Code.gs', import.meta.url),
    new URL('../../personal-finance/Code.gs', import.meta.url)];
  let source;
  for (const file of candidates) { try { source = readFileSync(file, 'utf8'); break; } catch {} }
  if (!source) { t.skip('Original v53 source is not available in this checkout'); return; }
  const adapter = createBook(fixture()); let serial = 100;
  const context = vm.createContext({ Date, console, SpreadsheetApp: { openById: () => adapter.book },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
    Utilities: { formatDate, getUuid: () => String(++serial).padStart(8, '0') },
    LockService: { getScriptLock: () => ({ waitLock(){}, releaseLock(){} }) } });
  vm.runInContext(source, context);
  context.today_ = () => '2026-11-03'; context.now_ = () => '2026-11-03T10:00:00';
  const port = createLegacyEngine(fixture(), options()).api;
  for (const input of [transaction({ amount: 50.25 }), transaction({ transaction_type: 'INCOME', category_id: 'IN', amount: 120 }),
    transaction({ transaction_type: 'TRANSFER', to_account_id: 'ACC2', amount: 25 }), transaction({ expense_owner: 'COMPANY', amount: 20 })]) {
    context.saveTransaction(input); port.saveTransaction(input);
  }
  const legacyDashboard = JSON.parse(JSON.stringify(context.getDashboard()));
  for (const key of ['company_advance','company_expense','company_receivable','net_position']) delete legacyDashboard[key];
  assert.deepEqual(legacyDashboard, port.getDashboard());
  assert.deepEqual(JSON.parse(JSON.stringify(context.getCompanySummary())), port.getCompanySummary());
  assert.deepEqual(JSON.parse(JSON.stringify(context.getTransactions({}))), port.getTransactions({}));
});
