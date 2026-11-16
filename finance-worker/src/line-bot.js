import { AppError, json } from './errors.js';
import { sha256 } from './auth.js';
import { baht, lineInputChoices, listLineChoices, parseAmount, parseDate, prepareLineDraft, saveLineDraft } from './line-ledger.js';
import { downloadSlip, readLimitedBody, readSlip } from './line-slip.js';
import { defaultLineAccount, initialLineInput, missingLineInput, readLineInput } from './line-input.js';

const thaiDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bangkok' });
const draftAge = 24 * 60 * 60 * 1000;
const lease = 45 * 1000;
const selectionAge = 30 * 60 * 1000;
const directions = { รับ: 'income', จ่าย: 'expense' };
const optionalFields = { วันที่: 'date', โครงการ: 'project', ทะเบียน: 'vehicle', ที่พัก: 'lodging' };
const scopes = ['ส่วนตัว', 'บริษัท'];

const help = 'เลือกส่วนตัวหรือบริษัทสำหรับรายการถัดไป แล้วพิมพ์สั้น ๆ เช่น “กินข้าวเย็น 50 บาท” หรือส่งรูปสลิปค่ะ\n'
  + 'บัญชีเริ่มต้น ' + defaultLineAccount + ' ถ้าใช้บัญชีอื่น ระบุชื่อในข้อความหรือแก้ในร่างได้ค่ะ';
const scopeMenu = () => message(help, scopes.map(scope => [scope, scope]));
const eventOrder = event => String(event.timestamp).padStart(15, '0') + ':' + event.webhookEventId;

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

function guidedMessage(row, options = {}, issue = '') {
  const entry = JSON.parse(row.entry_json);
  const missing = missingLineInput(entry);
  const command = field => 'เติม ' + code(row) + ' | ' + field;
  const itemLabel = entry.scope === 'ส่วนตัว' ? 'หมวด' : 'รายการ';
  const account = options.accounts?.find(value => value.id === entry.account)?.name ?? entry.account;
  const item = options.categories?.find(value => value.id === entry.item)?.name ?? entry.item;
  const lines = [
    'ร่าง' + (entry.fromImage ? 'สลิป' : '') + ' · ' + entry.scope,
    [entry.direction === 'income' ? 'รายรับ' : entry.direction === 'expense' ? 'รายจ่าย' : '',
      entry.cents ? baht(entry.cents) + ' บาท' : '', entry.date || '', account || ''].filter(Boolean).join(' · '),
  ].filter(Boolean);
  if (item) lines.push(itemLabel + ' ' + item);
  const next = {
    direction: entry.fromImage ? 'พิมพ์ว่ารับหรือจ่ายค่าอะไร เช่น “จ่ายค่าอาหาร” ค่ะ' : 'รายการนี้เป็นรายรับหรือรายจ่ายคะ?',
    cents: 'กรุณาพิมพ์ยอด เช่น ยอด=50 ค่ะ',
    date: 'กรุณาพิมพ์วันที่ เช่น วันที่=2026-11-16 ค่ะ',
    account: 'กรุณาเลือกบัญชี หรือพิมพ์ชื่อ เช่น บัญชี=กรุงไทย ค่ะ',
    item: entry.scope === 'ส่วนตัว' ? 'กรุณาเลือกหมวด หรือพิมพ์ เช่น หมวด=อาหาร ค่ะ'
      : 'กรุณาพิมพ์ชื่อรายการ เช่น รายการ=ค่าอุปกรณ์สำนักงาน ค่ะ',
  };
  if (issue) lines.push(issue);
  lines.push(next[missing] || 'พิมพ์ช่องที่ต้องการแก้ เช่น บัญชี=เงินสด, ยอด=50 หรือ วันที่=2026-11-16 ค่ะ');
  if (issue && entry.scope === 'บริษัท') lines.push('ระบุโครงการ ทะเบียน หรือที่พักได้ เช่น ทะเบียน=ชื่อทะเบียน ค่ะ');
  const buttons = [];
  if (missing === 'direction') buttons.push(['รายรับ', command('รายรับ')], ['รายจ่าย', command('รายจ่าย')]);
  if (missing === 'account') {
    for (const choice of (options.accounts || []).slice(0, 10)) buttons.push([choice.name.slice(0, 20), command('บัญชี=' + choice.id)]);
  }
  if (missing === 'item' && entry.scope === 'ส่วนตัว') {
    for (const choice of (options.categories || []).filter(value => value.direction === entry.direction).slice(0, 10))
      buttons.push([choice.name.slice(0, 20), command('หมวด=' + choice.id)]);
  }
  if (!missing) buttons.push(['ตรวจร่าง', command('ตรวจร่าง')]);
  buttons.push(['ยกเลิก', 'ยกเลิก ' + code(row)]);
  return message(lines.join('\n'), buttons);
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
    if (row.entry_json) return guidedMessage(row);
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
  if (row.state === 'ready') {
    if (row.entry_json) buttons.push(['แก้ไข', 'แก้ไข ' + code(row)]);
    buttons.push(['ยกเลิก', 'ยกเลิก ' + code(row)]);
  }
  return message(lines.join('\n'), buttons);
}

