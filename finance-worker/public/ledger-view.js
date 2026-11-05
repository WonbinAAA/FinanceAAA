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
  if(item.source==='company-owner-ledger')return item.source_title||item.category_name;
  const labels = {ADVANCE:'รับเงินบริษัทล่วงหน้า',RETURN:'คืนเงินล่วงหน้าบริษัท',MOVE:'ย้ายเงินระหว่างกอง',SELF_ALLOWANCE:'เบี้ยเลี้ยงให้ตัวเอง',OTHER_ALLOWANCE:'เบี้ยเลี้ยงให้คนอื่น',MIXED_RECEIPT:'รับเงินบริษัท · คืนยอดและกองกลาง'};
  if (item.company_kind === 'OTHER_ALLOWANCE' && item.recipient) return 'เบี้ยเลี้ยง · ' + item.recipient;
  return labels[item.company_kind] || item.category_name || (item.transaction_type === 'TRANSFER' ? 'โอนเงิน' : item.description || item.transaction_type);
}
function ledgerIconKind(item) {
  const label = [item.category_name,ledgerLabel(item)].filter(Boolean).join(' '), internal = ['MOVE','SELF_ALLOWANCE'].includes(item.company_kind);
  let tone = item.transaction_type === 'INCOME' ? 'income' : 'other';
  if (item.transaction_type === 'TRANSFER' || item.company_kind === 'MOVE') tone = 'transfer';
  else if (/เบี้ยเลี้ยง/.test(label)) tone = 'allowance';
  else if (/น้ำมัน|ดีเซล|LPG|แก๊ส|เชื้อเพลิง/i.test(label)) tone = 'fuel';
  else if (/ที่พัก|โรงแรม/.test(label)) tone = 'stay';
  else if (/กาแฟ|คาเฟ่|เครื่องดื่ม|ชาเขียว|ชานม/.test(label)) tone = 'drink';
  else if (/ข้าว|อาหาร|ของกิน|เสบียง|ผลไม้|ขนม/.test(label)) tone = 'food';
  else if (/โทรศัพท์|มือถือ|อินเทอร์เน็ต|internet/i.test(label)) tone = 'phone';
  else if (/เดินทาง|รถ|แท็กซี่|รถไฟ|ทางด่วน/.test(label)) tone = 'transport';
  else if (/สุขภาพ|ยา|โรงพยาบาล|รักษา/.test(label)) tone = 'health';
  else if (/ซื้อกองทุน|ออม|ชำระหนี้|ดอกเบี้ย|ค่าธรรมเนียม/.test(label)) tone = 'finance';
  else if (/ทำบุญ|บริจาค|ของขวัญ|ของขัวญ|งานสังคม/.test(label)) tone = 'gift';
  else if (/บันเทิง|เกม|เกมส์|สนองกิเลส/.test(label)) tone = 'entertainment';
  else if (/ช้อปปิ้ง|ของใช้/.test(label)) tone = 'shopping';
  else if (/ไฟฟ้า|น้ำประปา|ส่วนกลาง/.test(label)) tone = 'utility';
  else if (internal) tone = 'allowance';
  return tone;
}
function ledgerIcon(item) {
  const tone=ledgerIconKind(item);
  const paths = {
    income:'<path d="M18 6 6 18M6 7v11h11"/>',
    transfer:'<path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4"/>',
    allowance:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v3"/>',
    fuel:'<path d="M4 21V4h10v17M3 21h12M4 10h10M14 13h2a2 2 0 0 1 2 2v3a2 2 0 0 0 4 0V8l-3-3M19 5v4h3"/>',
    stay:'<path d="M3 19V6M3 14h18v5M21 14V9h-9v5M3 19v2M21 19v2"/><circle cx="7.5" cy="10" r="2.5"/>',
    utility:'<path d="m13 2-9 12h7l-1 8 10-13h-7l1-7"/>',
    food:'<path d="M4 3v7a3 3 0 0 0 6 0V3M7 3v18M20 21V3c-4 2-5 8 0 9"/>',
    drink:'<path d="M4 8h13v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8zM17 9h2a3 3 0 0 1 0 6h-2M7 3v2M11 2v3M15 3v2M2 22h18"/>',
    phone:'<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 5h4M11 19h2"/>',
    transport:'<path d="m4 9 2-5h12l2 5M3 10h18v8H3zM5 18v3M19 18v3M6 13h2M16 13h2"/>',
    health:'<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
    finance:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3M16 14v2"/>',
    gift:'<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13"/><path d="M12 8C5 8 5 2 8 3c3 0 4 5 4 5s1-5 4-5c3-1 3 5-4 5"/>',
    entertainment:'<path d="M7 7h10a4 4 0 0 1 4 3l1 7a3 3 0 0 1-5 2l-2-2H9l-2 2a3 3 0 0 1-5-2l1-7a4 4 0 0 1 4-3zM6 11v4M4 13h4M16 12h.1M19 15h.1"/>',
    shopping:'<path d="M4 7h16l1 14H3L4 7zM8 8V6a4 4 0 0 1 8 0v2"/>',
    other:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 7h6M9 11h6M9 15h3"/>'
  };
  return `<span class="finance-category ${tone}" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24">${paths[tone]}</svg></span>`;
}
function renderLedgerRow(item, options = {}) {
  const label = ledgerLabel(item), internal = ['MOVE','SELF_ALLOWANCE'].includes(item.company_kind);
  const kind = internal ? 'internal' : item.transaction_type === 'INCOME' ? 'income' : item.transaction_type === 'EXPENSE' ? 'expense' : 'transfer';
  const sign = kind === 'income' ? '+' : kind === 'expense' ? '−' : '';
  const status = item.sync_pending?'รออัปเดตบัญชี':{VOID:'ยกเลิกแล้ว',DRAFT:'ร่าง'}[item.status];
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
