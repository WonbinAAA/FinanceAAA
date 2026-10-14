'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

function verifyLineSignature(raw, signature, secret) {
  if (typeof signature !== 'string' || !signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest();
  let received;
  try { received = Buffer.from(signature, 'base64'); } catch { return false; }
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function configFromEnv(env) {
  const names = ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_ALLOWED_USER_IDS',
    'FINANCE_APP_URL', 'FINANCE_BRIDGE_SECRET'];
  for (const name of names) if (!env[name]) throw new Error(`Missing ${name}`);
  const url = new URL(env.FINANCE_APP_URL);
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' ||
      !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname)) throw new Error('Invalid FINANCE_APP_URL');
  return {
    channelSecret: env.LINE_CHANNEL_SECRET,
    channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
    allowedUserIds: new Set(env.LINE_ALLOWED_USER_IDS.split(',').map(x => x.trim()).filter(Boolean)),
    appUrl: url.toString(), bridgeSecret: env.FINANCE_BRIDGE_SECRET
  };
}

async function forwardEvent(event, config, fetchFn) {
  const payload = JSON.stringify(event);
  const timestamp = Date.now();
  const signature = crypto.createHmac('sha256', config.bridgeSecret)
    .update(`${timestamp}\n${payload}`).digest('base64');
  const response = await fetchFn(config.appUrl, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({timestamp, payload, signature}), signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`Apps Script HTTP ${response.status}`);
  const result = await response.json();
  if (!result.ok || typeof result.reply !== 'string') throw new Error('Apps Script rejected LINE event');
  return result.reply;
}

async function replyToLine(token, message, config, fetchFn) {
  const response = await fetchFn('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {'content-type': 'application/json', authorization: `Bearer ${config.channelAccessToken}`},
    body: JSON.stringify({replyToken: token, messages: [{type: 'text', text: message.slice(0, 5000)}]}),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`LINE reply HTTP ${response.status}`);
}

function createHandler(config, fetchFn = fetch) {
  return async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, {'content-type': 'text/plain'}); res.end('ok'); return;
    }
    if (req.method !== 'POST' || req.url !== '/webhook') {
      res.writeHead(404); res.end(); return;
    }
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) { res.writeHead(413); res.end(); return; }
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks);
      if (!verifyLineSignature(raw, req.headers['x-line-signature'], config.channelSecret)) {
        res.writeHead(401); res.end(); return;
      }
      const body = JSON.parse(raw.toString('utf8'));
      if (!Array.isArray(body.events)) throw new Error('Malformed LINE webhook');
      for (const event of body.events) {
        if (event.source?.type !== 'user' || !config.allowedUserIds.has(event.source.userId) ||
            !event.replyToken) continue;
        const message = await forwardEvent(event, config, fetchFn);
        await replyToLine(event.replyToken, message, config, fetchFn);
      }
      res.writeHead(200); res.end('ok');
    } catch (error) {
      console.error('LINE webhook failed:', error.message);
      res.writeHead(502); res.end('webhook failed');
    }
  };
}

if (require.main === module) {
  const config = configFromEnv(process.env);
  const port = Number(process.env.PORT || 8080);
  http.createServer(createHandler(config)).listen(port, '0.0.0.0', () => {
    console.log(`LINE relay listening on ${port}`);
  });
}

module.exports = {verifyLineSignature, configFromEnv, forwardEvent, createHandler};