async function draftId(owner, event) {
  const bytes = new TextEncoder().encode(owner + '\n' + event.webhookEventId);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest).subarray(0, 7)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return 'L' + hex.toUpperCase();
}

async function selectInputScope(db, owner, scope, event, activeDraft = null) {
  await db.prepare('INSERT INTO line_input_sessions(owner_hash,scope,selection_order,expires_at,draft_id) VALUES(?,?,?,?,?) '
    + 'ON CONFLICT(owner_hash) DO UPDATE SET scope=excluded.scope,selection_order=excluded.selection_order,'
    + 'expires_at=excluded.expires_at,draft_id=excluded.draft_id WHERE excluded.selection_order>line_input_sessions.selection_order')
    .bind(owner, scope, eventOrder(event), event.timestamp + selectionAge, activeDraft).run();
}

function getInputSession(db, owner, event, now) {
  return db.prepare('SELECT * FROM line_input_sessions WHERE owner_hash=? AND selection_order<? AND expires_at>?')
    .bind(owner, eventOrder(event), now).first();
}

async function bindInputDraft(db, owner, session, id) {
  const result = await db.prepare('UPDATE line_input_sessions SET draft_id=? '
    + 'WHERE owner_hash=? AND selection_order=? AND (draft_id IS NULL OR draft_id=?)')
    .bind(id, owner, session.selection_order, id).run();
  return result.meta.changes > 0;
}

async function updateGuidedDraft(env, owner, row, text, event) {
  const order = eventOrder(event);
  if (row.state !== 'details' || !row.entry_json || row.details_order && order <= row.details_order)
    return draftMessage(row);
  const choices = await lineInputChoices(env);
  const before = JSON.parse(row.entry_json);
  const entry = text === 'ตรวจร่าง' ? before : await readLineInput(env, before, text, event.timestamp, choices);
  let draft = null;
  let issue = '';
  if (!missingLineInput(entry)) {
    try { draft = await prepareLineDraft(env, entry, row.id); }
    catch (error) {
      issue = error instanceof AppError ? error.message : 'ยังตรวจร่างไม่ได้ค่ะ ลองกดตรวจร่างอีกครั้ง';
    }
  }
  const update = await env.DB.prepare('UPDATE line_drafts SET state=?,version=version+1,entry_json=?,draft_json=?,details_order=? '
    + "WHERE id=? AND owner_hash=? AND state='details' AND version=?")
    .bind(draft ? 'ready' : 'details', JSON.stringify(entry), draft ? JSON.stringify(draft) : null,
      order, row.id, owner, row.version).run();
  const current = await getDraft(env.DB, owner, row.id);
  if (!update.meta.changes || current.state !== 'details') return draftMessage(current);
  if (!issue && !missingLineInput(entry)) issue = 'กรุณาตรวจข้อมูลร่างอีกครั้งค่ะ';
  return guidedMessage(current, choices, issue);
}

