import { AppError, json, errorResponse } from './errors.js';
import { authRoute, session, requireCsrf, sha256, publicAccess, publicSessionResponse } from './auth.js';
import { executeFinance, METHODS, WRITES } from './finance.js';
import { loadSnapshot, receipt, commitSnapshot } from './storage.js';
import { prepareImport, reconciliation } from './migration.js';
import { protectCompanyWrites } from './company-link.js';
import { readCompanySummary } from './company-summary.js';
import { readCompanyBook, displayLedger } from './company-view.js';
import { transactionReport } from './report-data.js';
import { makeTransactionPdf } from './report-pdf.js';
import { makeTransactionXlsx } from './report-xlsx.js';

async function bodyJson(request, max = 65536) {
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) throw new AppError('ต้องส่งข้อมูล JSON', 415);
  if (Number(request.headers.get('Content-Length') || 0) > max) throw new AppError('ข้อมูลมากเกินขนาดที่รองรับ', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('ไม่มีข้อมูลคำขอ');
  const chunks = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > max) { await reader.cancel(); throw new AppError('ข้อมูลมากเกินขนาดที่รองรับ', 413); }
    chunks.push(value);
  }
  const data = new Uint8Array(length); let at = 0;
  chunks.forEach(chunk => { data.set(chunk, at); at += chunk.length; });
  try { return JSON.parse(new TextDecoder().decode(data)); }
  catch { throw new AppError('รูปแบบ JSON ไม่ถูกต้อง'); }
}

function secure(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'same-origin');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function readDisplayTransactions(env, snapshot, filters) {
  // Keep the same date validation and accounting/source selection for the list and both reports.
  executeFinance(snapshot, 'getTransactions', [filters]);
  const [book, links] = await Promise.all([
    readCompanyBook(env),
    env.DB.prepare('SELECT s.id AS source_id,s.revision,g.transaction_id,g.config_json FROM company_link_sources s JOIN company_link_groups g ON s.group_id=g.id').all(),
  ]);
  const rows = executeFinance(snapshot, 'getTransactions', [{}]).result;
  return displayLedger(rows, book, links.results, filters, snapshot.tables['บัญชี'].rows, snapshot.tables['หมวดหมู่'].rows);
}

const reportMime = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const reportFilterKeys = new Set(['month', 'date', 'date_from', 'date_to', 'type', 'owner', 'account_id', 'category_id', 'query']);

async function downloadTransactionReport(url, env, body) {
  const { format, filters, digest } = body || {};
  if (!Object.hasOwn(reportMime, format) || !filters || typeof filters !== 'object' || Array.isArray(filters)
    || Object.entries(filters).some(([key, value]) => !reportFilterKeys.has(key) || typeof value !== 'string')
    || typeof digest !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(digest)) {
    throw new AppError('รูปแบบคำขอรายงานไม่ถูกต้อง');
  }
  const snapshot = await loadSnapshot(env.DB);
  const items = await readDisplayTransactions(env, snapshot, filters);
  if (await sha256(JSON.stringify(items)) !== digest) {
    throw new AppError('รายการเปลี่ยนแล้ว กรุณาตรวจรายการล่าสุดแล้วส่งออกอีกครั้ง', 409, 'REPORT_VIEW_CHANGED');
  }
  if (!items.length) throw new AppError('ไม่มีรายการตามตัวกรองสำหรับส่งออก');
  const report = transactionReport(items, filters, snapshot.tables);
  let bytes;
  if (format === 'pdf') {
    const font = await env.ASSETS.fetch(new Request(new URL('/Sarabun-Regular.ttf', url)));
    if (!font.ok) throw new AppError('โหลดแบบอักษรรายงานไม่สำเร็จ กรุณาลองใหม่', 503);
    bytes = await makeTransactionPdf(report, new Uint8Array(await font.arrayBuffer()));
  } else {
    bytes = makeTransactionXlsx(report);
  }
  return new Response(bytes, { headers: {
    'Content-Type': reportMime[format], 'Content-Disposition': `attachment; filename="finance-transactions.${format}"`,
  } });
}

