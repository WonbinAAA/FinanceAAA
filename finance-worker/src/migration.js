import { SCHEMA, moneyColumns, moneyCents } from './schema.js';
import { createLegacyEngine } from './legacy-engine.js';
import { debtReview } from './finance.js';
import { AppError } from './errors.js';
import { sha256 } from './auth.js';

const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

export function reconciliation(snapshot) {
  const engine = createLegacyEngine(snapshot);
  const dashboard = engine.api.getDashboard();
  const company = engine.api.getCompanySummary();
  const debt = debtReview(snapshot);
  return { ok: true, revision: snapshot.revision,
    counts: Object.fromEntries(Object.entries(snapshot.tables).map(([name, table]) => [name, table.rows.length])),
    balances_cents: Object.fromEntries(Object.entries(dashboard.balances).map(([id, value]) => [id, moneyCents(value)])),
    cash_cents: moneyCents(dashboard.real_cash), available_cents: moneyCents(dashboard.available_cash),
    opening_cents: moneyCents(dashboard.opening_total), inflow_cents: moneyCents(dashboard.cash_inflow), outflow_cents: moneyCents(dashboard.cash_outflow),
    company_receivable_cents: Math.round(company.remaining * 100), company_advance_cents: moneyCents(company.advance_remaining),
    company_pool_cents: moneyCents(company.pool.remaining),
    projects_cents: Object.fromEntries(company.projects.map(p => [p.project_name, moneyCents(p.remaining)])),
    debt_review: debt, financial_verified: false,
    message: 'ผลนี้ตรวจความสอดคล้องของข้อมูลที่นำเข้า ต้องเทียบยอดบัญชีและยอดบริษัทกับต้นทาง ณ เวลาเดียวกันก่อนใช้งานจริง; หนี้ที่ยังไม่ยืนยันส่วนประกอบไม่ผ่านการรับรอง' };
}

function validateExport(input) {
  if (!input || input.format !== 'finance-sheets-v1' || input.time_zone !== 'Asia/Bangkok' || !input.tables || typeof input.tables !== 'object')
    throw new AppError('ไฟล์ต้องเป็น finance-sheets-v1 เขตเวลา Asia/Bangkok');
  const tables = {};
  for (const [name, table] of Object.entries(input.tables)) {
    if (!SCHEMA[name]) throw new AppError('พบตารางที่ไม่รองรับ');
    if (!Array.isArray(table.headers) || !table.headers.length || !Array.isArray(table.rows)) throw new AppError('หัวตารางหรือแถวไม่ถูกต้อง');
    const headers = table.headers;
    if (new Set(headers).size !== headers.length || headers.some(h => typeof h !== 'string' || !/^[a-z][a-z0-9_]*$/.test(h)
      || ['__proto__','constructor','prototype','_row'].includes(h)) || !headers.includes(SCHEMA[name][0])) throw new AppError('ชื่อคอลัมน์ซ้ำหรือไม่ถูกต้อง');
    const ids = new Set(), rows = new Set();
    tables[name] = { headers: [...headers], rows: table.rows.map(row => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new AppError('รูปแบบแถวไม่ถูกต้อง');
      if (Object.keys(row).some(k => k !== '_row' && !headers.includes(k))) throw new AppError('พบข้อมูลนอกหัวตาราง');
      if (!Number.isSafeInteger(row._row) || row._row < 3) throw new AppError('ต้องเก็บเลขแถวต้นทางตั้งแต่แถว 3');
      const id = row[SCHEMA[name][0]];
      if (typeof id !== 'string' || !id || id.length > 200 || ids.has(id) || rows.has(row._row)) throw new AppError('พบรหัสว่าง รหัสซ้ำ หรือเลขแถวซ้ำ');
      ids.add(id); rows.add(row._row);
      if (Object.entries(row).some(([k,v]) => k !== '_row' && v !== null && !['string','number','boolean'].includes(typeof v)))
        throw new AppError('ค่าของเซลล์ต้องเป็นข้อความ ตัวเลข หรือ boolean');
      if (row.user_id && row.user_id !== 'USR001') throw new AppError('พบข้อมูลของผู้ใช้อื่น ต้องวางแผนย้ายเจ้าของก่อน');
      moneyColumns(row);
      if (['รายการเงิน','รายการหนี้','จับคู่เงินคืนบริษัท'].includes(name) && !(moneyCents(row.amount) > 0)
        && !(name === 'รายการหนี้' && row.transaction_type === 'STATEMENT' && moneyCents(row.amount) === 0)) throw new AppError('จำนวนเงินรายการต้องมากกว่า 0');
      for (const [key, value] of Object.entries(row)) {
        if (value && /(^|_)(date|day)$/.test(key) && key !== 'due_day') {
          const day = String(value);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day + 'T12:00:00Z'))
            || new Date(day + 'T12:00:00Z').toISOString().slice(0,10) !== day) throw new AppError('วันที่ในไฟล์ไม่ถูกต้อง');
        }
      }
      return { _row: row._row, ...Object.fromEntries(headers.map(key => [key, row[key] ?? ''])) };
    }).sort((a,b) => a._row - b._row) };
  }
  return tables;
}

