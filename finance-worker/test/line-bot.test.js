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
  const seed = fixture();
  const firstAccount = seed.tables['บัญชี'].rows[0];
  seed.tables['บัญชี'].rows.push(
    { ...firstAccount, _row: 5, account_id: 'KTB', account_name: 'กรุงไทย', opening_balance: 0 },
    { ...firstAccount, _row: 6, account_id: 'CASH', account_name: 'เงินสด', opening_balance: 0 },
  );
  const expenseCategory = seed.tables['หมวดหมู่'].rows[1];
  seed.tables['หมวดหมู่'].rows.push(
    { ...expenseCategory, _row: 7, category_id: 'FOOD', category_name: 'อาหาร' },
    { ...expenseCategory, _row: 8, category_id: 'DINNER', category_name: 'ข้าวเย็น' },
  );
  await commitSnapshot(DB, await loadSnapshot(DB), seed, 'test-line-seed', 'seed', {});
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
    assert.equal(reply.type, 'flex');
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
      source, webhookEventId: 'event-' + number, replyToken: 'reply-' + number,
      timestamp: Date.now() + number,
      ...(content?.type === 'postback' ? { type: 'postback', postback: { data: content.data } }
        : { type: 'message', message: typeof content === 'string' ? { type: 'text', text: content } : content }),
    };
  }
  async function send(content, source) {
    const count = replies.length;
    assert.equal((await submit([event(content, source)])).status, 200);
    assert.equal(replies.length, count + 1);
    return replies.at(-1);
  }
  async function lines() { return (await loadSnapshot(DB)).tables['รายการเงิน'].rows; }
  return { env, DB, submit, event, send, lines, replies, downloads };
}

const replyText = reply => reply.altText;
function actions(component) {
  if (!component) return [];
  if (component.action) return [component.action];
  return (component.contents || []).flatMap(actions);
}
function action(reply, label = 'ยืนยันบันทึก') {
  const button = actions(reply.contents.footer).find(choice => choice.label === label);
  return button.type === 'message' ? button.text : button;
}

function mockLineInput(h, fields) {
  h.env.LINE_AI = { async run(_model, request) {
    const input = request.messages[1]?.content ? JSON.parse(request.messages[1].content) : null;
    const response = fields(input);
    return { choices: [{ message: { content: JSON.stringify(response) } }] };
  } };
}

test('mode buttons accept a natural Thai expense with the default account and keep the ledger pending', async t => {
  const h = await harness(t);
  mockLineInput(h, input => {
    assert.equal(input.scope, 'ส่วนตัว');
    assert.ok(input.categories.some(category => category.id === 'FOOD'));
    return { direction: 'expense', categoryId: 'FOOD', description: 'ซื้อไก่ทอด', dateMentioned: false, amount: '50000' };
  });
  const menu = await h.send('เมนู');
  assert.deepEqual(actions(menu.contents.footer).map(item => item.label), ['ส่วนตัว', 'บริษัท', '📊 สรุปยอดวันนี้']);
  assert.equal(replyText(await h.send(action(menu, 'ส่วนตัว'))), '👤 เลือกส่วนตัวแล้วค่ะ\nพิมพ์รายการหรือส่งรูปสลิปได้เลยค่ะ');
  const draft = await h.send('ซื้อไก่ทอด 50 บาท');
  assert.match(replyText(draft), /จำนวนเงิน 50\.00 บาท[\s\S]*บัญชีที่ใช้จ่าย กรุงไทย[\s\S]*ประเภทรายจ่าย อาหาร[\s\S]*รายละเอียด ซื้อไก่ทอด/);
  assert.equal((await h.lines()).length, 0);
  assert.match(replyText(await h.send('กินข้าวเย็น 50 บาท')), /เลือกส่วนตัวหรือบริษัท/);
  const savedReply = await h.send(action(draft));
  assert.equal(savedReply.type, 'flex');
  assert.equal(replyText(savedReply), '✅ บันทึกรายการซื้อไก่ทอดแล้วค่ะ');
  assert.equal((await h.lines())[0].account_id, 'KTB');
  assert.equal((await h.lines())[0].amount, 50);

  await h.send('ส่วนตัว');
  const cash = await h.send('ซื้อไก่ทอด 50 บาท เงินสด');
  assert.match(replyText(cash), /บัญชีที่ใช้จ่าย เงินสด/);
  await h.send(action(cash));
  assert.equal((await h.lines())[1].account_id, 'CASH');
});

