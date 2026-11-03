import test from 'node:test';
import assert from 'node:assert/strict';
import { b64url, verifyGoogleIdToken, session, authRoute, requireCsrf, sha256 } from '../src/auth.js';
import { testDb } from './helpers.js';

const envFor = db => ({ DB: db, APP_ORIGIN: 'http://127.0.0.1:8787', APP_ENV: 'local', LOCAL_DEV_LOGIN: 'true',
  GOOGLE_CLIENT_ID: 'synthetic-client', GOOGLE_CLIENT_SECRET: 'synthetic-not-a-secret', ALLOWED_EMAIL: 'owner@example.test' });
test('unauthenticated requests have no session; forged cookie is rejected', async () => {
  const env = envFor(testDb());
  assert.equal(await session(new Request(env.APP_ORIGIN), env), null);
  assert.equal(await session(new Request(env.APP_ORIGIN, { headers: { Cookie: 'finance_session=forged' } }), env), null);
});
test('CSRF checks both exact origin and session token', () => {
  const env = envFor(testDb()), auth = { csrf_token: 'right' };
  assert.throws(() => requireCsrf(new Request(env.APP_ORIGIN, { headers: { Origin: 'https://evil.test', 'X-CSRF-Token': 'right' } }), auth, env));
  assert.throws(() => requireCsrf(new Request(env.APP_ORIGIN, { headers: { Origin: env.APP_ORIGIN, 'X-CSRF-Token': 'wrong' } }), auth, env));
  assert.doesNotThrow(() => requireCsrf(new Request(env.APP_ORIGIN, { headers: { Origin: env.APP_ORIGIN, 'X-CSRF-Token': 'right' } }), auth, env));
});
test('development login is refused on public hosts even with flag enabled', async () => {
  const env = { ...envFor(testDb()), APP_ORIGIN: 'https://synthetic.workers.dev' };
  await assert.rejects(authRoute(new Request(env.APP_ORIGIN + '/auth/local', { method: 'POST', headers: { Origin: env.APP_ORIGIN } }), env), /ไม่พบ/);
});
test('local sessions use opaque cookies, hashed storage and logout revokes them', async () => {
  const db = testDb(), env = envFor(db);
  const login = await authRoute(new Request(env.APP_ORIGIN + '/auth/local', { method: 'POST', headers: { Origin: env.APP_ORIGIN } }), env);
  const cookie = login.headers.get('Set-Cookie').split(';')[0];
  assert.match(login.headers.get('Set-Cookie'), /HttpOnly; SameSite=Lax/);
  const request = new Request(env.APP_ORIGIN, { headers: { Cookie: cookie } });
  const auth = await session(request, env); assert.ok(auth.csrf_token);
  assert.notEqual(auth.token_hash, cookie.split('=')[1]);
  const logout = new Request(env.APP_ORIGIN + '/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: env.APP_ORIGIN, 'X-CSRF-Token': auth.csrf_token } });
  assert.equal((await authRoute(logout, env)).status, 200);
  assert.equal(await session(request, env), null);
});
test('OAuth state has PKCE and nonce; mismatched or reused callback is rejected', async () => {
  const env = envFor(testDb());
  const response = await authRoute(new Request(env.APP_ORIGIN + '/auth/google'), env);
  const location = new URL(response.headers.get('Location'));
  assert.equal(location.origin, 'https://accounts.google.com');
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(location.searchParams.get('nonce'));
  await assert.rejects(authRoute(new Request(env.APP_ORIGIN + '/auth/callback?state=forged&code=fake'), env), /ตรวจสอบ/);
});
test('Google token verification checks signature, issuer, audience, expiry, nonce and allowed verified email', async () => {
  const env = envFor(testDb()), keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign','verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'synthetic-key', alg: 'RS256' };
  const enc = object => b64url(new TextEncoder().encode(JSON.stringify(object)));
  const now = Math.floor(Date.now()/1000);
  const claims = { iss: 'https://accounts.google.com', aud: env.GOOGLE_CLIENT_ID, exp: now + 600, iat: now,
    nonce: 'expected-nonce', sub: 'synthetic-subject', email: env.ALLOWED_EMAIL, email_verified: true };
  async function token(changes = {}) {
    const data = enc({ alg: 'RS256', kid: jwk.kid }) + '.' + enc({ ...claims, ...changes });
    return data + '.' + b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(data)));
  }
  const fetcher = async () => Response.json({ keys: [jwk] });
  assert.equal((await verifyGoogleIdToken(await token(), env, 'expected-nonce', fetcher)).sub, claims.sub);
  for (const change of [{ aud: 'other' },{ iss: 'https://evil.test' },{ exp: now - 1 },{ nonce: 'wrong' },
    { email: 'other@example.test' },{ email_verified: false }])
    await assert.rejects(verifyGoogleIdToken(await token(change), env, 'expected-nonce', fetcher), error => error.code === 'GOOGLE_LOGIN_REJECTED');
  const valid = await token();
  await assert.rejects(verifyGoogleIdToken(valid.slice(0, -8) + 'aaaaaaaa', env, 'expected-nonce', fetcher));
});
