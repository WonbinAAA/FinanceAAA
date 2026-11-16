import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { commitSnapshot, loadSnapshot } from '../src/storage.js';
import worker from '../src/worker.js';
import { fixture, testDb } from './helpers.js';

const allowed = 'U' + 'a'.repeat(32);
const other = 'U' + 'b'.repeat(32);
const secret = 'test-signature-key';
const fakeImage = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 9);
const bank = 'บัญชีจำลอง A';
const expense = 'จ่าย | 85.50 | ส่วนตัว | ' + bank + ' | รายจ่ายทั่วไป | ข้าวเที่ยง';

async function harness(t) {
  const DB = testDb();
  await commitSnapshot(DB, await loadSnapshot(DB), fixture(), 'test-line-seed', 'seed', {});
  const replies = [];
  const downloads = [];
  const env = {
    DB, LINE_CHANNEL_SECRET: secret, LINE_CHANNEL_ACCESS_TOKEN: 'test-token',
    LINE_ALLOWED_USER_IDS: allowed + ',' + other,
  };
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input);
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.equal(options.redirect, 'manual');
    if (url.hostname === 'api-data.line.me') {
      downloads.push(url.pathname);
      return new Response(fakeImage);
    }
    assert.equal(url.href, 'https://api.line.me/v2/bot/message/reply');
    const payload = JSON.parse(options.body);
    const reply = payload.messages[0];
    replies.push(reply);
    return new Response('{}');
  });
  async function submit(events, signingKey = secret) {
    const body = JSON.stringify({ events });
    const waits = [];
    const response = await worker.fetch(new Request('https://finance.invalid/webhooks/line', {
      method: 'POST', body,
      headers: { 'x-line-signature': createHmac('sha256', signingKey).update(body).digest('base64') },
    }), env, { waitUntil(promise) { waits.push(promise); } });
    await Promise.all(waits);
    return response;
  }
  let ordinal = 0;
  function event(content, source = { type: 'user', userId: allowed }) {
    const number = ++ordinal;
    return {
      type: 'message', source, webhookEventId: 'event-' + number, replyToken: 'reply-' + number,
      timestamp: Date.now() + number,
      message: typeof content === 'string' ? { type: 'text', text: content } : content,
    };
  }
  async function send(content, source) {
    assert.equal((await submit([event(content, source)])).status, 200);
    return replies.at(-1);
  }
  async function lines() { return (await loadSnapshot(DB)).tables['รายการเงิน'].rows; }
  return { env, DB, submit, event, send, lines, replies, downloads };
}

const action = (reply, label = 'ยืนยันบันทึก') =>
  reply.quickReply.items.find(item => item.action.label === label).action.text;