test('personal expense uses the website field order and keeps the actual category separate from details', async t => {
  const h = await harness(t);
  mockLineInput(h, () => ({ direction: 'expense', categoryId: 'FOOD', description: 'ข้าวเย็นไก่ทอด' }));
  await h.send('ส่วนตัว');
  const draft = await h.send('ข้าวเย็นไก่ทอด 50 บาท');
  assert.match(replyText(draft), /รายจ่ายส่วนตัว\nจำนวนเงิน 50\.00 บาท\nวันที่ \d{2}\/\d{2}\/\d{4}\nบัญชีที่ใช้จ่าย กรุงไทย\nประเภทรายจ่าย ข้าวเย็น\nรายละเอียด ไก่ทอด$/u);
  assert.equal(draft.type, 'flex');
  assert.equal(draft.contents.header.contents[0].text, '🍽️');
  assert.deepEqual(draft.contents.body.contents.filter(item => item.type === 'box')
    .map(field => field.contents[0].text), ['จำนวนเงิน', 'วันที่', 'บัญชีที่ใช้จ่าย', 'ประเภทรายจ่าย', 'รายละเอียด']);
  assert.deepEqual(draft.contents.footer.contents.map(tile => tile.contents[0].text), ['✅', '✏️', '❌']);
  assert.deepEqual(draft.contents.footer.contents.map(tile => tile.action.label), ['ยืนยันบันทึก', 'แก้ไข', 'ยกเลิก']);
  assert.equal((await h.lines()).length, 0);
  await h.send(action(draft));
  const [saved] = await h.lines();
  assert.equal(saved.category_id, 'DINNER');
  assert.equal(saved.description, 'ไก่ทอด');

  delete h.env.LINE_AI;
  await h.send('ส่วนตัว');
  const cash = await h.send('ข้าวเย็นไก่ทอด 2 ชิ้น 50 บาท เงินสด 2026-11-16');
  assert.match(replyText(cash), /จำนวนเงิน 50\.00 บาท\nวันที่ 16\/11\/2026\nบัญชีที่ใช้จ่าย เงินสด\nประเภทรายจ่าย ข้าวเย็น\nรายละเอียด ไก่ทอด 2 ชิ้น$/u);
  await h.send(action(cash, 'แก้ไข'));
  const revised = await h.send('รายละเอียด=ไก่ทอดร้านเดิม');
  assert.match(replyText(revised), /ประเภทรายจ่าย ข้าวเย็น\nรายละเอียด ไก่ทอดร้านเดิม$/u);
});

test('one mode choice works for an image, preserves the OCR amount during clarification, and protects the old confirm action', async t => {
  const h = await harness(t);
  mockLineInput(h, input => input
    ? { direction: 'expense', categoryId: 'FOOD', description: 'ค่าอาหาร', dateMentioned: false }
    : { completed: true, amount: '50', date: '2026-11-16' });
  await h.send('ส่วนตัว');
  const scan = await h.send({ type: 'image', id: '12345' });
  assert.match(replyText(scan), /ร่างสลิป · ส่วนตัว[\s\S]*50\.00 บาท[\s\S]*กรุงไทย/);
  const draft = await h.send('จ่ายค่าอาหาร 2 กล่อง');
  assert.match(replyText(draft), /จำนวนเงิน 50\.00 บาท/);
  const edit = await h.send(action(draft, 'แก้ไข'));
  assert.equal(edit.type, 'flex');
  assert.equal(replyText(edit), '✏️ ต้องการแก้ไขส่วนไหนค่ะ');
  assert.match(replyText(await h.send(action(edit, 'จำนวนเงิน'))), /พิมพ์จำนวนเงินใหม่ค่ะ/);
  assert.match(replyText(await h.send('จำนวนเงินใช้ไม่ได้')), /กรอกยอดเป็นตัวเลข/);
  const revised = await h.send('49.75');
  assert.match(replyText(revised), /จำนวนเงิน 49\.75 บาท/);
  assert.match(replyText(await h.send(action(draft))), /รหัสร่างเปลี่ยน/);
  assert.equal((await h.lines()).length, 0);
  await h.send(action(revised));
  assert.equal((await h.lines())[0].amount, 49.75);
});

