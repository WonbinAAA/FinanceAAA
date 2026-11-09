// Presentation only. Keep the legacy port reproducible without changing money rules.
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
const pages = [ ['Dashboard','home','หน้าหลัก'], ['Transactions','list','รายการ'], ['Company','company','บริษัท'], ['Debt','debt','หนี้'], ['Recurring','repeat','รายการประจำ'] ];

export function applyAppIcon(html) {
  if (html.includes('rel="icon"')) return html;
  return html.replace('</head>', `<link rel="icon" type="image/png" href="/personal-finance-portrait-icon.png">
<link rel="apple-touch-icon" href="/personal-finance-portrait-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#713dea">
</head>`);
}

export function applyLayoutHtml(html) {
  if (html.includes('id="financeSidebar"')) return refineWorkspaceHtml(html);
  html = html.replace('<link rel="stylesheet" href="/cloud.css">', '<link rel="stylesheet" href="/cloud.css">\n<link rel="stylesheet" href="/workspace.css">');
  const sidebar = `<aside id="financeSidebar" class="finance-sidebar" aria-label="เมนูการเงิน">
    <a class="finance-brand" href="#pageDashboard" onclick="showPage('Dashboard');return false"><span class="finance-brand-mark">${icon('wallet')}</span><span><strong>สมุดการเงิน</strong><small>รายรับ รายจ่าย และเงินบริษัท</small></span></a>
    <p class="finance-nav-caption">พื้นที่ทำงานของคุณ</p>
    <nav aria-label="หน้าต่าง ๆ">${pages.map(([page,symbol,label])=>`<button type="button" data-page="${page}" ${page==='Dashboard'?'class="active" aria-current="page"':''} onclick="showPage('${page}')">${icon(symbol)}<span>${label}</span><i aria-hidden="true"></i></button>`).join('\n')}</nav>
  </aside>`;
  html = html.replace('<main class="app">', sidebar+'\n<main class="app">');
  html = html.replace('<div class="topbar-title"><h1>รายรับ-รายจ่ายของฉัน</h1></div>', `<div class="topbar-title"><span class="finance-mobile-mark">${icon('wallet')}</span><div><h1>รายรับ-รายจ่ายของฉัน</h1><span id="layoutPageName" class="finance-page-name">ภาพรวมการเงิน</span></div></div>`);
  html = html.replace('<div class="topbar-actions">', `<div class="topbar-actions"><button type="button" class="finance-desktop-add" onclick="openEntryDialog()">${icon('plus')}<span>เพิ่มรายการ</span></button>`);
  html = html.replace('<div id="pageDashboard" class="page">', '<div id="pageDashboard" class="page">\n<div class="finance-dashboard-heading"><div><h2>ภาพรวมการเงิน</h2><p>ยอดเงิน บัญชี และรายการล่าสุดของคุณ</p></div><span class="finance-heading-label">สมุดการเงินของฉัน</span></div>');
  html = html.replace('<nav class="bottom-nav">', '<nav class="bottom-nav" aria-label="เมนูหลักบนมือถือ">');
  return refineWorkspaceHtml(html);
}

function refineWorkspaceHtml(html) {
  html = applyAppIcon(html);
  html=html.replace('aria-label="ดูรายละเอียดเงินบริษัทที่ถืออยู่"','aria-label="เปิดสมุดบริษัทเพื่อดูยอดสุทธิ"');
  html=html.replace('เงินบริษัทที่ถืออยู่<small>ทุกบัญชี · ยังไม่ใช่เงินส่วนตัว</small>','ยอดสุทธิบริษัท<small id="dashboardCompanyNetCaption">กำลังอ่านสมุดบริษัท…</small>');
  html=html.replace('<b id="dashboardCompanyHeld">฿0.00</b>','<b id="dashboardCompanyHeld">—</b>');
  html=html.replace('ให้ดู <strong>เงินบริษัทที่ถืออยู่</strong> แยกประกอบด้วย','ให้ดู <strong>ยอดสุทธิบริษัท</strong> ซึ่งเป็นเงินรับลบเงินจ่ายทั้งหมดตามสมุดบริษัทประกอบ ยอดสุทธินี้ไม่หักจากยอดบัญชีซ้ำ');
  if(!html.includes('src="/company-net.js"'))html=html.replace('<script src="/app.js"></script>','<script src="/company-net.js"></script>\n<script src="/app.js"></script>');
  // Remove the exact top strip requested by the owner. Backup remains in the menu.
  html = html.replace(/<div class="cloud-banner">[\s\S]*?<\/div>\s*/, '');
  html = html.replace(/<div id="cloudDebt(?:Page)?Warning"[^>]*><\/div>\s*/g, '');
  html = html.replace(/<div class="finance-sidebar-bottom">[\s\S]*?<\/div>\s*/, '');
  if (!html.includes('id="financeOverview"')) {
    html = html.replace('<section class="hero card">', '<div id="financeOverview" class="finance-overview">\n<section class="hero card">');
    html = html.replace('    <section class="summary-grid">', '    </div>\n<section class="summary-grid">');
    html = html.replace('    <section class="card section-card">\n      <div class="section-title account-section-title">', '    <div class="finance-detail-grid">\n<section class="card section-card">\n      <div class="section-title account-section-title">');
    html = html.replace('    <section id="pageTransactions"', '    </div>\n<section id="pageTransactions"');
    // Close the details wrapper before the Dashboard page closes, not after it.
    html = html.replace('    </section>\n    </div>\n\n    </div>\n<section id="pageTransactions"', '    </section>\n    </div>\n    </div>\n\n<section id="pageTransactions"');
  }
  if (!html.includes('finance-mobile-backup')) html = html.replace('<div class="help-quick">', '<p class="finance-mobile-backup"><a href="/migration">นำเข้า ตรวจยอด และสำรองข้อมูล ↗</a></p><div class="help-quick">');
  if (!html.includes('src="/ledger-view.js"')) html = html.replace('<script src="/app.js">', '<script src="/ledger-view.js"></script>\n<script src="/app.js">');
  html = html.replace('id="transactionList" class="list transaction-cards"', 'id="transactionList" class="list finance-ledger"');
  html = html.replace('id="companyTransactionList" class="list"', 'id="companyTransactionList" class="list finance-ledger"');
  html = html.replace('id="latestList" class="list"', 'id="latestList" class="list finance-latest"');
  return refineRequestedWorkspace(html);
}

