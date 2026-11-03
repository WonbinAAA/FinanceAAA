import { AppError, json } from './errors.js';

const encoder = new TextEncoder();
const SESSION_AGE = 8 * 60 * 60;
let cachedJwks = { expires: 0, keys: [] };
export const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
export const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
export const sha256 = async text => b64url(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
const now = () => Math.floor(Date.now() / 1000);
function origin(env) {
  try {
    const url = new URL(env.APP_ORIGIN);
    if (url.origin !== env.APP_ORIGIN || (url.protocol !== 'https:' && !isLocal(url))) throw new Error();
    return url;
  } catch { throw new AppError('ยังไม่ได้ตั้งค่าที่อยู่เว็บใหม่', 503, 'AUTH_NOT_CONFIGURED'); }
}
function isLocal(url) { return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname); }
function requireConfig(env) {
  origin(env);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.ALLOWED_EMAIL)
    throw new AppError('ยังไม่ได้ตั้งค่า Google login และอีเมลที่อนุญาต', 503, 'AUTH_NOT_CONFIGURED');
}
const cookieName = env => origin(env).protocol === 'https:' ? '__Host-finance_session' : 'finance_session';
const stateName = env => origin(env).protocol === 'https:' ? '__Host-finance_oauth' : 'finance_oauth';
function readCookie(request, name) {
  return (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1) || '';
}
function cookie(env, name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${origin(env).protocol === 'https:' ? '; Secure' : ''}`;
}
export function sameOrigin(request, env) {
  if (request.headers.get('Origin') !== origin(env).origin)
    throw new AppError('คำขอไม่ได้มาจากเว็บนี้ กรุณาโหลดหน้าใหม่', 403, 'ORIGIN_REJECTED');
}
export async function session(request, env) {
  if (new URL(request.url).origin !== origin(env).origin) throw new AppError('ที่อยู่เว็บไม่ตรงกับการตั้งค่า', 403);
  const token = readCookie(request, cookieName(env));
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await env.DB.prepare('SELECT * FROM auth_sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(await sha256(token), now()).first();
  if (!row) return null;
  // Changing ALLOWED_EMAIL revokes previously allowed identities immediately.
  if (row.google_sub !== 'local-development' && row.email.toLowerCase() !== String(env.ALLOWED_EMAIL || '').trim().toLowerCase()) return null;
  if (row.google_sub === 'local-development' && !localEnabled(request, env)) return null;
  return row;
}
export function requireCsrf(request, auth, env) {
  sameOrigin(request, env);
  if (!auth || request.headers.get('X-CSRF-Token') !== auth.csrf_token)
    throw new AppError('สิทธิ์คำขอหมดอายุ กรุณาโหลดหน้าใหม่', 403, 'CSRF_REJECTED');
}
function localEnabled(request, env) {
  const url = new URL(request.url);
  return env.APP_ENV === 'local' && env.LOCAL_DEV_LOGIN === 'true' && isLocal(url)
    && isLocal(origin(env)) && url.origin === origin(env).origin;
}
async function makeSession(env, sub, email) {
  const token = randomToken(), csrf = randomToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(now()),
    env.DB.prepare('INSERT INTO auth_sessions(token_hash, google_sub, email, csrf_token, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(await sha256(token), sub, email, csrf, now() + SESSION_AGE),
  ]);
  return { token, csrf };
}
function decodePart(part) {
  return Uint8Array.from(atob(part.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
}
export async function verifyGoogleIdToken(token, env, nonce, fetcher = fetch) {
  try {
    if (typeof token !== 'string' || token.length > 16000) throw new Error();
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error();
    const header = JSON.parse(new TextDecoder().decode(decodePart(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(decodePart(parts[1])));
    if (header.alg !== 'RS256' || !header.kid) throw new Error();
    if (cachedJwks.expires < Date.now() || !cachedJwks.keys.some(k => k.kid === header.kid)) {
      const response = await fetcher('https://www.googleapis.com/oauth2/v3/certs');
      if (!response.ok) throw new Error();
      const jwks = await response.json();
      if (!Array.isArray(jwks.keys)) throw new Error();
      cachedJwks = { keys: jwks.keys, expires: Date.now() + 3600000 };
    }
    const jwk = cachedJwks.keys.find(k => k.kid === header.kid && k.kty === 'RSA');
    if (!jwk) throw new Error();
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decodePart(parts[2]), encoder.encode(parts[0] + '.' + parts[1]))) throw new Error();
    if (!['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss)
      || claims.aud !== env.GOOGLE_CLIENT_ID || !Number.isFinite(claims.exp) || claims.exp <= now()
      || !Number.isFinite(claims.iat) || claims.iat > now() + 60 || claims.nonce !== nonce
      || !claims.sub || claims.email_verified !== true || typeof claims.email !== 'string'
      || claims.email.toLowerCase() !== String(env.ALLOWED_EMAIL).trim().toLowerCase()) throw new Error();
    return claims;
  } catch { throw new AppError('บัญชี Google นี้ไม่ได้รับอนุญาต หรือการเข้าสู่ระบบหมดอายุ', 403, 'GOOGLE_LOGIN_REJECTED'); }
}

export async function authRoute(request, env) {
  const url = new URL(request.url);
  if (url.origin !== origin(env).origin) throw new AppError('ที่อยู่เว็บไม่ตรงกับการตั้งค่า', 403);
  if (url.pathname === '/auth/google' && request.method === 'GET') {
    requireConfig(env);
    const state = randomToken(), verifier = randomToken(), nonce = randomToken();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM oauth_states WHERE expires_at <= ?').bind(now()),
      env.DB.prepare('INSERT INTO oauth_states(state_hash, nonce, verifier, expires_at) VALUES (?, ?, ?, ?)')
        .bind(await sha256(state), nonce, verifier, now() + 600),
    ]);
    const target = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    target.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: env.APP_ORIGIN + '/auth/callback',
      response_type: 'code', scope: 'openid email', state, nonce, code_challenge: await sha256(verifier),
      code_challenge_method: 'S256', prompt: 'select_account' }).toString();
    return new Response(null, { status: 302, headers: { Location: target.href, 'Set-Cookie': cookie(env, stateName(env), state, 600), 'Cache-Control': 'no-store' } });
  }
  if (url.pathname === '/auth/callback' && request.method === 'GET') {
    requireConfig(env);
    const state = url.searchParams.get('state'), code = url.searchParams.get('code');
    if (!state || state !== readCookie(request, stateName(env)) || !code)
      throw new AppError('ตรวจสอบการเข้าสู่ระบบไม่ได้ กรุณาเริ่มใหม่', 403);
    const stored = await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash = ? AND expires_at > ? RETURNING *')
      .bind(await sha256(state), now()).first();
    if (!stored) throw new AppError('คำขอเข้าสู่ระบบหมดอายุ กรุณาเริ่มใหม่', 403);
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code,
        client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: env.APP_ORIGIN + '/auth/callback',
        grant_type: 'authorization_code', code_verifier: stored.verifier }) });
    if (!response.ok) throw new AppError('Google login ไม่สำเร็จ กรุณาเริ่มใหม่', 403);
    const tokens = await response.json();
    const identity = await verifyGoogleIdToken(tokens.id_token, env, stored.nonce);
    const login = await makeSession(env, identity.sub, identity.email);
    const headers = new Headers({ Location: '/', 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', cookie(env, cookieName(env), login.token, SESSION_AGE));
    headers.append('Set-Cookie', cookie(env, stateName(env), '', 0));
    return new Response(null, { status: 303, headers });
  }
  if (url.pathname === '/auth/local' && request.method === 'POST') {
    sameOrigin(request, env);
    if (!localEnabled(request, env)) throw new AppError('ไม่พบหน้านี้', 404);
    const login = await makeSession(env, 'local-development', 'local@localhost');
    return new Response(null, { status: 303, headers: { Location: '/', 'Cache-Control': 'no-store',
      'Set-Cookie': cookie(env, cookieName(env), login.token, SESSION_AGE) } });
  }
  if (url.pathname === '/auth/logout' && request.method === 'POST') {
    const auth = await session(request, env);
    requireCsrf(request, auth, env);
    await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(auth.token_hash).run();
    const response = json({ ok: true });
    response.headers.set('Set-Cookie', cookie(env, cookieName(env), '', 0));
    return response;
  }
  throw new AppError('ไม่พบหน้านี้', 404);
}