test('guided input asks for unresolved details and late menu redelivery cannot replace a company choice', async t => {
  const h = await harness(t);
  let captured;
  h.env.COMPANY_LEDGER = { async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/finance/options')) return Response.json({ enabled: true, accounts: [{ account_id: 'KTB', account_name: 'กรุงไทย' }] });
    assert.match(path, /finance\/preview$/);
    captured = await request.json();
    return Response.json({ entries: [{ id: captured.id, personal_cents: 2500 }] });
  } };
  mockLineInput(h, input => ({
    direction: 'expense', description: 'ซื้ออุปกรณ์', categoryId: 'FOOD', accountMention: 'บัญชีอื่น',
  }));
  const stale = h.event('ส่วนตัว');
  await h.submit([stale]);
  await h.send('บริษัท');
  await h.submit([stale]);
  let reply = await h.send('ซื้ออุปกรณ์ 125 บาท บัญชีอื่น');
  assert.match(replyText(reply), /ร่าง · บริษัท[\s\S]*กรุณาเลือกบัญชี/);
  assert.equal(captured, undefined);
  reply = await h.send(action(reply, 'กรุงไทย'));
  assert.match(replyText(reply), /จ่าย · บริษัท[\s\S]*ยอดที่ต้องสำรองจ่าย 25\.00 บาท/);
  assert.equal(captured.finance.accountId, 'KTB');
  assert.equal(captured.itemBase, 'ซื้ออุปกรณ์');
  assert.equal((await h.lines()).length, 0);
});

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
  assert.match(replyText(reply), /85\.50/);
  assert.match(replyText(reply), /15\/11\/2026/);
  assert.equal((await h.lines()).length, 0);
  assert.match(replyText(await h.send(action(reply), { type: 'user', userId: other })), /ไม่พบร่าง/);
  assert.equal((await h.lines()).length, 0);
  await h.submit([h.event(action(reply)), h.event(action(reply))]);
  const [saved] = await h.lines();
  assert.equal((await h.lines()).length, 1);
  assert.equal(saved.status, 'ACTIVE');
  assert.equal(saved.source_type, 'LINE');
  assert.equal(saved.amount, 85.5);
  assert.equal(replyText(await h.send(action(reply))), '✅ บันทึกรายการข้าวเที่ยงแล้วค่ะ');
  await h.submit([draftEvent]);
  assert.equal(replyText(h.replies.at(-1)), '✅ บันทึกรายการข้าวเที่ยงแล้วค่ะ');
  const snapshot = await loadSnapshot(h.DB);
  assert.equal(snapshot.tables['ประวัติการแก้ไข'].rows.find(row => row.record_id === saved.transaction_id).change_source, 'LINE');
  assert.equal(h.DB.sqlite.prepare("SELECT draft_json FROM line_drafts WHERE state='saved'").get().draft_json, null);
});