async function route(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true, service: 'finance-worker' });
  const isPublic = publicAccess(env);
  if (isPublic && url.pathname === '/api/session' && request.method === 'GET') return publicSessionResponse(request, env);
  if (isPublic && ['/login', '/login.html'].includes(url.pathname) && ['GET', 'HEAD'].includes(request.method))
    return new Response(null, { status: 302, headers: { Location: '/' } });
  if (url.pathname.startsWith('/auth/')) return authRoute(request, env);
  if (['/login', '/login.html', '/login.js', '/cloud.css'].includes(url.pathname) && ['GET', 'HEAD'].includes(request.method)) return env.ASSETS.fetch(request);
  if (isPublic && !url.pathname.startsWith('/api/')) {
    if (!['GET', 'HEAD'].includes(request.method)) throw new AppError('ไม่รองรับวิธีเรียกนี้', 405);
    return env.ASSETS.fetch(request);
  }
  const auth = await session(request, env);
  if (!auth) {
    if (url.pathname.startsWith('/api/')) throw new AppError(isPublic ? 'การเชื่อมต่อหมดอายุ กรุณาโหลดหน้าใหม่' : 'กรุณาเข้าสู่ระบบด้วย Google', 401, isPublic ? 'SESSION_EXPIRED' : 'LOGIN_REQUIRED');
    return new Response(null, { status: 302, headers: { Location: '/login' } });
  }
  if (url.pathname === '/api/session' && request.method === 'GET') return json({ ok: true, csrf_token: auth.csrf_token,
    email: auth.email, development: auth.google_sub === 'local-development' });
  if (url.pathname === '/api/reconcile' && request.method === 'GET') return json(reconciliation(await loadSnapshot(env.DB)));
  if (url.pathname === '/api/company-ledger-summary' && request.method === 'GET') return json(await readCompanySummary(env));
  if (url.pathname === '/api/export' && request.method === 'GET') {
    const snapshot = await loadSnapshot(env.DB);
    const response = json({ format: 'finance-sheets-v1', time_zone: 'Asia/Bangkok', exported_at: new Date().toISOString(),
      tables: snapshot.tables, expected: reconciliation(snapshot), company_link: {
        control: await env.DB.prepare('SELECT * FROM company_link_control').all(),
        groups: await env.DB.prepare('SELECT * FROM company_link_groups').all(),
        sources: await env.DB.prepare('SELECT * FROM company_link_sources').all(),
      } });
    response.headers.set('Content-Disposition', 'attachment; filename="finance-backup.json"');
    return response;
  }
  if (url.pathname.startsWith('/api/')) {
    if (request.method !== 'POST') throw new AppError('ไม่รองรับวิธีเรียกนี้', 405);
    requireCsrf(request, auth, env);
    if (!['/api/rpc', '/api/import/preview', '/api/import/commit', '/api/transactions/report'].includes(url.pathname)) throw new AppError('ไม่พบคำสั่ง', 404);
    const body = await bodyJson(request, url.pathname.startsWith('/api/import/') ? 5 * 1024 * 1024 : 65536);
    if (url.pathname === '/api/transactions/report') return downloadTransactionReport(url, env, body);
    const method = body.method;
    if (url.pathname === '/api/rpc' && !METHODS.has(method) && method !== 'getDisplayTransactions') throw new AppError('ไม่รองรับคำสั่งนี้', 404);
    const writing = url.pathname === '/api/import/commit' || WRITES.has(method);
    let hash, requestId;
    if (writing) {
      requestId = request.headers.get('Idempotency-Key') || '';
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) throw new AppError('ไม่มีรหัสป้องกันการบันทึกซ้ำ');
      hash = await sha256(auth.google_sub + '\n' + url.pathname + '\n' + JSON.stringify(body));
      const saved = await receipt(env.DB, requestId, hash);
      if (saved) return json(saved);
    }
    const before = await loadSnapshot(env.DB);
    if(method==='getDisplayTransactions'){
      if(!Array.isArray(body.args)||body.args.length>1||body.args[0]&&typeof body.args[0]!=='object')throw new AppError('รูปแบบคำขอไม่ถูกต้อง');
      const filters=body.args[0]||{};
      return json(await readDisplayTransactions(env, before, filters));
    }
    if (url.pathname === '/api/import/preview') {
      const { snapshot, ...preview } = await prepareImport(before, body.export);
      return json(preview);
    }
    if (url.pathname === '/api/import/commit') {
      if (await env.DB.prepare('SELECT 1 FROM company_link_control WHERE enabled=1').first())
        throw new AppError('เปิดเชื่อมเว็บบริษัทแล้ว ต้องตรวจแผนย้ายข้อมูลร่วมกับประวัติการเชื่อมก่อน',409,'COMPANY_LINK_REVIEW');
      const plan = await prepareImport(before, body.export);
      if (!plan.ok || !plan.comparison?.ok || body.confirm_digest !== plan.digest || body.expected_revision !== before.revision)
        throw new AppError('ผลตรวจนำเข้าไม่ตรงกับข้อมูลล่าสุด กรุณาตรวจใหม่', 409, 'IMPORT_REVIEW_REQUIRED');
      const result = { ok: true, imported: plan.added, skipped: plan.skipped, reconciliation: plan.reconciliation };
      return json(await commitSnapshot(env.DB, before, plan.snapshot, requestId, hash, result));
    }
    await protectCompanyWrites(env.DB, method, body.args || [], before);
    const executed = executeFinance(before, method, body.args || [], { debtPaymentsEnabled: env.DEBT_PAYMENTS_ENABLED === 'true' });
    return json(writing ? await commitSnapshot(env.DB, before, executed.snapshot, requestId, hash, executed.result) : executed.result);
  }
  if (!['GET', 'HEAD'].includes(request.method)) throw new AppError('ไม่รองรับวิธีเรียกนี้', 405);
  return env.ASSETS.fetch(request);
}

export default { async fetch(request, env) {
  try { return secure(await route(request, env)); }
  catch (error) { return secure(errorResponse(error)); }
} };
