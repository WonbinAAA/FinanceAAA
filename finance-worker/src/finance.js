import { createLegacyEngine, READ_METHODS, WRITE_METHODS } from './legacy-engine.js';
import { AppError } from './errors.js';
import { moneyCents, SCHEMA } from './schema.js';
import { debtState } from './debt-components.js';

export const READS = new Set(READ_METHODS);
export const WRITES = new Set([...WRITE_METHODS, 'createAccount']);
export const METHODS = new Set([...READS, ...WRITES]);

export function debtReview(snapshot) {
  const debtRows = snapshot.tables['หนี้สิน'].rows.filter(d => d.status !== 'VOID');
  const unresolved = debtRows.filter(d => !debtState(d, snapshot.tables['รายการหนี้'].rows).balance_components_recorded);
  return { status: unresolved.length ? 'NEEDS_STATEMENT_REVIEW' : 'TOTAL_COMPONENTS_RECORDED',
    total_debts: debtRows.length,
    unresolved_debt_ids: unresolved.map(d => d.debt_id),
    message: unresolved.length ? 'หนี้เดิมยังไม่ยืนยันเงินต้นและส่วนประกอบค่างวด ห้ามใช้ยอดนี้เป็นยอดปิดหนี้' : 'หนี้คงเหลือรวมเงินต้น + ดอกเบี้ยค้าง + ค่าธรรมเนียมค้าง ตามยอดที่กรอก ไม่คำนวณดอกเบี้ยเพิ่มอัตโนมัติและไม่ใช่ยอดปิดหนี้ในอนาคต' };
}

function createAccount(snapshot, input, options) {
  const name = String(input?.account_name || '').trim();
  if (!name || name.length > 60 || /[\x00-\x1f\x7f]/.test(name)) throw new AppError('ชื่อบัญชีต้องมี 1–60 ตัวอักษร');
  if (!['CASH','BANK','E_WALLET'].includes(input.account_type)) throw new AppError('ประเภทบัญชีไม่ถูกต้อง');
  if (input.opening_balance === '' || input.opening_balance == null) throw new AppError('กรุณาระบุยอดเริ่มต้น');
  const opening = moneyCents(input.opening_balance);
  const day = String(input.opening_date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(day + 'T12:00:00Z').toISOString().slice(0,10) !== day)
    throw new AppError('วันที่ยอดเริ่มต้นไม่ถูกต้อง');
  const after = structuredClone(snapshot);
  const table = after.tables['บัญชี'];
  if (table.rows.some(a => a.account_name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new AppError('มีบัญชีชื่อนี้อยู่แล้ว');
  const id = 'ACC-' + (options.uuid?.() || crypto.randomUUID()).replaceAll('-', '').toUpperCase();
  const timestamp = (options.clock?.() || new Date()).toISOString();
  const add = (tableName, data) => {
    const target = after.tables[tableName];
    target.rows.push({ _row: Math.max(2, ...target.rows.map(r => r._row)) + 1, ...Object.fromEntries(target.headers.map(k => [k, data[k] ?? ''])) });
  };
  add('บัญชี', { account_id: id, user_id: 'USR001', account_name: name, account_type: input.account_type,
    opening_balance: opening / 100, opening_date: day, is_active: true, note: '', include_in_available: input.include_in_available === true });
  // Only public, nonfinancial system categories are initialized. No transactions.
  if (!after.tables['หมวดหมู่'].rows.length) {
    [['CAT-INCOME','รายรับทั่วไป','INCOME','INCOME'], ['CAT-EXPENSE','รายจ่ายทั่วไป','EXPENSE','EXPENSE'],
      ['CAT-OFFICE','ค่าใช้จ่ายบริษัท','EXPENSE','OFFICE'], ['CAT-REFUND','เงินคืนบริษัท','INCOME','INCOME'],
      ['CAT-DEBT','ชำระหนี้','EXPENSE','EXPENSE']].forEach(([category_id, category_name, transaction_type, category_group], i) =>
      add('หมวดหมู่', { category_id, category_name, transaction_type, category_group, is_active: true, sort_order: i + 1 }));
  }
  add('ประวัติการแก้ไข', { audit_id: 'AUD-' + crypto.randomUUID(), user_id: 'USR001', record_type: 'ACCOUNT',
    record_id: id, action: 'CREATE', field_name: '', old_value: '', new_value: JSON.stringify({ name, opening_balance: opening / 100, opening_date: day }),
    change_source: 'WEB', reason: 'เจ้าของระบุยอดเริ่มต้น', changed_at: timestamp });
  return { after, result: { ok: true, id } };
}

export function executeFinance(snapshot, method, args = [], options = {}) {
  if (!METHODS.has(method)) throw new AppError('ไม่รองรับคำสั่งนี้', 404, 'UNKNOWN_METHOD');
  if (!Array.isArray(args) || args.length > 4) throw new AppError('รูปแบบคำขอไม่ถูกต้อง');
  if (method === 'payDebt' && options.debtPaymentsEnabled !== true)
    throw new AppError('การชำระหนี้ยังไม่เปิดใช้จนกว่าจะยืนยันความหมายของยอดเงินต้นและรายละเอียดค่างวด', 409, 'DEBT_REVIEW_REQUIRED');
  try {
    if (method === 'voidTransaction') {
      const linked = snapshot.tables['รายการหนี้'].rows.filter(row => row.linked_transaction_id === args[0] && row.status === 'ACTIVE');
      if (linked.some(payment => snapshot.tables['รายการหนี้'].rows.some(row => row.debt_id === payment.debt_id && row.status === 'ACTIVE'
        && row.transaction_type === 'STATEMENT' && (row.transaction_date > payment.transaction_date || row.transaction_date === payment.transaction_date && row._row > payment._row))))
        throw new AppError('มีการยืนยันใบแจ้งยอดหลังรายการนี้แล้ว ต้องทบทวนยอดใบแจ้งยอดก่อน VOID', 409, 'DEBT_STATEMENT_CONFLICT');
    }
    if (method === 'createAccount') {
      const created = createAccount(snapshot, args[0], options);
      const engine = createLegacyEngine(created.after, options);
      return { snapshot: engine.snapshot(), result: { ...created.result, ...engine.api.getBootstrap(), debt_review: debtReview(created.after) } };
    }
    const engine = createLegacyEngine(snapshot, options);
    const result = engine.api[method](...args);
    const after = engine.snapshot();
    if (result && !Array.isArray(result) && typeof result === 'object') {
      result.debt_review = debtReview(after);
      if (result.connection) result.connection = { ok: true, database: 'D1', time_zone: 'Asia/Bangkok' };
    }
    return { snapshot: after, result };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(error.message || 'ข้อมูลไม่ถูกต้อง');
  }
}
