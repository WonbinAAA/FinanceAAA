'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {Readable} = require('node:stream');
const {verifyLineSignature, configFromEnv, createHandler} = require('./line-relay');

const config = configFromEnv({
  LINE_CHANNEL_SECRET: 'line-secret', LINE_CHANNEL_ACCESS_TOKEN: 'access-token',
  LINE_ALLOWED_USER_IDS: 'UOWNER', FINANCE_APP_URL: 'https://script.google.com/macros/s/test/exec',
  FINANCE_BRIDGE_SECRET: 'bridge-secret'
});
function request(body, signature) {
  const req = Readable.from([body]);
  Object.assign(req, {method: 'POST', url: '/webhook', headers: {'x-line-signature': signature}});
  const res = {status: 0, writeHead(code) {this.status = code;}, end() {this.ended = true;}};
  return {req, res};
}
function signed(body) {
  return crypto.createHmac('sha256', config.channelSecret).update(body).digest('base64');
}
async function run() {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({url, options});
    if (url === config.appUrl) return new Response(JSON.stringify({ok: true, reply: 'สร้างร่างแล้ว'}),
      {status: 200, headers: {'content-type': 'application/json'}});
    return new Response('{}', {status: 200});
  };
  const handler = createHandler(config, fetchFn);
  const event = {type: 'message', webhookEventId: 'E1', replyToken: 'R1',
    source: {type: 'user', userId: 'UOWNER'}, message: {type: 'text', text: 'รับ | 1 | เงินเดือน | กรุงไทย | ทดสอบ'}};
  const raw = Buffer.from(JSON.stringify({events: [event]}));
  assert.equal(verifyLineSignature(raw, signed(raw), config.channelSecret), true);
  assert.equal(verifyLineSignature(raw, 'bad', config.channelSecret), false);
  const bad = request(raw, 'bad');
  await handler(bad.req, bad.res);
  assert.equal(bad.res.status, 401);
  assert.equal(calls.length, 0);
  const good = request(raw, signed(raw));
  await handler(good.req, good.res);
  assert.equal(good.res.status, 200);
  assert.equal(calls.length, 2);
  const envelope = JSON.parse(calls[0].options.body);
  assert.deepEqual(JSON.parse(envelope.payload), event);
  assert.equal(envelope.signature, crypto.createHmac('sha256', config.bridgeSecret)
    .update(`${envelope.timestamp}\n${envelope.payload}`).digest('base64'));
  assert.equal(calls[1].url, 'https://api.line.me/v2/bot/message/reply');
  assert.equal(JSON.parse(calls[1].options.body).messages[0].text, 'สร้างร่างแล้ว');
  assert.equal(calls[1].options.headers.authorization, 'Bearer access-token');
  const unauthorized = Buffer.from(JSON.stringify({events: [{...event, source: {type: 'user', userId: 'UOTHER'}}]}));
  const ignored = request(unauthorized, signed(unauthorized));
  await handler(ignored.req, ignored.res);
  assert.equal(ignored.res.status, 200);
  assert.equal(calls.length, 2);
  const verify = Buffer.from(JSON.stringify({events: []}));
  const empty = request(verify, signed(verify));
  await handler(empty.req, empty.res);
  assert.equal(empty.res.status, 200);
  assert.equal(calls.length, 2);
  assert.throws(() => configFromEnv({...{
    LINE_CHANNEL_SECRET: 'x', LINE_CHANNEL_ACCESS_TOKEN: 'x', LINE_ALLOWED_USER_IDS: 'x',
    FINANCE_APP_URL: 'http://example.com/exec', FINANCE_BRIDGE_SECRET: 'x'
  }}), /Invalid FINANCE_APP_URL/);
  console.log('PASS LINE relay signature, authorization, forwarding and reply');
}
run().catch(error => {console.error(error); process.exitCode = 1;});
