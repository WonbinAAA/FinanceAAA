import { moneyCents } from './schema.js';

const numberFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const issueDate = new Intl.DateTimeFormat('th-TH', { dateStyle: 'long', timeZone: 'Asia/Bangkok' });
const monthLabel = new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const types = { INCOME: 'รายรับ', EXPENSE: 'รายจ่าย', TRANSFER: 'โอนเงิน' };

export const baht = cents => numberFormat.format(cents / 100);
export const reportTitle = 'รายงานประวัติรายการรับและจ่าย';

function thaiDate(iso) {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${Number(year) + 543}`;
}

function selectedPeriod(filters) {
  if (filters.date) return thaiDate(filters.date);
  if (filters.date_from && filters.date_to) return `${thaiDate(filters.date_from)} - ${thaiDate(filters.date_to)}`;
  if (filters.date_from) return `ตั้งแต่ ${thaiDate(filters.date_from)}`;
  if (filters.date_to) return `ถึง ${thaiDate(filters.date_to)}`;
  if (filters.month) return monthLabel.format(new Date(`${filters.month}-01T00:00:00Z`));
  return 'ทุกช่วงวันที่';
}

function accountName(name) {
  return name === 'MAKE' ? 'MAKE by KBank' : name;
}

export function transactionReport(items, filters, tables, now = new Date()) {
  const account = tables['บัญชี'].rows.find(row => row.account_id === filters.account_id);
  const category = tables['หมวดหมู่'].rows.find(row => row.category_id === filters.category_id);
  const view = filters.type === 'EXPENSE' && filters.owner ? (filters.owner === 'COMPANY' ? 'รายจ่ายบริษัท' : 'รายจ่ายส่วนตัว') : types[filters.type];
  const selection = [view || 'ทุกประเภท', accountName(account?.account_name || 'ทุกบัญชี'), category?.category_name || 'ทุกหมวดหมู่'];
  if (filters.query) selection.push(`คำค้น ${filters.query}`);
  const totals = { income: 0, expense: 0, transfer: 0 };
  const rows = items.map(item => {
    const amount = moneyCents(item.amount);
    const internal = ['MOVE', 'SELF_ALLOWANCE'].includes(item.company_kind);
    const active = item.status === 'ACTIVE';
    const income = active && !internal && item.transaction_type === 'INCOME' ? amount : null;
    const expense = active && !internal && item.transaction_type === 'EXPENSE' ? amount : null;
    const transfer = active && !internal && item.transaction_type === 'TRANSFER' ? amount : null;
    const status = [item.sync_pending && 'รออัปเดตบัญชี', { VOID: 'ยกเลิกแล้ว', DRAFT: 'ฉบับร่าง' }[item.status], internal && 'ไม่เคลื่อนเงินจริง'].filter(Boolean);
    if (income == null && expense == null && transfer == null && amount != null) status.push(`ยอดรายการ ${baht(amount)} บาท`);
    const primary = item.source_title || item.category_name || types[item.transaction_type] || 'รายการ';
    const name = [primary, item.description !== primary && item.description, item.project_name && `โครงการ ${item.project_name}`].filter(Boolean).join('\n');
    const from = accountName(item.account_name || item.account_id || '');
    const to = accountName(item.to_account_name || item.to_account_id || '');
    totals.income += income || 0;
    totals.expense += expense || 0;
    totals.transfer += transfer || 0;
    return {
      date: item.transaction_date, dateLabel: thaiDate(item.transaction_date),
      type: internal ? 'จัดสรรเงิน' : types[item.transaction_type] || 'รายการ',
      name, account: to ? `${from} ไป ${to}` : from,
      income, expense, transfer, status: status.join(' · '),
    };
  });
  if (!Object.values(totals).every(Number.isSafeInteger)) throw new Error('ยอดรวมเกินขอบเขตที่รองรับ');
  return { period: selectedPeriod(filters), selection: selection.join(' · '), issued: issueDate.format(now), rows,
    totals: { ...totals, net: totals.income - totals.expense } };
}