export function applyLayoutJavaScript(js) {
  if (js.includes('.finance-sidebar button[data-page]')) return refineLedgerJavaScript(js);
  js = js.replace("document.querySelectorAll('.bottom-nav button[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === name));",
    `document.querySelectorAll('.bottom-nav button[data-page], .finance-sidebar button[data-page]').forEach(button => {
    const current = button.dataset.page === name;
    button.classList.toggle('active', current);
    if (current) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  if ($('layoutPageName')) $('layoutPageName').textContent = ({Dashboard:'ภาพรวมการเงิน',Transactions:'รายการทั้งหมด',Company:'เงินบริษัท',Debt:'หนี้',Recurring:'รายการประจำ'})[name] || '';`);
  return refineLedgerJavaScript(js);
}

function refineLedgerJavaScript(js) {
  js=refineRequestedJavaScript(js);
  js=js.replace("$('dashboardCompanyHeld').textContent = money(data.company_advance || 0);",'void window.refreshCompanyLedgerNet();');
  const companyUrl='https://company-expenses-ledger.sugrid-kumpa.workers.dev/finance/?from=finance#transactions';
  js=js.replaceAll('https://company-expenses-ledger.sugrid-kumpa.workers.dev/?from=finance#transactions',companyUrl);
  if (!js.includes(companyUrl)) js=js.replace('function showPage(name) {', `function showPage(name) {\n  if (name === 'Company') { location.assign('${companyUrl}'); return; }`);
  if (!js.includes("addEventListener('pageshow'")) js += "\nwindow.addEventListener('pageshow', event => { if (event.persisted) refreshAll(); });\n";
  js=js.replace("$('transactionList').innerHTML = items.length ? items.map(transactionRow).join('')", "$('transactionList').innerHTML = items.length ? renderLedgerDays(items)");
  return js;
}

