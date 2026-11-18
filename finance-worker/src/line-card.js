import { baht } from './line-ledger.js';
import { companyDirections, companyFormFields, companyFunding, companyItemFields, isSelfAllowance } from './line-company.js';

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

export function companySummaryFields(summary, applicable = companyItemFields(summary)) {
  const values = {
    ...summary,
    direction: companyDirections[summary.direction],
    cents: summary.cents ? baht(summary.cents) + ' บาท' : '',
    date: summary.date?.split('-').reverse().join('/'),
    fundingKind: companyFunding[summary.fundingKind],
  };
  const fields = companyFormFields(summary, applicable).slice(1).map(([key, label]) => [label, values[key] || '—']);
  if (isSelfAllowance(summary)) fields.push(['ผลต่อบัญชี', 'ยอดธนาคารจะปรับเมื่อได้รับเงินจริงค่ะ']);
  if (summary.personalCents !== undefined) fields.push(['ยอดที่ต้องสำรองจ่าย', baht(summary.personalCents) + ' บาท']);
  return fields;
}

function summaryFields(summary) {
  if (isPersonalExpense(summary)) return personalExpenseFields(summary);
  if (summary.scope === 'บริษัท') {
    const data = summary.direction === 'expense' && !summary.fundingKind ? { ...summary, fundingKind: 'EXPENSE' } : summary;
    const fields = companyItemFields(data);
    return companySummaryFields(data, { ...fields, vehicle: fields.vehicle || Boolean(data.vehicle) });
  }
  const fields = [
    ['ยอด', baht(summary.cents) + ' บาท'], ['วันที่', summary.date], ['บัญชี', summary.account],
    ['หมวด', summary.item],
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

const labelSegments = new Intl.Segmenter('th', { granularity: 'grapheme' });

export function cardButton(label, action) {
  const segments = [...labelSegments.segment(label)];
  const actionLabel = segments.length > 40 ? label.slice(0, segments[39].index) + '…' : label;
  return box('vertical', [text(label, { size: 'sm', color: colors.personal,
    align: 'center', weight: 'bold' })], {
    flex: 1, justifyContent: 'center', cornerRadius: '12px', paddingAll: 'lg',
    backgroundColor: colors.confirm, action: { ...action, label: actionLabel },
  });
}

export function messageCard(copy, buttons = [], { backgroundColor = colors.paper, groupFirstTwo = false } = {}) {
  const [title, ...detail] = (copy.trim() || 'กรุณาลองอีกครั้งค่ะ').split('\n');
  const [heading, ...overflow] = title.match(/[\s\S]{1,1000}/gu);
  const body = [text(heading, { size: 'md', color: colors.text, weight: 'bold' })];
  const remaining = [...overflow, ...detail].join('\n');
  if (remaining) {
    // Long lists on the old text commands remain readable in the card.
    for (const block of remaining.match(/[\s\S]{1,1000}/gu)) body.push(text(block, { size: 'sm', color: colors.label }));
  }
  let rows = buttons;
  if (groupFirstTwo && buttons.length >= 2) {
    rows = [box('horizontal', buttons.slice(0, 2), { spacing: 'sm' }), ...buttons.slice(2)];
  }
  return {
    type: 'flex', altText: fallbackText([title, ...detail]),
    contents: {
      type: 'bubble', size: 'mega',
      body: box('vertical', body, { paddingAll: 'lg', spacing: 'sm', backgroundColor }),
      ...(rows.length ? { footer: box('vertical', rows, { paddingAll: 'lg', spacing: 'sm' }) } : {}),
    },
  };
}

function shortCard(title, backgroundColor, detail) {
  const contents = [text(title, { size: 'md', color: colors.text, weight: 'bold' })];
  if (detail) contents.push(text(detail, { size: 'xs', color: colors.label, margin: 'sm' }));
  return {
    type: 'flex', altText: fallbackText(detail ? [title, detail] : [title]),
    contents: { type: 'bubble', body: box('vertical', contents, { paddingAll: 'lg', backgroundColor }) },
  };
}

export function savedCard(result) {
  return shortCard('✅ บันทึกรายการ' + (result.saved_name || '') + 'แล้วค่ะ', colors.confirm,
    result.pending ? 'ยอดบัญชีกำลังรออัปเดตค่ะ' : '');
}

export function editPromptCard(buttons = [], issue = '') {
  return messageCard('✏️ ต้องการแก้ไขส่วนไหนค่ะ' + (issue ? '\n' + issue : ''), buttons,
    { backgroundColor: colors.edit, groupFirstTwo: true });
}

export function dailySummaryCard(date, totals) {
  const dateLabel = date.split('-').reverse().join('/');
  const title = '📊 สรุปยอดวันนี้';
  const fallback = [title + ' · ' + dateLabel];
  const sections = [
    ['👤 ส่วนตัว', totals.personal, colors.personal, '#ECF7F2'],
    ['🏢 บริษัท', totals.company, colors.company, '#EFF5F8'],
  ].map(([label, balance, color, backgroundColor]) => {
    fallback.push(label);
    const rows = [text(label, { size: 'md', color, weight: 'bold' })];
    if (!balance) {
      const unavailable = 'ยังอ่านยอดไม่ได้ค่ะ';
      fallback.push(unavailable);
      rows.push(text(unavailable, { size: 'sm', color: colors.label }));
    } else {
      for (const [name, value] of [['รายรับวันนี้', balance.income], ['รายจ่ายวันนี้', balance.expense],
        ['ยอดสุทธิ', balance.income - balance.expense]]) {
        const amount = baht(value) + ' บาท';
        const net = name === 'ยอดสุทธิ';
        fallback.push(name + ' ' + amount);
        if (net) rows.push({ type: 'separator', color: colors.divider });
        rows.push(box('horizontal', [
          text(name, { size: 'sm', flex: 0, color: colors.label }),
          text(amount, { size: 'sm', align: 'end', color: net && value < 0 ? '#9E3832' : color,
            weight: net ? 'bold' : 'regular' }),
        ], { spacing: 'sm' }));
      }
    }
    return box('vertical', rows, { paddingAll: 'md', spacing: 'sm', cornerRadius: '12px', backgroundColor });
  });
  return {
    type: 'flex', altText: fallbackText(fallback),
    contents: {
      type: 'bubble', size: 'mega',
      header: box('vertical', [
        text(title, { size: 'lg', weight: 'bold', color: colors.paper }),
        text(dateLabel, { size: 'sm', color: colors.status, margin: 'xs' }),
      ], { paddingAll: 'lg', backgroundColor: colors.personal }),
      body: box('vertical', sections, { paddingAll: 'lg', spacing: 'md' }),
    },
  };
}

export function draftCard(summary, reference, state, editable) {
  const saving = state === 'saving';
  const status = (saving ? 'กำลังตรวจผลการบันทึก ' : 'ตรวจร่าง ') + reference;
  const direction = summary.direction === 'income' ? 'รายรับ' : 'รายจ่าย';
  const title = summary.scope === 'บริษัท'
    ? (summary.direction === 'income' ? companyDirections.income : 'เงินจ่ายบริษัท')
    : direction + summary.scope;
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