async function guidedText(env, owner, input, event, now) {
  const session = await getInputSession(env.DB, owner, event, now);
  const id = await draftId(owner, event);
  let row = await getDraft(env.DB, owner, id);
  if (row && (row.details_order || row.state !== 'details')) return draftMessage(row);
  if (!session) return scopeMenu();
  if (session.draft_id && session.draft_id !== id) {
    row = await getDraft(env.DB, owner, session.draft_id);
    if (!row || row.state === 'details' && !row.entry_json) return message('กำลังเตรียมร่างค่ะ รอสักครู่แล้วส่งรายละเอียดอีกครั้ง');
    if (row.state === 'details' && row.details_order && eventOrder(event) > row.details_order)
      return updateGuidedDraft(env, owner, row, input, event);
    if (row.state === 'details') return draftMessage(row);
    return scopeMenu();
  }
  if (!row) {
    if (!await bindInputDraft(env.DB, owner, session, id)) return scopeMenu();
    const entry = initialLineInput(session.scope, event.timestamp);
    await env.DB.prepare("INSERT OR IGNORE INTO line_drafts(id,owner_hash,state,created_at,entry_json) VALUES(?,?,'details',?,?)")
      .bind(id, owner, now, JSON.stringify(entry)).run();
    row = await getDraft(env.DB, owner, id);
  }
  return row ? updateGuidedDraft(env, owner, row, input, event) : scopeMenu();
}

async function editGuidedDraft(env, owner, row, version, event) {
  if (!row?.entry_json || row.state !== 'ready' || row.version !== version) return draftMessage(row);
  const order = eventOrder(event);
  const updated = await env.DB.prepare("UPDATE line_drafts SET state='details',version=version+1,draft_json=NULL,details_order=? "
    + "WHERE id=? AND owner_hash=? AND version=? AND state='ready'")
    .bind(order, row.id, owner, version).run();
  if (updated.meta.changes) {
    const entry = JSON.parse(row.entry_json);
    await selectInputScope(env.DB, owner, entry.scope, event, row.id);
    return guidedMessage(await getDraft(env.DB, owner, row.id), await lineInputChoices(env));
  }
  return draftMessage(await getDraft(env.DB, owner, row.id));
}