test('owner can cancel drafts and personal income uses the Finance category', async t => {
  const h = await harness(t);
  const input = 'รับ | 1,500 | ส่วนตัว | ' + bank + ' | รายรับทั่วไป | งานพิเศษ';
  const cancelled = await h.send(input);
  await h.send(action(cancelled, 'ยกเลิก'));
  assert.match(replyText(await h.send(action(cancelled))), /ยกเลิก/);
  assert.equal((await h.lines()).length, 0);
  const active = await h.send(input);
  await h.send(action(active));
  assert.equal((await h.lines())[0].transaction_type, 'INCOME');
  assert.equal((await h.lines())[0].amount, 1500);
  assert.match(replyText(await h.send('รับ | 12,30 | ส่วนตัว | ' + bank + ' | รายรับทั่วไป')), /กรุณากรอกยอด/);
  assert.match(replyText(await h.send('รับ | 1230 | ส่วนตัว | ' + bank + ' | เงินคืนบริษัท')), /ไม่พบหมวดหมู่/);
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
  const [, id] = replyText(scanned).match(/สลิป (L[0-9A-F]+)/);
  assert.match(replyText(scanned), /ยอดที่อ่านได้ 123\.45 บาท/);
  assert.equal(scans, 1);
  assert.match(replyText(await h.send({ ...incoming, id: '9999' })), new RegExp(id));
  assert.equal(scans, 1);
  const initialEvent = h.event('สลิป ' + id + ' | จ่าย | - | ส่วนตัว | ' + bank + ' | รายจ่ายทั่วไป');
  await h.submit([initialEvent]);
  const initial = h.replies.at(-1);
  const revised = await h.send('สลิป ' + id + ' | จ่าย | 124 | ส่วนตัว | ' + bank + ' | รายจ่ายทั่วไป');
  await h.submit([initialEvent]);
  assert.match(replyText(h.replies.at(-1)), /124\.00 บาท/);
  assert.match(replyText(await h.send(action(initial))), /รหัสร่างเปลี่ยน/);
  assert.equal((await h.lines()).length, 0);
  assert.match(replyText(await h.send(action(revised))), /บันทึกรายการ.+แล้วค่ะ/);
  assert.equal((await h.lines())[0].amount, 124);
  assert.equal((await h.lines())[0].ai_status, 'REVIEWED');
  assert.match(replyText(await h.send(incoming)), /บันทึกรายการ.+แล้วค่ะ/);
  assert.equal(scans, 1);
});

test('unreadable slips require the user to supply both amount and date before review', async t => {
  const h = await harness(t);
  h.env.LINE_AI = { async run() { return { response: '{"completed":false,"amount":"120","date":"2026-11-15"}' }; } };
  const scanned = await h.send({ type: 'image', id: '982' });
  const [, id] = replyText(scanned).match(/สลิป (L[0-9A-F]+)/);
  assert.match(replyText(scanned), /กรุณากรอกยอด/);
  const base = ' | รับ | 120 | ส่วนตัว | ' + bank + ' | รายรับทั่วไป';
  assert.match(replyText(await h.send('สลิป ' + id + base)), /กรุณาเพิ่มช่องวันที่/);
  const draft = await h.send('สลิป ' + id + base + ' | วันที่=2026-11-15');
  assert.match(replyText(draft), /120\.00 บาท/);
  assert.equal((await h.lines()).length, 0);
});

test('a matching payer bank and restaurant payment produce an editable dinner draft including the slip memo', async t => {
  const h = await harness(t);
  mockLineInput(h, input => {
    assert.equal(input, null);
    return { completed: true, amount: '60', date: '2026-11-17', time: '19:21',
      payerName: 'นายพงศ์ ร***', payerType: 'person', payerBank: 'บัญชีธนาคารกรุงไทย',
      payeeType: 'meal_merchant', payeeName: 'ร้านอาหารจำลอง', issuerBank: 'กรุงไทย', memo: 'ก๋วยเตี๋ยวรวม' };
  });
  await h.send('ส่วนตัว');
  const image = { type: 'image', id: '2501' };
  const draft = await h.send(image);
  assert.match(replyText(draft), /รายจ่ายส่วนตัว\nจำนวนเงิน 60\.00 บาท\nวันที่ 17\/11\/2026\nบัญชีที่ใช้จ่าย กรุงไทย\nประเภทรายจ่าย ข้าวเย็น\nรายละเอียด ก๋วยเตี๋ยวรวม$/u);
  const storedScan = h.DB.sqlite.prepare('SELECT scan_json FROM line_drafts').get().scan_json;
  assert.doesNotMatch(storedScan, /นายพงศ์|ร้านอาหารจำลอง/u);
  assert.equal(replyText(await h.send(image)), replyText(draft));
  assert.equal((await h.lines()).length, 0);
  assert.equal(replyText(await h.send(action(draft))), '✅ บันทึกรายการก๋วยเตี๋ยวรวมแล้วค่ะ');
  const [saved] = await h.lines();
  assert.equal(saved.transaction_type, 'EXPENSE');
  assert.equal(saved.description, 'ก๋วยเตี๋ยวรวม');
});

