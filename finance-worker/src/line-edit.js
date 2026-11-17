import { cardButton, editPromptCard, isPersonalExpense, messageCard } from './line-card.js';
import { companyItemFields } from './line-ledger.js';

const pageSize = 6;
const relativeDateChoices = [['วันนี้', 'today'], ['เมื่อวาน', 'yesterday']];
const choiceFields = ['account', 'item', 'project', 'vehicle'];

export function editFields(entry, companyRefs) {
  const expense = isPersonalExpense(entry);
  const personal = entry.scope === 'ส่วนตัว';
  const fields = [
    ['cents', 'จำนวนเงิน'], ['date', 'วันที่'],
    ['account', expense ? 'บัญชีที่ใช้จ่าย' : 'บัญชี'],
    ['item', personal ? expense ? 'ประเภทรายจ่าย' : 'หมวด' : 'รายการ'],
    ['note', personal ? 'รายละเอียด' : 'หมายเหตุ'],
  ];
  if (!personal) {
    const { vehicle, lodging } = companyItemFields(entry, companyRefs);
    fields.push(['project', 'โครงการ']);
    if (vehicle || entry.vehicle) fields.push(['vehicle', 'ทะเบียนรถ']);
    if (lodging || entry.lodging) fields.push(['lodging', 'ที่พัก']);
  }
  return fields;
}

export function parseLineEditAction(data) {
  if (typeof data !== 'string' || data.length > 300) return null;
  const match = data.match(/^finance:edit:(L[0-9A-F]{14})-([1-9]\d{0,5}):(field|set|type|back)(?::(cents|date|account|item|note|project|vehicle|lodging)(?::(.+))?)?$/u);
  if (!match) return null;
  const [, id, version, step, field, value] = match;
  if (step === 'back' ? field : !field || (step === 'type' && value) || (step === 'set' && !value)) return null;
  return { id, version: Number(version), step, field, value };
}

function editButton(reference, label, step, field, value, display = false) {
  const data = ['finance:edit', reference, step, field, value].filter(part => part !== undefined).join(':');
  return cardButton(label, {
    type: 'postback', data,
    ...(display ? { displayText: label } : {}),
  });
}

const draftButton = (label, text) => cardButton(label, { type: 'message', text });

export function editFieldsCard(reference, fields, issue) {
  return editPromptCard([
    ...fields.map(([field, label]) => editButton(reference, label, 'field', field, undefined, true)),
    draftButton('ตรวจร่าง', 'เติม ' + reference + ' | ตรวจร่าง'),
    draftButton('ยกเลิก', 'ยกเลิก ' + reference),
  ], issue);
}

export function editDateCard(reference) {
  return messageCard('เลือกวันที่ค่ะ', [
    ...relativeDateChoices.map(([label, value]) => editButton(reference, label, 'set', 'date', value, true)),
    editButton(reference, 'ระบุวันที่เอง', 'type', 'date'),
    editButton(reference, 'กลับไปเลือกช่อง', 'back'),
  ], { groupFirstTwo: true });
}

export const isEditChoiceField = field => choiceFields.includes(field);

export function editChoicesCard(reference, field, label, options, requestedPage = 0, issue = '') {
  const pages = Math.max(1, Math.ceil(options.length / pageSize));
  const page = Math.min(requestedPage, pages - 1);
  const buttons = options.slice(page * pageSize, (page + 1) * pageSize)
    .map(option => editButton(reference, option.name, 'set', field, String(option.id), true));
  if (page > 0) buttons.push(editButton(reference, 'ก่อนหน้า', 'field', field, String(page - 1)));
  if (page + 1 < pages) buttons.push(editButton(reference, 'ดูเพิ่มเติม', 'field', field, String(page + 1)));
  if (field === 'item' && label === 'รายการ') buttons.push(editButton(reference, 'พิมพ์ชื่อรายการ', 'type', field));
  buttons.push(editButton(reference, 'กลับไปเลือกช่อง', 'back'));
  const lines = ['เลือก' + label + 'ค่ะ', issue];
  if (!options.length) lines.push('ยังไม่มีตัวเลือกในเว็บค่ะ');
  if (pages > 1) lines.push('หน้า ' + (page + 1) + '/' + pages);
  return messageCard(lines.filter(Boolean).join('\n'), buttons);
}

export function editInputCard(reference, field, label, issue = '') {
  const example = { cents: '50.25', date: '2026-11-17', note: 'ไก่ทอด', item: 'ค่าอุปกรณ์', lodging: 'ชื่อโรงแรม' }[field];
  return messageCard('พิมพ์' + label + 'ใหม่ค่ะ\n' + (issue ? issue + '\n' : '') + 'เช่น ' + example,
    [editButton(reference, 'กลับไปเลือกช่อง', 'back')]);
}
