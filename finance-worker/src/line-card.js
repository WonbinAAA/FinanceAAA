import { baht } from './line-ledger.js';

const colors = {
  personal: '#075752', company: '#193E4C', paper: '#FFFFFF', text: '#15383A', label: '#51656A',
  divider: '#DCECE8', confirm: '#DDF3E8', edit: '#FFF1D7', cancel: '#FBE8E5', status: '#D5EEEA',
};
const expenseIcons = [
  [/น้ำมัน|ดีเซล|เบนซิน|เชื้อเพลิง|แก๊สรถ|ก๊าซรถ|LPG/i, '⛽'],
  [/กาแฟ|คาเฟ่|เครื่องดื่ม|ชาเขียว|ชานม|น้ำดื่ม/u, '☕'],
  [/ข้าว|อาหาร|ของกิน|เสบียง|ผลไม้|ขนม/u, '🍽️'],
  [/เดินทาง|รถ|ทางด่วน|แท็กซี่/u, '🚗'],
  [/ที่พัก|โรงแรม/u, '🏨'],
  [/สุขภาพ|ยา|โรงพยาบาล|รักษา/u, '💊'],
  [/โทรศัพท์|มือถือ|อินเทอร์เน็ต|internet/i, '📱'],
  [/ไฟฟ้า|น้ำประปา|ค่าน้ำ|ค่าไฟ/u, '💡'],
  [/ชำระหนี้|ดอกเบี้ย|ค่าธรรมเนียม|กองทุน|เงินออม/u, '💳'],
  [/ของขวัญ|บริจาค|ทำบุญ/u, '🎁'],
  [/ช้อปปิ้ง|ของใช้|อุปกรณ์|วัสดุ/u, '🛒'],
];

export function isPersonalExpense({ scope, direction }) {
  return scope === 'ส่วนตัว' && direction === 'expense';
}

export function personalExpenseFields({ cents, date, account, item, note }) {
  return [
    ['จำนวนเงิน', cents ? baht(cents) + ' บาท' : '—'],
    ['วันที่', date ? date.split('-').reverse().join('/') : '—'],
    ['บัญชีที่ใช้จ่าย', account || '—'],
    ['ประเภทรายจ่าย', item || '—'],
    ['รายละเอียด', note || '—'],
  ];
}

function summaryFields(summary) {
  if (isPersonalExpense(summary)) return personalExpenseFields(summary);
  const fields = [
    ['ยอด', baht(summary.cents) + ' บาท'], ['วันที่', summary.date], ['บัญชี', summary.account],
    [summary.scope === 'บริษัท' ? 'รายการ' : 'หมวด', summary.item],
  ];
  for (const [label, value] of [['โครงการ', summary.project], ['ทะเบียน', summary.vehicle],
    ['ที่พัก', summary.lodging], ['หมายเหตุ', summary.note]]) {
    if (value) fields.push([label, value]);
  }
  if (summary.personalCents !== undefined) fields.push(['ยอดที่ต้องสำรองจ่าย', baht(summary.personalCents) + ' บาท']);
  return fields;
}

function iconFor(summary) {
  if (summary.direction === 'income') return '💰';
  const match = expenseIcons.find(([pattern]) => pattern.test(summary.item || ''));
  return match?.[1] ?? (summary.scope === 'บริษัท' ? '🏢' : '🧾');
}

export function parseDraftCardAction(data) {
  if (typeof data !== 'string') return null;
  const match = data.match(/^finance:draft:(confirm|edit|cancel):(L[0-9A-F]{14})-([1-9]\d{0,5})$/u);
  return match ? { action: match[1], id: match[2], version: Number(match[3]) } : null;
}

const text = (value, properties = {}) => ({ type: 'text', text: value, wrap: true, ...properties });
const box = (layout, contents, properties = {}) => ({ type: 'box', layout, contents, ...properties });
const fieldLabel = value => text(value, { size: 'xs', color: colors.label });

function actionTile(action, label, icon, color, reference) {
  return box('vertical', [text(icon, { align: 'center', size: 'xl' })], {
    height: '48px', cornerRadius: '12px', backgroundColor: color, justifyContent: 'center',
    action: { type: 'postback', label, data: 'finance:draft:' + action + ':' + reference },
  });
}

function fallbackText(lines) {
  const joined = lines.join('\n');
  return joined.length <= 400 ? joined : joined.slice(0, 399).replace(/[\uD800-\uDBFF]$/u, '') + '…';
}

export function draftCard(summary, reference, state, editable) {
  const saving = state === 'saving';
  const status = (saving ? 'กำลังตรวจผลการบันทึก ' : 'ตรวจร่าง ') + reference;
  const direction = summary.direction === 'income' ? 'รายรับ' : 'รายจ่าย';
  const title = direction + summary.scope;
  const fallbackTitle = isPersonalExpense(summary) ? title
    : (summary.direction === 'income' ? 'รับ' : 'จ่าย') + ' · ' + summary.scope;
  const fields = summaryFields(summary);
  const [[amountLabel, amount], ...rest] = fields;
  const header = box('horizontal', [
    text(iconFor(summary), { size: 'xxl', flex: 0, gravity: 'center' }),
    box('vertical', [
      text(title, { color: colors.paper, size: 'lg', weight: 'bold' }),
      text(status, { color: colors.status, size: 'xxs', margin: 'xs' }),
    ]),
  ], { paddingAll: 'lg', spacing: 'md', backgroundColor: summary.scope === 'บริษัท' ? colors.company : colors.personal });
  const body = box('vertical', [
    box('vertical', [
      fieldLabel(amountLabel),
      text(amount, { size: 'xxl', weight: 'bold', color: colors.text, margin: 'xs' }),
    ]),
    { type: 'separator', color: colors.divider },
    ...rest.map(([label, value]) => box('vertical', [
      fieldLabel(label), text(value, { size: 'sm', color: colors.text, margin: 'xs' }),
    ])),
  ], { paddingAll: 'lg', spacing: 'md' });
  const actions = [actionTile('confirm', saving ? 'ตรวจผลอีกครั้ง' : 'ยืนยันบันทึก',
    saving ? '🔄' : '✅', colors.confirm, reference)];
  if (!saving) {
    if (editable) actions.push(actionTile('edit', 'แก้ไข', '✏️', colors.edit, reference));
    actions.push(actionTile('cancel', 'ยกเลิก', '❌', colors.cancel, reference));
  }
  return {
    type: 'flex',
    altText: fallbackText([status, fallbackTitle, ...fields.map(([label, value]) => label + ' ' + value)]),
    contents: {
      type: 'bubble', size: 'mega', header, body,
      footer: box('horizontal', actions, { paddingAll: 'lg', spacing: 'sm' }),
    },
  };
}
