import { AppError, json } from './errors.js';
import { sha256 } from './auth.js';
import { baht, listLineChoices, parseAmount, parseDate, prepareLineDraft, saveLineDraft } from './line-ledger.js';
import { downloadSlip, readLimitedBody, readSlip } from './line-slip.js';

const thaiDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bangkok' });
const draftAge = 24 * 60 * 60 * 1000;
const lease = 45 * 1000;
const directions = { รับ: 'income', จ่าย: 'expense' };
const optionalFields = { วันที่: 'date', โครงการ: 'project', ทะเบียน: 'vehicle', ที่พัก: 'lodging' };

const help = 'พิมพ์ รับ หรือ จ่าย | ยอด | ส่วนตัว หรือ บริษัท | บัญชี | หมวดหรือชื่อรายการ | หมายเหตุ (ถ้ามี)\n'
  + 'ตัวอย่าง: จ่าย | 85.50 | ส่วนตัว | เงินสด | อาหาร | ข้าวเที่ยง\n'
  + 'เพิ่ม | วันที่=2026-11-15 เพื่อใช้วันที่อื่น\n'
  + 'รายการบริษัทเพิ่ม | โครงการ=ชื่อ | ทะเบียน=ชื่อ | ที่พัก=ชื่อ ได้ตามรายการ\n'
  + 'ส่งรูปสลิปได้โดยตรงค่ะ\n'
  + 'พิมพ์ “ร่าง” หรือ “ตัวเลือก” เพื่อดูข้อมูลเพิ่มเติมค่ะ';

function message(text, buttons = []) {
  const response = { type: 'text', text };
  if (buttons.length) response.quickReply = {
    items: buttons.map(([label, text]) => ({ type: 'action', action: { type: 'message', label, text } })),
  };
  return response;
}

function parseEntry(parts, scan) {
  const [command, amount, scope, account, item, ...extras] = parts;
  if (!Object.hasOwn(directions, command) || !['ส่วนตัว', 'บริษัท'].includes(scope) || !account || !item) {
    throw new AppError('กรุณาระบุ รับ/จ่าย, ยอด, ส่วนตัว/บริษัท, บัญชี และหมวดหรือชื่อรายการค่ะ');
  }
  if (account.length > 200 || item.length > 200) throw new AppError('ชื่อบัญชีหรือรายการยาวเกิน 200 ตัวอักษรค่ะ');
  const data = { direction: directions[command], scope, account, item, note: '', fromImage: !!scan };
  if (extras[0] && !extras[0].includes('=')) data.note = extras.shift();
  if (extras[0] === '') extras.shift();
  if (data.note.length > 2000) throw new AppError('หมายเหตุยาวเกิน 2,000 ตัวอักษรค่ะ');
  for (const field of extras) {
    const fieldMatch = field.match(/^([^=]+)=(.+)$/u);
    const key = fieldMatch?.[1].trim();
    if (!key || !Object.hasOwn(optionalFields, key)) throw new AppError('กรอกช่องเพิ่มเติมตามตัวอย่างใน “ช่วยเหลือ” ค่ะ');
    const property = optionalFields[key];
    const value = fieldMatch[2].trim();
    if (!value || value.length > 200 || Object.hasOwn(data, property))
      throw new AppError('กรุณาตรวจค่าช่องเพิ่มเติมและกรอกแต่ละช่องครั้งเดียวค่ะ');
    if (scope === 'ส่วนตัว' && property !== 'date') throw new AppError('โครงการ ทะเบียน และที่พักใช้กับรายการบริษัทค่ะ');
    data[property] = value;
  }
  data.cents = amount === '-' && scan ? scan.cents : parseAmount(amount);
  if (!data.cents) throw new AppError('กรุณากรอกยอดมากกว่า 0 และใช้ทศนิยมสูงสุดสองตำแหน่งค่ะ');
  data.date = data.date ? parseDate(data.date) : scan ? scan.date : thaiDate.format(new Date());
  if (!data.date) throw new AppError('กรุณาเพิ่มช่องวันที่ เช่น | วันที่=2026-11-15 ค่ะ');
  return data;
}

function getDraft(db, owner, id) {
  return db.prepare('SELECT * FROM line_drafts WHERE id=? AND owner_hash=?').bind(id, owner).first();
}

function code(row) {
  return row.id + (row.version ? '-' + row.version : '');
}