test('a known recipient produces an income suggestion and keeps the memo when choosing a category', async t => {
  const h = await harness(t);
  const before = await loadSnapshot(h.DB);
  const updated = structuredClone(before);
  updated.tables['ผู้ใช้งาน'].rows[0].display_name = 'วีระ นามสมมติ';
  await commitSnapshot(h.DB, before, updated, 'slip-owner', 'slip-owner', {});
  mockLineInput(h, () => ({ completed: true, amount: '250.25', date: '2026-11-17',
    payerName: 'นายสมใจ ส***', payeeName: 'นายวีระ น***', payerBank: 'กรุงไทย', payeeBank: 'กรุงไทย',
    perspective: 'payer', memo: 'ค่าจ้างทำป้าย' }));
  await h.send('ส่วนตัว');
  const scan = await h.send({ type: 'image', id: '2502' });
  assert.match(replyText(scan), /รายรับ · 250\.25 บาท · 2026-11-17 · กรุงไทย\nรายละเอียด ค่าจ้างทำป้าย/u);
  assert.doesNotMatch(replyText(scan), /พิมพ์ว่ารับหรือจ่าย/u);
  const draft = await h.send(action(scan, 'รายรับทั่วไป'));
  assert.match(replyText(draft), /รับ · ส่วนตัว[\s\S]*หมายเหตุ ค่าจ้างทำป้าย/u);
  assert.equal((await h.lines()).length, 0);
});

test('an ambiguous person-to-person receipt asks direction without losing the memo', async t => {
  const h = await harness(t);
  mockLineInput(h, () => ({ completed: true, amount: '40', date: '2026-11-17',
    payerType: 'person', payeeType: 'person', issuerBank: 'กรุงไทย', payerBank: 'กรุงไทย',
    payeeBank: 'กรุงไทย', memo: 'ก๋วยเตี๋ยวรวม' }));
  await h.send('ส่วนตัว');
  const scan = await h.send({ type: 'image', id: '2503' });
  assert.match(replyText(scan), /รายละเอียด ก๋วยเตี๋ยวรวม[\s\S]*พิมพ์ว่ารับหรือจ่าย/u);
  const withDirection = await h.send(action(scan, 'รายจ่าย'));
  assert.match(replyText(withDirection), /รายจ่ายส่วนตัว[\s\S]*บัญชีที่ใช้จ่าย กรุงไทย[\s\S]*รายละเอียด ก๋วยเตี๋ยวรวม/u);
  const draft = await h.send('ข้าวเย็น');
  assert.match(replyText(draft), /ประเภทรายจ่าย ข้าวเย็น\nรายละเอียด ก๋วยเตี๋ยวรวม$/u);
  assert.equal((await h.lines()).length, 0);
});