test('webhook verifies exact signed bytes before reading any LINE message', async t => {
  const h = await harness(t);
  const image = { type: 'image', id: '123456' };
  assert.equal((await h.submit([h.event(image)], 'wrong')).status, 401);
  assert.equal((await h.submit([])).status, 200);
  await h.submit([
    h.event(image, { type: 'group', userId: allowed }),
    h.event(image, { type: 'user', userId: 'U' + 'f'.repeat(32) }),
  ]);
  assert.equal(h.downloads.length, 0);
  assert.equal(h.replies.length, 0);
  assert.equal(h.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM line_drafts').get().n, 0);
  delete h.env.LINE_CHANNEL_SECRET;
  assert.equal((await h.submit([])).status, 503);
});

test('personal draft has no ledger effect until its owner confirms and replays safely', async t => {
  const h = await harness(t);
  const draftEvent = h.event(expense + ' | วันที่=๒๕๖๙-๑๑-๑๕');
  await h.submit([draftEvent]);
  const reply = h.replies.at(-1);
  assert.match(reply.text, /85\.50/);
  assert.match(reply.text, /2026-11-15/);
  assert.equal((await h.lines()).length, 0);
  assert.match((await h.send(action(reply), { type: 'user', userId: other })).text, /ไม่พบร่าง/);
  assert.equal((await h.lines()).length, 0);
  await h.submit([h.event(action(reply)), h.event(action(reply))]);
  const [saved] = await h.lines();
  assert.equal((await h.lines()).length, 1);
  assert.equal(saved.status, 'ACTIVE');
  assert.equal(saved.source_type, 'LINE');
  assert.equal(saved.amount, 85.5);
  assert.match((await h.send(action(reply))).text, /บันทึกแล้ว/);
  await h.submit([draftEvent]);
  assert.match(h.replies.at(-1).text, /บันทึกแล้ว/);
  const snapshot = await loadSnapshot(h.DB);
  assert.equal(snapshot.tables['ประวัติการแก้ไข'].rows.find(row => row.record_id === saved.transaction_id).change_source, 'LINE');
  assert.equal(h.DB.sqlite.prepare("SELECT draft_json FROM line_drafts WHERE state='saved'").get().draft_json, null);
});

test('owner can cancel drafts and personal income uses the Finance category', async t => {
  const h = await harness(t);
  const input = 'รับ | 1,500 | ส่วนตัว | ' + bank + ' | รายรับทั่วไป | งานพิเศษ';
  const cancelled = await h.send(input);
  await h.send(action(cancelled, 'ยกเลิก'));
  assert.match((await h.send(action(cancelled))).text, /ยกเลิก/);
  assert.equal((await h.lines()).length, 0);
  const active = await h.send(input);
  await h.send(action(active));
  assert.equal((await h.lines())[0].transaction_type, 'INCOME');
  assert.equal((await h.lines())[0].amount, 1500);
  assert.match((await h.send('รับ | 12,30 | ส่วนตัว | ' + bank + ' | รายรับทั่วไป')).text, /กรุณากรอกยอด/);
  assert.match((await h.send('รับ | 1230 | ส่วนตัว | ' + bank + ' | เงินคืนบริษัท')).text, /ไม่พบหมวดหมู่/);
});

test('OCR gives only proposed values, replays one image, and old buttons cannot confirm a revised slip', async t => {
  const h = await harness(t);
  let scans = 0;
  h.env.LINE_AI = { async run(model, input) {
    scans++;
    assert.equal(model, '@cf/qwen/qwen3.8-27b');
    assert.match(input.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
    return { choices: [{ message: { content: '{"completed":true,"amount":"123.45","date":"2569-11-15"}' } }] };
  } };
  const incoming = { type: 'image', id: '123456' };
  const scanned = await h.send(incoming);
  const [, id] = scanned.text.match(/สลิป (L[0-9A-F]+)/);
  assert.match(scanned.text, /ยอดที่อ่านได้ 123\.45 บาท/);
  assert.equal(scans, 1);
  assert.match((await h.send({ ...incoming, id: '9999' })).text, new RegExp(id));
  assert.equal(scans, 1);
  const initialEvent = h.event('สลิป ' + id + ' | จ่าย | - | ส่วนตัว | ' + bank + ' | รายจ่ายทั่วไป');
  await h.submit([initialEvent]);
  const initial = h.replies.at(-1);
  const revised = await h.send('สลิป ' + id + ' | จ่าย | 124 | ส่วนตัว | ' + bank + ' | รายจ่ายทั่วไป');
  await h.submit([initialEvent]);
  assert.match(h.replies.at(-1).text, /124\.00 บาท/);
  assert.match((await h.send(action(initial))).text, /รหัสร่างเปลี่ยน/);
  assert.equal((await h.lines()).length, 0);
  assert.match((await h.send(action(revised))).text, /บันทึกแล้ว/);
  assert.equal((await h.lines())[0].amount, 124);
  assert.equal((await h.lines())[0].ai_status, 'REVIEWED');
  assert.match((await h.send(incoming)).text, /บันทึกแล้ว/);
  assert.equal(scans, 1);
});

test('unreadable slips require the user to supply both amount and date before review', async t => {
  const h = await harness(t);
  h.env.LINE_AI = { async run() { return { response: '{"completed":false,"amount":"120","date":"2026-11-15"}' }; } };
  const scanned = await h.send({ type: 'image', id: '982' });
  const [, id] = scanned.text.match(/สลิป (L[0-9A-F]+)/);
  assert.match(scanned.text, /กรุณากรอกยอด/);
  const base = ' | รับ | 120 | ส่วนตัว | ' + bank + ' | รายรับทั่วไป';
  assert.match((await h.send('สลิป ' + id + base)).text, /กรุณาเพิ่มช่องวันที่/);
  const draft = await h.send('สลิป ' + id + base + ' | วันที่=2026-11-15');
  assert.match(draft.text, /120\.00 บาท/);
  assert.equal((await h.lines()).length, 0);
});

test('company uses native entry preview and commit with a stable mutation ID after an uncertain response', async t => {
  const h = await harness(t);
  let companyRecord;
  let writes = 0;
  const options = { enabled: true, pending: 1, accounts: [{ account_id: 'ACC1', account_name: bank }] };
  h.env.COMPANY_LEDGER = { async fetch(request) {
    const url = new URL(request.url);
    assert.equal(request.headers.get('origin'), url.origin);
    if (url.pathname.endsWith('/finance/options')) return Response.json(options);
    if (url.pathname.endsWith('/finance/preview')) {
      const body = await request.json();
      return Response.json({ entries: [{ id: body.id, personal_cents: 2500 }] });
    }
    if (url.pathname.endsWith('/mutation-status')) {
      const found = companyRecord && url.searchParams.get('mutationId') === companyRecord.mutationId;
      return Response.json(found ? { found: true, result: { id: companyRecord.id } } : { found: false });
    }
    assert.equal(url.pathname, '/finance/api/entries');
    const body = await request.json();
    assert.equal(body.expectedPersonalCents, 2500);
    assert.deepEqual(body.finance, { accountId: 'ACC1', kind: 'EXPENSE' });
    writes++;
    companyRecord = body;
    throw new Error('response lost after commit');
  } };
  const draft = await h.send('จ่าย | 100 | บริษัท | ' + bank + ' | ค่าวัสดุ');
  assert.match(draft.text, /สำรองจ่าย 25\.00 บาท/);
  assert.equal(writes, 0);
  assert.match((await h.send(action(draft))).text, /ยังตรวจผลไม่ได้/);
  h.DB.sqlite.exec("UPDATE line_drafts SET lease_until=0 WHERE state='saving'");
  assert.match((await h.send(action(draft))).text, /ยอดบัญชีกำลังรออัปเดต/);
  assert.equal(writes, 1);
  assert.equal((await h.lines()).length, 0);
});

test('company shortfall conflict produces no Finance entry and can be reviewed again', async t => {
  const h = await harness(t);
  let writes = 0;
  h.env.COMPANY_LEDGER = { async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/finance/options')) return Response.json({ enabled: true, accounts: [{ account_id: 'ACC1', account_name: bank }] });
    if (path.endsWith('/finance/preview')) {
      const body = await request.json();
      const cents = body.direction === 'income' ? 0 : writes ? 7000 : 5000;
      return Response.json({ entries: [{ id: body.id, personal_cents: cents }] });
    }
    if (path.endsWith('/mutation-status')) return Response.json({ found: false });
    const body = await request.json();
    writes++;
    if (body.direction === 'income') {
      assert.equal(body.finance.kind, 'ADVANCE');
      assert.equal(body.expectedPersonalCents, undefined);
      return Response.json({ id: body.id, finance: { pending: 0 } });
    }
    assert.equal(body.expectedPersonalCents, 5000);
    return Response.json({ error: 'ยอดเงินบริษัทเปลี่ยนแล้ว' }, { status: 409 });
  } };
  const expenseDraft = await h.send('จ่าย | 100 | บริษัท | ' + bank + ' | ค่าวัสดุ');
  assert.match((await h.send(action(expenseDraft))).text, /ยอดเงินบริษัทเปลี่ยนแล้ว/);
  assert.equal(h.DB.sqlite.prepare('SELECT state FROM line_drafts').get().state, 'ready');
  await h.send(action(expenseDraft, 'ยกเลิก'));
  const newer = await h.send('จ่าย | 100 | บริษัท | ' + bank + ' | ค่าวัสดุ');
  assert.match(newer.text, /สำรองจ่าย 70\.00 บาท/);
  const incomeDraft = await h.send('รับ | 500 | บริษัท | ' + bank + ' | เงินโอนจากบริษัท');
  assert.match((await h.send(action(incomeDraft))).text, /บันทึกแล้ว/);
  assert.equal(writes, 2);
});
