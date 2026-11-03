import { emptySnapshot, moneyColumns, SCHEMA } from './schema.js';
import { AppError } from './errors.js';

export async function loadSnapshot(db) {
  const results = await db.batch([
    db.prepare('SELECT revision FROM finance_state WHERE singleton = 1'),
    db.prepare('SELECT name, headers_json FROM ledger_tables'),
    db.prepare('SELECT table_name, source_row, data_json FROM ledger_records ORDER BY table_name, source_row'),
  ]);
  const snapshot = emptySnapshot();
  snapshot.revision = results[0].results[0].revision;
  results[1].results.forEach(row => { snapshot.tables[row.name] = { headers: JSON.parse(row.headers_json), rows: [] }; });
  results[2].results.forEach(row => { snapshot.tables[row.table_name].rows.push({ ...JSON.parse(row.data_json), _row: row.source_row }); });
  return snapshot;
}

export async function receipt(db, requestId, hash) {
  const row = await db.prepare('SELECT request_hash, response_json FROM request_receipts WHERE request_id = ?').bind(requestId).first();
  if (!row) return null;
  if (row.request_hash !== hash) throw new AppError('รหัสคำขอนี้ถูกใช้กับข้อมูลอื่นแล้ว กรุณาโหลดใหม่', 409, 'IDEMPOTENCY_CONFLICT');
  return JSON.parse(row.response_json);
}

export function snapshotStatements(db, before, after) {
  const statements = [];
  for (const [name, table] of Object.entries(after.tables)) {
    if (!SCHEMA[name]) throw new AppError('ไม่รองรับตารางนี้');
    if (JSON.stringify(before.tables[name]?.headers) !== JSON.stringify(table.headers))
      statements.push(db.prepare('INSERT INTO ledger_tables(name, headers_json) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET headers_json = excluded.headers_json')
        .bind(name, JSON.stringify(table.headers)));
    else if (!before.tables[name]?.rows.length && table.rows.length)
      statements.push(db.prepare('INSERT OR IGNORE INTO ledger_tables(name, headers_json) VALUES (?, ?)').bind(name, JSON.stringify(table.headers)));
    const primaryKey = SCHEMA[name][0];
    const previous = new Map((before.tables[name]?.rows || []).map(row => [row[primaryKey], row]));
    for (const row of table.rows) {
      const old = previous.get(row[primaryKey]);
      if (old && JSON.stringify(old) === JSON.stringify(row)) continue;
      const { _row, ...data } = row;
      if (!data[primaryKey]) throw new AppError('ไม่มีรหัสรายการ');
      statements.push(db.prepare('INSERT INTO ledger_records(table_name, record_id, source_row, data_json, money_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(table_name, record_id) DO UPDATE SET source_row = excluded.source_row, data_json = excluded.data_json, money_json = excluded.money_json')
        .bind(name, String(data[primaryKey]), _row, JSON.stringify(data), JSON.stringify(moneyColumns(data))));
      previous.delete(row[primaryKey]);
    }
    // No silent deletes, including a row accidentally dropped by a future port.
    const remainingIds = new Set(table.rows.map(row => row[primaryKey]));
    if ([...previous.keys()].some(id => !remainingIds.has(id))) throw new AppError('ห้ามลบประวัติรายการ ให้ใช้ VOID');
  }
  return statements;
}

export async function commitSnapshot(db, before, after, requestId, hash, response) {
  const statements = snapshotStatements(db, before, after);
  // The NOT NULL constraint is an atomic compare-and-swap guard. Any failure
  // rolls back this whole D1 batch, including the receipt and all audit rows.
  const batch = [db.prepare('UPDATE finance_state SET revision = CASE WHEN revision = ? THEN revision + 1 ELSE NULL END WHERE singleton = 1')
    .bind(before.revision), ...statements,
  db.prepare('INSERT INTO request_receipts(request_id, request_hash, response_json, created_at) VALUES (?, ?, ?, ?)')
    .bind(requestId, hash, JSON.stringify(response), Math.floor(Date.now() / 1000))];
  try { await db.batch(batch); }
  catch {
    const saved = await receipt(db, requestId, hash);
    if (saved) return saved;
    const state = await db.prepare('SELECT revision FROM finance_state WHERE singleton = 1').first();
    if (state.revision !== before.revision) throw new AppError('ข้อมูลเปลี่ยนระหว่างบันทึก กรุณาโหลดข้อมูลล่าสุดและตรวจรายการอีกครั้ง', 409, 'REVISION_CONFLICT');
    throw new AppError('บันทึกข้อมูลไม่สำเร็จ ไม่มีรายการในชุดนี้ถูกบันทึก', 500, 'COMMIT_FAILED');
  }
  return response;
}
