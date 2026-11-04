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
  return html;
}

export function applyLayoutJavaScript(js) {
  if (js.includes('layoutPageName')) return refineLedgerJavaScript(js);
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
  const companyUrl='https://company-expenses-ledger.sugrid-kumpa.workers.dev/?from=finance#transactions';
  if (!js.includes(companyUrl)) js=js.replace('function showPage(name) {', `function showPage(name) {\n  if (name === 'Company') { location.assign('${companyUrl}'); return; }`);
  if (!js.includes("addEventListener('pageshow'")) js += "\nwindow.addEventListener('pageshow', event => { if (event.persisted) refreshAll(); });\n";
  if (!js.includes('return renderLedgerRow(item, {compact:true});')) {
    const start=js.indexOf('function transactionRow(item) {'), end=js.indexOf('function renderLatest(items)',start);
    if(start<0||end<0) throw new Error('Cannot locate the read-only transaction renderer');
    js=js.slice(0,start)+'function transactionRow(item) { return renderLedgerRow(item, {compact:true}); }\n'+js.slice(end);
  }
  js=js.replace("$('transactionList').innerHTML = items.length ? items.map(transactionRow).join('')", "$('transactionList').innerHTML = items.length ? renderLedgerDays(items)");
  js=js.replace("companyTransactions.map(transactionRow).join('')", 'renderLedgerDays(companyTransactions)');
  return js;
}