function refineRequestedWorkspace(html){
  html=html.replace('<p>รายรับ · รายจ่าย · เงินบริษัท · โอนเงิน</p>','');
  html=html.replace('<p>แตะรายการเพื่อดูรายละเอียด แก้ไข หรือยกเลิก</p>','');
  html=html.replace(/<div class="finance-dashboard-heading">[\s\S]*?<\/div><span class="finance-heading-label">[\s\S]*?<\/span><\/div>/,'');
  html=html.replace(/<span id="layoutPageName"[^>]*>[\s\S]*?<\/span>/,'');
  html=html.replace('<small>รายการรับ-จ่ายล่าสุดของคุณ</small>','');
  html=html.replace(/<p[^>]*>ยอดเงินจริงในบัญชีที่เลือก รวมเงินบริษัทที่อยู่ในบัญชีเหล่านี้<\/p>/,'');
  html=html.replace('<div class="hero-caption">ยอดเงินจริงในบัญชีที่เลือก รวมเงินบริษัทที่อยู่ในบัญชีเหล่านี้</div>','');
  html=html.replace('ยอดสุทธิบริษัท<small id="dashboardCompanyNetCaption">กำลังอ่านสมุดบริษัท…</small>','ยอดเงินบริษัท');
  html=html.replace('<span>บริษัทค้างคืน</span><b id="company">฿0.00</b><small>เงินที่ออกแทน</small>','<span id="companyReserveLabel">บริษัทค้างจ่าย</span><b id="company">—</b><small>เงินออกแทนและเบี้ยเลี้ยงตัวเอง</small>');
  html=html.replace('<div class="card metric metric-company">','<div id="companyReserveCard" class="card metric metric-company">');
  html=html.replace('<strong>ยอดสุทธิบริษัท</strong>','<strong>ยอดเงินบริษัท</strong>');
  html=html.replace('id="latestList" class="list finance-latest"','id="latestList" class="list finance-ledger finance-latest"');
  html=html.replace('<div class="eyebrow">รายการเงิน</div>','');
  html=html.replace('<p>เมื่อออกเงินแทนบริษัท เลือก <strong>รายจ่ายบริษัท</strong> ระบบจะลดเงินในบัญชีและเพิ่มยอดบริษัทค้างคืน ช่องโปรเจกต์จะแสดงเฉพาะแบบนี้ และเลือกค่าน้ำมันหรือค่าแก๊สจากหมวดหมู่ได้</p>','<p>เพิ่มค่าใช้จ่ายบริษัทจากแท็บ <strong>บริษัท</strong> โดยเลือกบัญชีที่จ่ายจริง ระบบจะส่งรายการมาอัปเดตยอดบัญชีให้อัตโนมัติ</p>');
  html=html.replace(/\s*<button type="button" data-entry-kind="COMPANY"[^>]*>[\s\S]*?<\/button>/,'');
  html=html.replace('<button class="close" onclick="cancelDialog(\'entryDialog\')">×</button>','<button class="close" aria-label="ปิดฟอร์ม" onclick="cancelDialog(\'entryDialog\')">×</button>');
  const day='<div class="field"><label>วันที่</label><input id="txDate" type="date"></div>';
  const money='<div class="field"><label>จำนวนเงิน</label><input id="amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></div>';
  html=html.replace(day+'\n      '+money,money.replace('class="field"','class="field entry-amount"')+'\n      '+day);
  return html.replace(/^[ \t]+$/gm,'');
}
function refineRequestedJavaScript(js){
  js=js.replace("server('getTransactions', filters)","server('getDisplayTransactions', filters)");
  if(!js.includes('++latestViewRequest'))js=js.replace(/function renderLatest\(items\) \{[\s\S]*?\n\}/,`async function renderLatest() {
  const request=++latestViewRequest;
  $('latestList').innerHTML='<div class="empty">กำลังโหลด...</div>';
  try {
    const items=await server('getDisplayTransactions',{limit:8});
    if(request!==latestViewRequest)return;
    $('latestList').innerHTML=items.length?renderLedgerDays(items):'<div class="empty">ยังไม่มีรายการ</div>';
  } catch(error) {
    if(request!==latestViewRequest)return;
    $('latestList').innerHTML='<div class="empty">'+esc(error.message)+' <button class="secondary" onclick="renderLatest()">ลองใหม่</button></div>';
  }
}`);
  if(!js.includes("$('transactionList').innerHTML='<div class=\"empty\">กำลังโหลด...</div>';"))js=js.replace("$('transactionCount').textContent='กำลังค้นหา...';","$('transactionCount').textContent='กำลังค้นหา...';\n  $('transactionList').innerHTML='<div class=\"empty\">กำลังโหลด...</div>';");
  js=js.replace('} catch (error) { if (request === transactionRequest) fail(error); }',`}
  catch(error){if(request===transactionRequest){
    $('transactionCount').textContent='อ่านรายการไม่สำเร็จ';
    $('transactionList').innerHTML='<div class="empty">'+esc(error.message)+' <button class="secondary" onclick="loadTransactions()">ลองใหม่</button></div>';
  }}`);
  js=js.replace("$('company').textContent = money(data.company_receivable);",'// Reserve display is read from the company book, independently of bank cash.');
  js=js.replace("$('latestList').innerHTML = items.length ? items.map(transactionRow).join('')","$('latestList').innerHTML = items.length ? renderLedgerDays(items)");
  if(!js.includes('preferredExpenseAccount')){
    js=js.replace("  selectType('EXPENSE');\n}","  selectType('EXPENSE');\n  const preferredExpenseAccount=BOOT?.accounts?.find(a=>String(a.account_name||'').trim()==='กรุงไทย');\n  if(preferredExpenseAccount) $('account').value=preferredExpenseAccount.account_id;\n  syncAccountPickerButtons();\n}");
  }
  if(!js.includes('Company entries are created in the source book'))js=js.replace("function selectType(type, owner = 'PERSONAL') {","function selectType(type, owner = 'PERSONAL') {\n  // Company entries are created in the source book; historical edit values stay intact.\n  if(type==='EXPENSE'&&owner==='COMPANY'&&!selectedTx){showPage('Company');return;}\n  $('entryDialog').dataset.entryType=type;");
  return js;
}