async function receiveImage(env, owner, id, event, now) {
  const existing = await getDraft(env.DB, owner, id);
  if (existing && (existing.state !== 'details' || existing.scan_json || existing.lease_until > now)) {
    return draftMessage(existing);
  }
  const image = await downloadSlip(env, event.message.id);
  const session = await getInputSession(env.DB, owner, event, now);
  if (!existing && session?.draft_id && session.draft_id !== id) {
    const previous = await getDraft(env.DB, owner, session.draft_id);
    return previous?.image_hash === image.hash ? draftMessage(previous) : scopeMenu();
  }
  await env.DB.prepare("INSERT OR IGNORE INTO line_drafts(id,owner_hash,image_hash,state,created_at) VALUES(?,?,?,'details',?)")
    .bind(id, owner, image.hash, now).run();
  const row = await getDraft(env.DB, owner, id) ?? await env.DB.prepare(
    "SELECT * FROM line_drafts WHERE owner_hash=? AND image_hash=? AND state IN ('details','ready','saving','saved')",
  ).bind(owner, image.hash).first();
  if (!row) throw new AppError('สร้างร่างสลิปไม่สำเร็จค่ะ กรุณาส่งรูปใหม่');
  const guided = row.id === id && session && await bindInputDraft(env.DB, owner, session, id);
  const claim = await env.DB.prepare(
    "UPDATE line_drafts SET lease_until=? WHERE id=? AND state='details' AND scan_json IS NULL AND lease_until<=?",
  ).bind(now + lease, row.id, now).run();
  if (claim.meta.changes > 0) {
    const scan = await readSlip(env, image);
    const entry = guided ? initialLineInput(session.scope, event.timestamp, scan) : null;
    await env.DB.prepare(
      "UPDATE line_drafts SET scan_json=?,entry_json=?,details_order=?,lease_until=0 WHERE id=? AND state='details' AND lease_until=?",
    ).bind(JSON.stringify(scan), entry ? JSON.stringify(entry) : null, entry ? eventOrder(event) : null, row.id, now + lease).run();
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
  const order = eventOrder(event);
  if (row.details_order && order <= row.details_order) return draftMessage(row);
  const entry = parseEntry(parts, JSON.parse(row.scan_json));
  if (row.entry_json && entry.scope !== JSON.parse(row.entry_json).scope)
    throw new AppError('สลิปนี้อยู่ในประเภทที่เลือกไว้ค่ะ หากต้องการเปลี่ยนประเภท ให้ยกเลิกและเลือกใหม่');
  const draft = await prepareLineDraft(env, entry, id);
  const updated = await env.DB.prepare(
    "UPDATE line_drafts SET state='ready',version=version+1,draft_json=?,details_order=?,entry_json=? "
    + "WHERE id=? AND owner_hash=? AND version=? AND state IN ('details','ready')",
  ).bind(JSON.stringify(draft), order, row.entry_json ? JSON.stringify(entry) : null, id, owner, row.version).run();
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
      "UPDATE line_drafts SET state='cancelled',scan_json=NULL,draft_json=NULL,entry_json=NULL WHERE id=? AND version=? AND state IN ('details','ready')",
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
      "UPDATE line_drafts SET state='saved',result_json=?,draft_json=NULL,scan_json=NULL,entry_json=NULL,lease_until=0 "
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
  const command = first.match(/^(ยืนยัน|ยกเลิก|ร่าง|สลิป|แก้ไข|เติม)\s+(L[0-9A-F]{14})(?:-(\d{1,6}))?$/iu);
  if (command) {
    const [, verb, rawId, version] = command;
    const id = rawId.toUpperCase();
    if (verb === 'ร่าง' && parts.length === 1) return draftMessage(await getDraft(env.DB, owner, id));
    if (verb === 'สลิป' && !version && parts.length > 1) return fillSlip(env, owner, id, parts.slice(1), event);
    if (['ยืนยัน', 'ยกเลิก'].includes(verb) && parts.length === 1) return actOnDraft(env, owner, id, Number(version || 0), verb, now);
    if (verb === 'แก้ไข' && parts.length === 1) return editGuidedDraft(env, owner, await getDraft(env.DB, owner, id), Number(version || 0), event);
    if (verb === 'เติม' && parts.length === 2) {
      const row = await getDraft(env.DB, owner, id);
      if (row?.version === Number(version || 0)) return updateGuidedDraft(env, owner, row, parts[1], event);
      return draftMessage(row);
    }
    return scopeMenu();
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
  if (scopes.includes(input)) {
    await selectInputScope(env.DB, owner, input, event);
    return message('เลือก' + input + 'สำหรับรายการถัดไปแล้วค่ะ พิมพ์ข้อความหรือส่งรูปสลิปได้เลย');
  }
  if (['เมนู', 'ช่วยเหลือ', ''].includes(input)) return scopeMenu();
  return guidedText(env, owner, input, event, now);
}

async function handleEvent(env, event, owners) {
  if (event.type !== 'message' || event.source?.type !== 'user' || !owners.has(event.source.userId)
    || !/^[A-Za-z0-9_-]{1,128}$/.test(event.replyToken ?? '')
    || !/^[A-Za-z0-9_-]{1,100}$/.test(event.webhookEventId ?? '') || !Number.isSafeInteger(event.timestamp)) return;
  const owner = await sha256(event.source.userId);
  const now = Date.now();
  let response;
  try {
    await env.DB.prepare("UPDATE line_drafts SET state='expired',scan_json=NULL,draft_json=NULL,entry_json=NULL "
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
  const streams = new Map();
  for (const event of [...events].sort((a, b) => a.timestamp - b.timestamp
    || String(a.webhookEventId).localeCompare(String(b.webhookEventId)))) {
    const user = event.source?.userId;
    if (!owners.has(user)) continue;
    const previous = streams.get(user) ?? Promise.resolve();
    streams.set(user, previous.catch(() => {}).then(() => handleEvent(env, event, owners)));
  }
  const work = Promise.allSettled(streams.values());
  if (context?.waitUntil) context.waitUntil(work);
  else await work;
  return json({ ok: true });
}