function draftMessage(row) {
  if (!row) return message('ไม่พบร่างนี้ค่ะ พิมพ์ “ร่าง” เพื่อตรวจรายการอีกครั้ง');
  if (row.state === 'expired') return message('ร่าง ' + row.id + ' หมดอายุแล้วค่ะ ส่งข้อความหรือรูปใหม่ได้เลย');
  if (row.state === 'cancelled') return message('ยกเลิกร่าง ' + row.id + ' แล้วค่ะ');
  if (row.state === 'saved') {
    const result = JSON.parse(row.result_json);
    return message('บันทึกแล้วค่ะ\nรหัสรายการ ' + result.id
      + (result.pending ? '\nรายการอยู่ในสมุดบริษัท ยอดบัญชีกำลังรออัปเดตค่ะ' : ''));
  }
  if (row.state === 'details') {
    if (!row.scan_json) return message('กำลังอ่านสลิป ' + row.id + ' ค่ะ พิมพ์ “ร่าง” เพื่อตรวจอีกครั้ง');
    const scan = JSON.parse(row.scan_json);
    const example = 'สลิป ' + row.id + ' | จ่าย | ' + (scan.cents ? '-' : '[กรอกยอด]')
      + ' | ส่วนตัว | เงินสด | อาหาร' + (scan.date ? '' : ' | วันที่=YYYY-MM-DD');
    return message('สลิป ' + row.id + '\nยอดที่อ่านได้ ' + (scan.cents ? baht(scan.cents) + ' บาท' : 'กรุณากรอกยอด')
      + '\nวันที่ ' + (scan.date || 'กรุณากรอกวันที่')
      + '\nเติมรายละเอียดตามตัวอย่างด้านล่าง เปลี่ยนยอดและวันที่ได้ก่อนยืนยันค่ะ\n' + example,
    [['ยกเลิก', 'ยกเลิก ' + code(row)]]);
  }
  const { summary } = JSON.parse(row.draft_json);
  const lines = [
    row.state === 'saving' ? 'กำลังตรวจผลการบันทึก ' + code(row) : 'ตรวจร่าง ' + code(row),
    (summary.direction === 'income' ? 'รับ' : 'จ่าย') + ' · ' + summary.scope,
    'ยอด ' + baht(summary.cents) + ' บาท', 'วันที่ ' + summary.date,
    'บัญชี ' + summary.account, (summary.scope === 'บริษัท' ? 'รายการ ' : 'หมวด ') + summary.item,
  ];
  if (summary.project) lines.push('โครงการ ' + summary.project);
  if (summary.vehicle) lines.push('ทะเบียน ' + summary.vehicle);
  if (summary.lodging) lines.push('ที่พัก ' + summary.lodging);
  if (summary.note) lines.push('หมายเหตุ ' + summary.note);
  if (summary.personalCents !== undefined) lines.push('ยอดที่ต้องสำรองจ่าย ' + baht(summary.personalCents) + ' บาท');
  const buttons = [[row.state === 'saving' ? 'ตรวจผลอีกครั้ง' : 'ยืนยันบันทึก', 'ยืนยัน ' + code(row)]];
  if (row.state === 'ready') buttons.push(['ยกเลิก', 'ยกเลิก ' + code(row)]);
  return message(lines.join('\n'), buttons);
}

async function draftId(owner, event) {
  const bytes = new TextEncoder().encode(owner + '\n' + event.webhookEventId);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest).subarray(0, 7)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return 'L' + hex.toUpperCase();
}

async function receiveImage(env, owner, id, event, now) {
  const existing = await getDraft(env.DB, owner, id);
  if (existing && (existing.state !== 'details' || existing.scan_json || existing.lease_until > now)) {
    return draftMessage(existing);
  }
  const image = await downloadSlip(env, event.message.id);
  await env.DB.prepare("INSERT OR IGNORE INTO line_drafts(id,owner_hash,image_hash,state,created_at) VALUES(?,?,?,'details',?)")
    .bind(id, owner, image.hash, now).run();
  const row = await getDraft(env.DB, owner, id) ?? await env.DB.prepare(
    "SELECT * FROM line_drafts WHERE owner_hash=? AND image_hash=? AND state IN ('details','ready','saving','saved')",
  ).bind(owner, image.hash).first();
  if (!row) throw new AppError('สร้างร่างสลิปไม่สำเร็จค่ะ กรุณาส่งรูปใหม่');
  const claim = await env.DB.prepare(
    "UPDATE line_drafts SET lease_until=? WHERE id=? AND state='details' AND scan_json IS NULL AND lease_until<=?",
  ).bind(now + lease, row.id, now).run();
  if (claim.meta.changes > 0) {
    const scan = await readSlip(env, image);
    await env.DB.prepare(
      "UPDATE line_drafts SET scan_json=?,lease_until=0 WHERE id=? AND state='details' AND lease_until=?",
    ).bind(JSON.stringify(scan), row.id, now + lease).run();
  }
  return draftMessage(await getDraft(env.DB, owner, row.id));
}

