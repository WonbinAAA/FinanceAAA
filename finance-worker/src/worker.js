import { AppError, json, errorResponse } from './errors.js';
import { authRoute, session, requireCsrf, sha256 } from './auth.js';
import { executeFinance, METHODS, WRITES } from './finance.js';
import { loadSnapshot, receipt, commitSnapshot } from './storage.js';
import { prepareImport, reconciliation } from './migration.js';

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

async function route(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true, service: 'finance-worker' });
  if (url.pathname.startsWith('/auth/')) return authRoute(request, env);
  if (['/login', '/login.html', '/login.js', '/cloud.css'].includes(url.pathname) && ['GET', 'HEAD'].includes(request.method)) return env.ASSETS.fetch(request);
  const auth = await session(request, env);
  if (!auth) {
    if (url.pathname.startsWith('/api/')) throw new AppError('กรุณาเข้าสู่ระบบด้วย Google', 401, 'LOGIN_REQUIRED');
    return new Response(null, { status: 302, headers: { Location: '/login' } });
  }
  if (url.pathname === '/api/session' && request.method === 'GET') return json({ ok: true, csrf_token: auth.csrf_token,
    email: auth.email, development: auth.google_sub === 'local-development' });
  if (url.pathname === '/api/reconcile' && request.method === 'GET') return json(reconciliation(await loadSnapshot(env.DB)));
  if (url.pathname === '/api/export' && request.method === 'GET') {
    const snapshot = await loadSnapshot(env.DB);
    const response = json({ format: 'finance-sheets-v1', time_zone: 'Asia/Bangkok', exported_at: new Date().toISOString(),
      tables: snapshot.tables, expected: reconciliation(snapshot) });
    response.headers.set('Content-Disposition', 'attachment; filename="finance-backup.json"');
    return response;
  }
  if (url.pathname.startsWith('/api/')) {
    if (request.method !== 'POST') throw new AppError('ไม่รองรับวิธีเรียกนี้', 405);
    requireCsrf(request, auth, env);
    if (!['/api/rpc', '/api/import/preview', '/api/import/commit'].includes(url.pathname)) throw new AppError('ไม่พบคำสั่ง', 404);
    const body = await bodyJson(request, url.pathname.startsWith('/api/import/') ? 5 * 1024 * 1024 : 65536);
    const method = body.method;
    if (url.pathname === '/api/rpc' && !METHODS.has(method)) throw new AppError('ไม่รองรับคำสั่งนี้', 404);
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
    if (url.pathname === '/api/import/preview') {
      const { snapshot, ...preview } = await prepareImport(before, body.export);
      return json(preview);
    }
    if (url.pathname === '/api/import/commit') {
      const plan = await prepareImport(before, body.export);
      if (!plan.ok || !plan.comparison?.ok || body.confirm_digest !== plan.digest || body.expected_revision !== before.revision)
        throw new AppError('ผลตรวจนำเข้าไม่ตรงกับข้อมูลล่าสุด กรุณาตรวจใหม่', 409, 'IMPORT_REVIEW_REQUIRED');
      const result = { ok: true, imported: plan.added, skipped: plan.skipped, reconciliation: plan.reconciliation };
      return json(await commitSnapshot(env.DB, before, plan.snapshot, requestId, hash, result));
    }
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
