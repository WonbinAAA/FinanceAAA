import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { emptySnapshot, SCHEMA } from '../src/schema.js';

export function testDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  class Statement {
    constructor(sql, bindings = []) { Object.assign(this, { sql, bindings }); }
    bind(...values) { return new Statement(this.sql, values); }
    async first(column) { const row = sqlite.prepare(this.sql).get(...this.bindings); return row ? (column ? row[column] : { ...row }) : null; }
    async all() { return { success: true, results: sqlite.prepare(this.sql).all(...this.bindings).map(row => ({ ...row })) }; }
    async run() { return { success: true, meta: sqlite.prepare(this.sql).run(...this.bindings), results: [] }; }
  }
  return { sqlite, prepare: sql => new Statement(sql), async batch(statements) {
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.all());
      sqlite.exec('COMMIT'); return results;
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
}

export function fixture() {
  const snapshot = emptySnapshot();
  const seed = (name, row) => {
    const table = snapshot.tables[name];
    table.rows.push({ _row: table.rows.length + 3, ...Object.fromEntries(SCHEMA[name].map(k => [k, row[k] ?? ''])) });
  };
  seed('ผู้ใช้งาน', { user_id: 'USR001', display_name: 'ผู้ใช้จำลอง', is_active: true });
  seed('บัญชี', { account_id: 'ACC1', user_id: 'USR001', account_name: 'บัญชีจำลอง A', account_type: 'BANK', opening_balance: 10000.01, opening_date: '2026-01-01', is_active: true, include_in_available: true });
  seed('บัญชี', { account_id: 'ACC2', user_id: 'USR001', account_name: 'บัญชีจำลอง B', account_type: 'BANK', opening_balance: 0, opening_date: '2026-01-01', is_active: true, include_in_available: false });
  [['IN','รายรับทั่วไป','INCOME','INCOME'],['EX','รายจ่ายทั่วไป','EXPENSE','BOTH'],['RF','เงินคืนบริษัท','INCOME','INCOME'],['DP','ชำระหนี้','EXPENSE','EXPENSE']]
    .forEach(([category_id, category_name, transaction_type, category_group], sort_order) => seed('หมวดหมู่', { category_id, category_name, transaction_type, category_group, sort_order, is_active: true }));
  return snapshot;
}
export const options = () => { let serial = 100; return { clock: () => new Date('2026-11-03T10:00:00+07:00'), uuid: () => String(++serial).padStart(8, '0') }; };
export const transaction = extra => ({ transaction_date: '2026-11-03', transaction_type: 'EXPENSE', account_id: 'ACC1', category_id: 'EX', amount: '10.01', expense_owner: 'PERSONAL', description: 'ข้อมูลจำลอง', ...extra });