async function newEntry(env, owner, id, parts, now) {
  const existing = await getDraft(env.DB, owner, id);
  if (existing) return draftMessage(existing);
  const draft = await prepareLineDraft(env, parseEntry(parts, null), id);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO line_drafts(id,owner_hash,state,version,created_at,draft_json) VALUES(?,?,'ready',1,?,?)",
  ).bind(id, owner, now, JSON.stringify(draft)).run();
  return draftMessage(await getDraft(env.DB, owner, id));
}

async function fillSlip(env, owner, id, parts, event) {
  const row = await getDraft(env.DB, owner, id);
  if (!row?.scan_json || !['details', 'ready'].includes(row.state)) return draftMessage(row);
  const order = String(event.timestamp).padStart(15, '0') + ':' + event.webhookEventId;
  if (row.details_order && order <= row.details_order) return draftMessage(row);
  const draft = await prepareLineDraft(env, parseEntry(parts, JSON.parse(row.scan_json)), id);
  const updated = await env.DB.prepare(
    "UPDATE line_drafts SET state='ready',version=version+1,draft_json=?,details_order=? "
    + "WHERE id=? AND owner_hash=? AND version=? AND state IN ('details','ready')",
  ).bind(JSON.stringify(draft), order, id, owner, row.version).run();
  if (updated.meta.changes === 0) {
    const current = await getDraft(env.DB, owner, id);
    if (current?.state === 'ready' && current.details_order !== order)
      return message('ร่างเปลี่ยนระหว่างกรอกค่ะ พิมพ์ “ร่าง” เพื่อตรวจข้อมูลล่าสุด');
  }
  return draftMessage(await getDraft(env.DB, owner, id));
}

async function actOnDraft(env, owner, id, version, action, now) {
  const row = await getDraft(env.DB, owner, id);
  if (!row || !['details', 'ready', 'saving'].includes(row.state)) return draftMessage(row);
  if (row.version !== version) return message('รหัสร่างเปลี่ยนแล้วค่ะ', [['ดูร่างล่าสุด', 'ร่าง']]);
  if (action === 'ยกเลิก') {
    await env.DB.prepare(
      "UPDATE line_drafts SET state='cancelled',scan_json=NULL,draft_json=NULL WHERE id=? AND version=? AND state IN ('details','ready')",
    ).bind(id, version).run();
    return draftMessage(await getDraft(env.DB, owner, id));
  }
  if (row.state === 'details') return draftMessage(row);
  const until = now + lease;
  const claimed = await env.DB.prepare(
    "UPDATE line_drafts SET state='saving',lease_until=? WHERE id=? AND version=? "
    + "AND (state='ready' OR state='saving' AND lease_until<=?)",
  ).bind(until, id, version, now).run();
  if (claimed.meta.changes === 0) return draftMessage(await getDraft(env.DB, owner, id));

  try {
    const result = await saveLineDraft(env, id, version, JSON.parse(row.draft_json));
    await env.DB.prepare(
      "UPDATE line_drafts SET state='saved',result_json=?,draft_json=NULL,scan_json=NULL,lease_until=0 "
      + "WHERE id=? AND state='saving' AND lease_until=?",
    ).bind(JSON.stringify(result), id, until).run();
  } catch (error) {
    // An unconfirmed transport/commit outcome can only replay the exact same mutation.
    const rejected = error instanceof AppError && error.status < 500;
    if (rejected) {
      await env.DB.prepare(
        "UPDATE line_drafts SET state='ready',lease_until=0 WHERE id=? AND state='saving' AND lease_until=?",
      ).bind(id, until).run();
      return message(error.message + '\nส่งรายละเอียดสลิปใหม่ หรือยกเลิกร่างแล้วพิมพ์รายการใหม่ได้ค่ะ',
        [['ดูร่าง', 'ร่าง ' + id], ['ยกเลิก', 'ยกเลิก ' + code(row)]]);
    }
    return message('ยังตรวจผลไม่ได้ค่ะ รอประมาณหนึ่งนาทีแล้วกดตรวจผลของร่างเดิม',
      [['ตรวจผลอีกครั้ง', 'ยืนยัน ' + code(row)]]);
  }
  return draftMessage(await getDraft(env.DB, owner, id));
}