function validateReferences(snapshot) {
  const rows = name => snapshot.tables[name].rows;
  const ids = name => new Set(rows(name).map(row => row[SCHEMA[name][0]]));
  const accounts = ids('บัญชี'), categories = ids('หมวดหมู่'), debts = ids('หนี้สิน'), transactions = ids('รายการเงิน'), claims = ids('เงินสำรองบริษัท');
  const linked = (set, id) => !id || set.has(id);
  rows('รายการเงิน').forEach(row => {
    if (!['ACTIVE','DRAFT','VOID'].includes(row.status) || !['INCOME','EXPENSE','TRANSFER'].includes(row.transaction_type)) throw new AppError('ประเภทหรือสถานะรายการเงินไม่ถูกต้อง');
    if (!linked(accounts, row.account_id) || !linked(accounts, row.to_account_id) || !linked(categories, row.category_id)) throw new AppError('รายการเงินอ้างอิงบัญชีหรือหมวดที่ไม่อยู่ในไฟล์');
    if (row.company_kind !== 'MOVE' && !row.account_id) throw new AppError('รายการเงินไม่มีบัญชี');
    if (row.transaction_type === 'TRANSFER' && (!row.to_account_id || row.to_account_id === row.account_id)) throw new AppError('บัญชีโอนไม่ถูกต้อง');
    if (row.transaction_type === 'EXPENSE' && !['PERSONAL','COMPANY'].includes(row.expense_owner)) throw new AppError('เจ้าของรายจ่ายไม่ถูกต้อง');
  });
  rows('รายการหนี้').forEach(row => {
    if (!debts.has(row.debt_id) || !linked(transactions, row.linked_transaction_id) || !linked(accounts, row.account_id)) throw new AppError('รายการหนี้อ้างอิงข้อมูลที่ไม่มีอยู่');
  });
  rows('เงินสำรองบริษัท').forEach(row => { if (!transactions.has(row.transaction_id)) throw new AppError('เงินสำรองไม่มีธุรกรรมต้นทาง'); });
  rows('จับคู่เงินคืนบริษัท').forEach(row => { if (!transactions.has(row.reimbursement_transaction_id) || !claims.has(row.claim_id)) throw new AppError('จับคู่เงินคืนอ้างอิงข้อมูลที่ไม่มีอยู่'); });
  rows('แผนชำระหนี้').forEach(row => { if (!debts.has(row.debt_id)) throw new AppError('แผนชำระหนี้ไม่มีเจ้าหนี้'); });
  rows('รายการประจำ').forEach(row => { if (!linked(accounts, row.account_id) || !linked(categories, row.category_id)) throw new AppError('รายการประจำอ้างอิงข้อมูลที่ไม่มีอยู่'); });
}

export async function prepareImport(before, input) {
  const incoming = validateExport(input), after = structuredClone(before);
  let added = 0, skipped = 0;
  const conflicts = [];
  const sameIdTables = [];
  for (const [name, table] of Object.entries(incoming)) {
    const target = after.tables[name], primary = SCHEMA[name][0];
    const existing = new Map(target.rows.map(row => [row[primary], row]));
    const occupied = new Map(target.rows.map(row => [row._row, row[primary]]));
    target.headers = [...new Set([...target.headers, ...table.headers])];
    for (const row of table.rows) {
      const old = existing.get(row[primary]);
      // Normalize absent columns to empty, but never rewrite a different value.
      const normalize = data => ({ _row: data._row, ...Object.fromEntries(target.headers.map(key => [key, data[key] ?? ''])) });
      if (old) {
        if (stable(normalize(old)) === stable(normalize(row))) skipped++;
        else conflicts.push({ table: name, id: row[primary], reason: 'SAME_ID_DIFFERENT_DATA' });
        continue;
      }
      if (occupied.has(row._row)) { conflicts.push({ table: name, id: row[primary], reason: 'SOURCE_ORDER_CONFLICT' }); continue; }
      target.rows.push(normalize(row)); occupied.set(row._row, row[primary]); added++;
    }
    target.rows.sort((a,b) => a._row - b._row);
    if (before.tables[name].rows.length && table.rows.length) sameIdTables.push(name);
  }
  // Starting fresh then importing history requires deliberate opening-balance
  // reconciliation. Never merge old movements into an already used ledger.
  const used = ['บัญชี','รายการเงิน','หนี้สิน','รายการหนี้','เงินสำรองบริษัท','จับคู่เงินคืนบริษัท','โปรเจกต์บริษัท','รายการประจำ']
    .some(name => before.tables[name].rows.length);
  if (used && added > 0) conflicts.push({ reason: 'USED_DATABASE_REQUIRES_OPENING_BALANCE_PLAN' });
  const digest = await sha256(stable({ revision: before.revision, tables: incoming }));
  if (conflicts.length) return { ok: false, digest, revision: before.revision, added, skipped, conflicts,
    message: 'ยังไม่นำเข้า ต้องแก้ความขัดแย้งและแผนยอดเริ่มต้นก่อน ระบบจะไม่ทับรหัสเดิมหรือเพิ่มประวัติซ้ำ' };
  validateReferences(after);
  const report = reconciliation(after);
  let comparison = null;
  if (input.expected) {
    const differences = [];
    for (const key of ['balances_cents','cash_cents','available_cents','opening_cents','inflow_cents','outflow_cents','company_receivable_cents','company_advance_cents','company_pool_cents','projects_cents']) {
      if (input.expected[key] === undefined || stable(input.expected[key]) !== stable(report[key])) differences.push(key);
    }
    comparison = { ok: differences.length === 0, differences };
  }
  return { ok: !comparison || comparison.ok, digest, revision: before.revision, added, skipped, conflicts: [],
    comparison, reconciliation: report, snapshot: after,
    message: comparison ? 'ตรวจเทียบกับยอดต้นทางที่แนบมาแล้ว หนี้ยังต้องตรวจใบแจ้งยอดแยก' : 'ยังไม่มีผลรวมต้นทางให้เทียบ ต้องแนบ expected ก่อนย้ายข้อมูลใช้งานจริง' };
}