test('resending a pending receipt from the old reader fills its memo without replacing user-entered fields', async t => {
  const h = await harness(t);
  let upgraded = false;
  mockLineInput(h, () => upgraded ? { completed: true, amount: '60', date: '2026-11-17', time: '19:21',
    payerType: 'person', payeeType: 'meal_merchant', issuerBank: 'กรุงไทย', payerBank: 'กรุงไทย',
    memo: 'ก๋วยเตี๋ยวรวม' } : { completed: true, amount: '61', date: '2026-11-16' });
  await h.send('ส่วนตัว');
  const image = { type: 'image', id: '2504' };
  await h.send(image);
  const receipt = h.DB.sqlite.prepare('SELECT id FROM line_drafts').get();
  h.DB.sqlite.prepare('UPDATE line_drafts SET scan_json=? WHERE id=?')
    .run(JSON.stringify({ cents: 6100, date: '2026-11-16' }), receipt.id);
  await h.send('รายจ่าย');
  await h.send('ยอด=62');
  const oldDraft = await h.send('ข้าวเย็น');
  assert.match(replyText(oldDraft), /รายละเอียด —$/u);
  upgraded = true;
  const draft = await h.send(image);
  assert.match(replyText(draft), /จำนวนเงิน 62\.00 บาท\nวันที่ 16\/11\/2026[\s\S]*ข้าวเย็น\nรายละเอียด ก๋วยเตี๋ยวรวม/u);
  assert.equal(h.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM line_drafts').get().n, 1);
  assert.equal((await h.lines()).length, 0);
  assert.match(replyText(await h.send(action(oldDraft))), /รหัสร่างเปลี่ยนแล้วค่ะ/);
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
  assert.match(replyText(draft), /สำรองจ่าย 25\.00 บาท/);
  assert.equal(writes, 0);
  assert.match(replyText(await h.send(action(draft))), /ยังตรวจผลไม่ได้/);
  h.DB.sqlite.exec("UPDATE line_drafts SET lease_until=0 WHERE state='saving'");
  assert.equal(replyText(await h.send(action(draft))),
    '✅ บันทึกรายการค่าวัสดุแล้วค่ะ\nยอดบัญชีกำลังรออัปเดตค่ะ');
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
  assert.match(replyText(await h.send(action(expenseDraft))), /ยอดเงินบริษัทเปลี่ยนแล้ว/);
  assert.equal(h.DB.sqlite.prepare('SELECT state FROM line_drafts').get().state, 'ready');
  await h.send(action(expenseDraft, 'ยกเลิก'));
  const newer = await h.send('จ่าย | 100 | บริษัท | ' + bank + ' | ค่าวัสดุ');
  assert.match(replyText(newer), /สำรองจ่าย 70\.00 บาท/);
  const incomeDraft = await h.send('รับ | 500 | บริษัท | ' + bank + ' | เงินโอนจากบริษัท');
  assert.equal(replyText(await h.send(action(incomeDraft))), '✅ บันทึกรายการเงินโอนจากบริษัทแล้วค่ะ');
  assert.equal(writes, 2);
});

test('today in Bangkok totals both ledgers separately and keeps the active draft', async t => {
  const h = await harness(t);
  t.mock.method(Date, 'now', () => Date.parse('2026-11-16T17:02:00Z'));
  const date = '2026-11-17';
  const stored = await loadSnapshot(h.DB);
  const snapshot = structuredClone(stored);
  const rows = snapshot.tables['รายการเงิน'].rows;
  const add = (id, amount, details = {}) => rows.push({ _row: rows.length + 3,
    transaction_id: id, user_id: 'USR001', account_id: 'ACC1', expense_owner: 'PERSONAL',
    category_id: 'EX', transaction_date: date, transaction_type: 'EXPENSE', status: 'ACTIVE', amount, ...details });
  add('income', 200.1, { transaction_type: 'INCOME', category_id: 'IN' });
  add('expense', 50.25);
  add('void', 3, { status: 'VOID' });
  add('draft', 4, { status: 'DRAFT' });
  add('other-day', 5, { transaction_date: '2026-11-16' });
  add('transfer', 6, { transaction_type: 'TRANSFER' });
  add('mirror', 7);
  const link = h.DB.prepare("INSERT INTO company_link_groups VALUES('test-group','mirror','test-hash','{}')");
  await commitSnapshot(h.DB, stored, snapshot, 'daily-rows', 'daily-rows', {}, [link]);
  h.env.COMPANY_LEDGER = { async fetch(request) {
    const url = new URL(request.url);
    assert.equal(request.method, 'GET');
    assert.equal(url.pathname + url.search, '/finance/api/export?format=pdf-data&from=' + date + '&to=' + date);
    return Response.json({ rows: [
      { date, direction: 'income', amount_cents: 2000 },
      { date, direction: 'expense', amount_cents: 3109 },
      { date: '2026-11-16', direction: 'expense', amount_cents: 711 },
    ] });
  } };
  await h.send('ส่วนตัว');
  const pending = await h.send('ข้าวเย็นไก่ทอด 50 บาท');
  assert.equal(pending.type, 'flex');
  const summary = await h.send(action(await h.send('เมนู'), '📊 สรุปยอดวันนี้'));
  assert.equal(summary.type, 'flex');
  assert.equal(replyText(summary),
    '📊 สรุปยอดวันนี้ · 17/11/2026\n👤 ส่วนตัว\nรายรับวันนี้ 200.10 บาท\nรายจ่ายวันนี้ 50.25 บาท\nยอดสุทธิ 149.85 บาท'
    + '\n🏢 บริษัท\nรายรับวันนี้ 20.00 บาท\nรายจ่ายวันนี้ 31.09 บาท\nยอดสุทธิ -11.09 บาท');
  assert.equal(replyText(await h.send('ร่าง')), replyText(pending));
  assert.equal((await h.lines()).length, 7);
  delete h.env.COMPANY_LEDGER;
  assert.match(replyText(await h.send('สรุปยอดวันนี้')), /ยอดสุทธิ 149\.85 บาท\n🏢 บริษัท\nยังอ่านยอดไม่ได้ค่ะ$/u);
});

test('the editor uses live personal categories, rejects an inactive older choice, and reviews updates before saving', async t => {
  const h = await harness(t);
  t.mock.method(Date, 'now', () => Date.parse('2026-11-16T17:02:00Z'));
  await h.send('ส่วนตัว');
  let draft = await h.send('ข้าวเย็นไก่ทอด 50 บาท');
  const edit = await h.send(action(draft, 'แก้ไข'));
  assert.deepEqual(actions(edit.contents.footer).map(button => button.label),
    ['จำนวนเงิน', 'วันที่', 'บัญชีที่ใช้จ่าย', 'ประเภทรายจ่าย', 'รายละเอียด', 'ตรวจร่าง', 'ยกเลิก']);
  const oldChoices = await h.send(action(edit, 'ประเภทรายจ่าย'));
  assert.ok(actions(oldChoices.contents.footer).some(button => button.label === 'อาหาร'));
  const before = await loadSnapshot(h.DB);
  const updated = structuredClone(before);
  const categories = updated.tables['หมวดหมู่'].rows;
  categories.find(category => category.category_id === 'FOOD').is_active = false;
  for (let index = 1; index <= 5; index++) {
    categories.push({ ...categories.find(category => category.category_id === 'DINNER'),
      _row: 8 + index, category_id: 'NEW-' + index, category_name: 'หมวดใหม่ ' + index, sort_order: 20 + index });
  }
  await commitSnapshot(h.DB, before, updated, 'edit-categories', 'edit-categories', {});

  const fresh = await h.send(action(oldChoices, 'อาหาร'));
  assert.match(replyText(fresh), /ตัวเลือกนี้เปลี่ยนแล้วค่ะ/);
  assert.ok(!actions(fresh.contents.footer).some(button => button.label === 'อาหาร'));
  const second = await h.send(action(fresh, 'ดูเพิ่มเติม'));
  assert.match(replyText(second), /หน้า 2\/2/);
  const chooseLast = action(second, 'หมวดใหม่ 5');
  assert.match(replyText(await h.send(chooseLast, { type: 'user', userId: other })), /ไม่พบร่าง/);
  draft = await h.send(chooseLast);
  assert.match(replyText(draft), /ประเภทรายจ่าย หมวดใหม่ 5\nรายละเอียด ไก่ทอด$/);
  assert.equal(replyText(await h.send(chooseLast)), replyText(draft));

  const dates = await h.send(action(await h.send(action(draft, 'แก้ไข')), 'วันที่'));
  assert.deepEqual(actions(dates.contents.footer).map(button => button.label),
    ['วันนี้', 'เมื่อวาน', 'ระบุวันที่เอง', 'กลับไปเลือกช่อง']);
  draft = await h.send(action(dates, 'เมื่อวาน'));
  assert.match(replyText(draft), /วันที่ 16\/11\/2026/);
  const accounts = await h.send(action(await h.send(action(draft, 'แก้ไข')), 'บัญชีที่ใช้จ่าย'));
  draft = await h.send(action(accounts, 'เงินสด'));
  assert.match(replyText(draft), /บัญชีที่ใช้จ่าย เงินสด/);
  const notes = await h.send(action(await h.send(action(draft, 'แก้ไข')), 'รายละเอียด'));
  assert.match(replyText(notes), /พิมพ์รายละเอียดใหม่ค่ะ/);
  draft = await h.send('ไก่ทอด 2 ชิ้น');
  assert.match(replyText(draft), /จำนวนเงิน 50\.00 บาท[\s\S]*รายละเอียด ไก่ทอด 2 ชิ้น$/);
  assert.equal((await h.lines()).length, 0);
  await h.send(action(draft));
  const [saved] = await h.lines();
  assert.equal(saved.category_id, 'NEW-5');
  assert.equal(saved.account_id, 'CASH');
  assert.equal(saved.transaction_date, '2026-11-16');
  assert.equal(saved.description, 'ไก่ทอด 2 ชิ้น');
});

test('company item and vehicle menus read the company directory and enforce applicable fields', async t => {
  const h = await harness(t);
  const refs = [
    { id: 'materials', name: 'ค่าวัสดุ', kind: 'item', direction: 'expense', active: 1 },
    { id: 'vehicle-item', name: 'ค่าดูแลรถ', kind: 'item', direction: 'expense', active: 1, vehicle_required: 1 },
    { id: 'salary', name: 'เงินรับ', kind: 'item', direction: 'income', active: 1 },
    { id: 'old', name: 'รายการปิดแล้ว', kind: 'item', direction: 'expense', active: 0 },
    { id: 'v1', name: 'ทะเบียนจำลอง', kind: 'vehicle', active: 1 },
    { id: 'p1', name: 'โครงการจำลอง', kind: 'project', active: 1 },
  ];
  let previewBody;
  h.env.COMPANY_LEDGER = { async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/bootstrap')) return Response.json({ refs });
    if (path.endsWith('/finance/options')) return Response.json({ enabled: true, accounts: [
      { account_id: 'ACC1', account_name: bank }, { account_id: 'KTB', account_name: 'กรุงไทย' },
    ] });
    assert.ok(path.endsWith('/finance/preview'));
    previewBody = await request.json();
    if (previewBody.itemBase === 'ค่าดูแลรถ' && !previewBody.vehicleId)
      return Response.json({ error: 'รายการนี้ต้องระบุทะเบียนรถ' }, { status: 400 });
    return Response.json({ entries: [{ id: previewBody.id, personal_cents: 0 }] });
  } };
  const draft = await h.send('จ่าย | 100 | บริษัท | ' + bank + ' | ค่าวัสดุ');
  const edit = await h.send(action(draft, 'แก้ไข'));
  assert.ok(!actions(edit.contents.footer).some(button => button.label === 'ทะเบียนรถ'));
  const items = await h.send(action(edit, 'รายการ'));
  assert.deepEqual(actions(items.contents.footer).map(button => button.label),
    ['ค่าวัสดุ', 'ค่าดูแลรถ', 'พิมพ์ชื่อรายการ', 'กลับไปเลือกช่อง']);
  const incomplete = await h.send(action(items, 'ค่าดูแลรถ'));
  assert.match(replyText(incomplete), /รายการนี้ต้องระบุทะเบียนรถ/);
  const vehicles = await h.send(action(incomplete, 'ทะเบียนรถ'));
  const reviewed = await h.send(action(vehicles, 'ทะเบียนจำลอง'));
  assert.match(replyText(reviewed), /รายการ ค่าดูแลรถ\nทะเบียน ทะเบียนจำลอง/);
  const projects = await h.send(action(await h.send(action(reviewed, 'แก้ไข')), 'โครงการ'));
  const withProject = await h.send(action(projects, 'โครงการจำลอง'));
  assert.match(replyText(withProject), /โครงการ โครงการจำลอง/);
  assert.equal(previewBody.projectId, 'p1');
  assert.equal(previewBody.vehicleId, 'v1');
  assert.equal((await h.lines()).length, 0);
});