async function textCommand(env, owner, event, now) {
  const input = event.message.text.trim();
  if (input.length > 3000) throw new AppError('ข้อความยาวเกิน 3,000 ตัวอักษรค่ะ');
  const parts = input.split('|').map(value => value.trim());
  const first = parts[0];
  const command = first.match(/^(ยืนยัน|ยกเลิก|ร่าง|สลิป)\s+(L[0-9A-F]{14})(?:-(\d{1,6}))?$/iu);
  if (command) {
    const [, verb, rawId, version] = command;
    const id = rawId.toUpperCase();
    if (verb === 'ร่าง' && parts.length === 1) return draftMessage(await getDraft(env.DB, owner, id));
    if (verb === 'สลิป' && !version && parts.length > 1) return fillSlip(env, owner, id, parts.slice(1), event);
    if (['ยืนยัน', 'ยกเลิก'].includes(verb) && parts.length === 1) return actOnDraft(env, owner, id, Number(version || 0), verb, now);
    return message(help);
  }
  if (input === 'ร่าง') {
    const { results } = await env.DB.prepare(
      "SELECT id,state,version FROM line_drafts WHERE owner_hash=? AND state IN ('details','ready','saving') ORDER BY created_at DESC LIMIT 5",
    ).bind(owner).all();
    if (results.length === 1) return draftMessage(await getDraft(env.DB, owner, results[0].id));
    if (results.length) return message('ร่างล่าสุด\n' + results.map(code).join('\n'),
      results.map(row => [code(row), 'ร่าง ' + row.id]));
    return message('ตอนนี้ไม่มีร่างที่รอทำรายการค่ะ');
  }
  const choices = input.match(/^ตัวเลือก\s+(บัญชี|รับ|จ่าย|โครงการ|ทะเบียน)$/u);
  if (choices) {
    const entries = await listLineChoices(env, choices[1]);
    return message(entries.length ? entries.join('\n').slice(0, 4500) : 'ยังไม่มีตัวเลือกที่ใช้งานค่ะ');
  }
  if (input === 'ตัวเลือก') return message('เลือกดูข้อมูลที่ใช้บันทึกรายการค่ะ',
    ['บัญชี', 'รับ', 'จ่าย', 'โครงการ', 'ทะเบียน'].map(name => [name, 'ตัวเลือก ' + name]));
  if (Object.hasOwn(directions, first) && parts.length > 1) return newEntry(env, owner, await draftId(owner, event), parts, now);
  return message(help);
}

async function handleEvent(env, event, owners) {
  if (event.type !== 'message' || event.source?.type !== 'user' || !owners.has(event.source.userId)
    || !/^[A-Za-z0-9_-]{1,128}$/.test(event.replyToken ?? '')
    || !/^[A-Za-z0-9_-]{1,100}$/.test(event.webhookEventId ?? '') || !Number.isSafeInteger(event.timestamp)) return;
  const owner = await sha256(event.source.userId);
  const now = Date.now();
  let response;
  try {
    await env.DB.prepare("UPDATE line_drafts SET state='expired',scan_json=NULL,draft_json=NULL "
      + "WHERE state IN ('details','ready') AND created_at<=?").bind(now - draftAge).run();
    if (event.message?.type === 'image') response = await receiveImage(env, owner, await draftId(owner, event), event, now);
    else if (event.message?.type === 'text' && typeof event.message.text === 'string') response = await textCommand(env, owner, event, now);
    else response = message('ส่งข้อความหรือรูปสลิปเพื่อสร้างรายการค่ะ');
  } catch (error) {
    response = message(error instanceof AppError ? error.message : 'ระบบขัดข้องค่ะ กรุณาลองอีกครั้ง');
  }
  const reply = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN },
    body: JSON.stringify({ replyToken: event.replyToken, messages: [response] }),
    signal: AbortSignal.timeout(5000), redirect: 'manual',
  });
  if (!reply.ok) throw new Error('LINE did not accept the reply');
}

export async function lineWebhook(request, env, context) {
  if (request.method !== 'POST') return json({ ok: false }, 405);
  const owners = new Set(String(env.LINE_ALLOWED_USER_IDS || '').split(',').map(id => id.trim()).filter(id => /^U[a-f0-9]{32}$/i.test(id)));
  if (!env.LINE_CHANNEL_SECRET || !env.LINE_CHANNEL_ACCESS_TOKEN || !owners.size) return json({ ok: false }, 503);
  const signature = request.headers.get('x-line-signature') || '';
  if (!/^[A-Za-z0-9+/]{43}=$/.test(signature)) return json({ ok: false }, 401);
  const bytes = await readLimitedBody(request, 1024 * 1024);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.LINE_CHANNEL_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('HMAC', key, Uint8Array.from(atob(signature), c => c.charCodeAt(0)), bytes);
  if (!valid) return json({ ok: false }, 401);
  let events;
  try { ({ events } = JSON.parse(new TextDecoder().decode(bytes))); }
  catch { return json({ ok: false }, 400); }
  if (!Array.isArray(events) || events.length > 100 || events.some(event => !event || typeof event !== 'object')) return json({ ok: false }, 400);
  const work = Promise.allSettled(events.map(event => handleEvent(env, event, owners)));
  if (context?.waitUntil) context.waitUntil(work);
  else await work;
  return json({ ok: true });
}
