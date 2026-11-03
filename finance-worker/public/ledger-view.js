// Read-only presentation of ledger records. Never writes or changes a source row.
function ledgerEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function ledgerNumber(value) {
  return Number(value || 0).toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2});
}
function ledgerDate(date) {
  const [year,month,day] = String(date).split('-').map(Number);
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return `${day}-${months[month-1]}-${year+543}`;
}
function ledgerLabel(item) {
  const labels = {ADVANCE:'รับเงินบริษัทล่วงหน้า',RETURN:'คืนเงินล่วงหน้าบริษัท',MOVE:'ย้ายเงินระหว่างกอง',SELF_ALLOWANCE:'เบี้ยเลี้ยงให้ตัวเอง',OTHER_ALLOWANCE:'เบี้ยเลี้ยงให้คนอื่น',MIXED_RECEIPT:'รับเงินบริษัท · คืนยอดและกองกลาง'};
  if (item.company_kind === 'OTHER_ALLOWANCE' && item.recipient) return 'เบี้ยเลี้ยง · ' + item.recipient;
  return labels[item.company_kind] || item.category_name || (item.transaction_type === 'TRANSFER' ? 'โอนเงิน' : item.description || item.transaction_type);
}
function ledgerIcon(item) {
  const label = ledgerLabel(item), internal = ['MOVE','SELF_ALLOWANCE'].includes(item.company_kind);
  let tone = item.transaction_type === 'INCOME' ? 'income' : 'other';
  if (item.transaction_type === 'TRANSFER' || item.company_kind === 'MOVE') tone = 'transfer';
  else if (/เบี้ยเลี้ยง/.test(label)) tone = 'allowance';
  else if (/น้ำมัน|ดีเซล|LPG|แก๊ส|เชื้อเพลิง/i.test(label)) tone = 'fuel';
  else if (/ที่พัก|โรงแรม/.test(label)) tone = 'stay';
  else if (/ไฟฟ้า|น้ำประปา|internet|ส่วนกลาง/i.test(label)) tone = 'utility';
  else if (internal) tone = 'allowance';
  const paths = {
    income:'<path d="M18 6 6 18M6 7v11h11"/>',
    transfer:'<path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4"/>',
    allowance:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v3"/>',
    fuel:'<path d="M4 21V4h10v17M3 21h12M4 10h10M14 13h2a2 2 0 0 1 2 2v3a2 2 0 0 0 4 0V8l-3-3M19 5v4h3"/>',
    stay:'<path d="M3 19V6M3 14h18v5M21 14V9h-9v5M3 19v2M21 19v2"/><circle cx="7.5" cy="10" r="2.5"/>',
    utility:'<path d="m13 2-9 12h7l-1 8 10-13h-7l1-7"/>',
    other:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 7h6M9 11h6M9 15h3"/>'
  };
  return `<span class="finance-category ${tone}" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24">${paths[tone]}</svg></span>`;
}
function renderLedgerRow(item, options = {}) {
  const label = ledgerLabel(item), internal = ['MOVE','SELF_ALLOWANCE'].includes(item.company_kind);
  const kind = internal ? 'internal' : item.transaction_type === 'INCOME' ? 'income' : item.transaction_type === 'EXPENSE' ? 'expense' : 'transfer';
  const sign = kind === 'income' ? '+' : kind === 'expense' ? '−' : '';
  const status = {VOID:'ยกเลิกแล้ว',DRAFT:'ร่าง'}[item.status];
  const project = String(item.project_name || '');
  let note = String(item.description || '');
  // Only remove the exact project prefix that the original form generated.
  if (project && note.startsWith(project + ' | ')) note = note.slice(project.length + 3);
  if (note === label) note = '';
  const account = typeof accountDisplayName === 'function' ? accountDisplayName(item.account_name || item.account_id || '') : item.account_name || item.account_id || '';
  const metadata = [options.compact ? ledgerDate(item.transaction_date) : '', account, item.transaction_type === 'EXPENSE' ? item.expense_owner === 'COMPANY' ? 'บริษัท' : 'ส่วนตัว' : ''].filter(Boolean).join(' · ');
  return `<button type="button" class="finance-entry ${options.compact?'compact':''} ${item.status==='VOID'?'is-void':''}" data-id="${ledgerEscape(item.transaction_id)}">
    ${ledgerIcon(item)}<span class="finance-entry-info"><strong>${ledgerEscape(label)}${status?` <span class="badge ${item.status.toLowerCase()}">${status}</span>`:''}</strong>
    ${note?`<span class="finance-entry-note">${ledgerEscape(note)}</span>`:''}
    ${project?`<span class="finance-entry-project">โครงการ: ${ledgerEscape(project)}</span>`:''}
    ${metadata?`<span class="finance-entry-meta">${ledgerEscape(metadata)}</span>`:''}</span>
    <span class="finance-entry-amount ${kind}">${sign}${ledgerNumber(item.amount)}<small>${internal?'ไม่เคลื่อนเงินจริง':'บาท'}</small></span>
  </button>`;
}
function ledgerDayGroups(items) {
  const groups = new Map();
  for (const item of items) {
    const day = String(item.transaction_date);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(item);
  }
  return [...groups].sort(([a],[b])=>b.localeCompare(a));
}
function ledgerCashCents(item) {
  if (item.status !== 'ACTIVE' || item.transaction_type === 'TRANSFER' || ['MOVE','SELF_ALLOWANCE'].includes(item.company_kind)) return 0;
  const cents = Math.round(Number(item.amount || 0) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('จำนวนเงินรายการไม่ถูกต้องสำหรับยอดสุทธิ');
  return item.transaction_type === 'INCOME' ? cents : item.transaction_type === 'EXPENSE' ? -cents : 0;
}
function renderLedgerDays(items) {
  return ledgerDayGroups(items).map(([day,rows])=>{
    const weekday = new Intl.DateTimeFormat('th-TH', {weekday:'long',timeZone:'UTC'}).format(new Date(day+'T00:00:00Z'));
    const net = rows.reduce((sum,row)=>sum+ledgerCashCents(row),0);
    if (!Number.isSafeInteger(net)) throw new Error('ยอดสุทธิรายการเกินขอบเขตที่รองรับ');
    const sign = net>0 ? '+' : net<0 ? '−' : '';
    return `<section class="finance-day" aria-label="${ledgerEscape(ledgerDate(day))} ${rows.length} รายการ"><header class="finance-day-heading"><span class="finance-day-number">${Number(day.slice(-2))}</span><span class="finance-day-date"><b>${weekday}</b><time datetime="${ledgerEscape(day)}">${ledgerEscape(ledgerDate(day))}</time></span><span class="finance-day-net" data-cash-cents="${net}" title="เงินเข้า−เงินออกของรายการที่แสดง ไม่รวมการโอนหรือรายการที่ไม่เคลื่อนเงินจริง"><small>ยอดสุทธิ</small>${sign}${ledgerNumber(Math.abs(net)/100)}</span></header>${rows.map(item=>renderLedgerRow(item)).join('')}</section>`;
  }).join('');
}
