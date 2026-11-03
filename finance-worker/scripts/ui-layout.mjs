// Presentation only. Keep the legacy port reproducible without changing money rules.
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
const pages = [ ['Dashboard','home','หน้าหลัก'], ['Transactions','list','รายการ'], ['Company','company','บริษัท'], ['Debt','debt','หนี้'], ['Recurring','repeat','รายการประจำ'] ];

export function applyLayoutHtml(html) {
  if (html.includes('id="financeSidebar"')) return html;
  html = html.replace('<link rel="stylesheet" href="/cloud.css">', '<link rel="stylesheet" href="/cloud.css">\n<link rel="stylesheet" href="/workspace.css">');
  const sidebar = `<aside id="financeSidebar" class="finance-sidebar" aria-label="เมนูการเงิน">
    <a class="finance-brand" href="#pageDashboard" onclick="showPage('Dashboard');return false"><span class="finance-brand-mark">${icon('wallet')}</span><span><strong>สมุดการเงิน</strong><small>รายรับ รายจ่าย และเงินบริษัท</small></span></a>
    <p class="finance-nav-caption">พื้นที่ทำงานของคุณ</p>
    <nav aria-label="หน้าต่าง ๆ">${pages.map(([page,symbol,label])=>`<button type="button" data-page="${page}" ${page==='Dashboard'?'class="active" aria-current="page"':''} onclick="showPage('${page}')">${icon(symbol)}<span>${label}</span><i aria-hidden="true"></i></button>`).join('\n')}</nav>
    <div class="finance-sidebar-bottom"><span class="finance-sidebar-caption">${icon('wallet')}<b>ทุกยอดเงิน อยู่ในที่เดียว</b></span><p>ติดตามเงินส่วนตัว เงินบริษัท<br>และรายการที่ต้องจ่าย</p><a class="finance-backup-link" href="/migration">นำเข้าและสำรองข้อมูล <span aria-hidden="true">↗</span></a></div>
  </aside>`;
  html = html.replace('<main class="app">', sidebar+'\n<main class="app">');
  html = html.replace('<div class="topbar-title"><h1>รายรับ-รายจ่ายของฉัน</h1></div>', `<div class="topbar-title"><span class="finance-mobile-mark">${icon('wallet')}</span><div><h1>รายรับ-รายจ่ายของฉัน</h1><span id="layoutPageName" class="finance-page-name">ภาพรวมการเงิน</span></div></div>`);
  html = html.replace('<div class="topbar-actions">', `<div class="topbar-actions"><button type="button" class="finance-desktop-add" onclick="openEntryDialog()">${icon('plus')}<span>เพิ่มรายการ</span></button>`);
  html = html.replace('<div id="pageDashboard" class="page">', '<div id="pageDashboard" class="page">\n<div class="finance-dashboard-heading"><div><h2>ภาพรวมการเงิน</h2><p>ยอดเงิน บัญชี และรายการล่าสุดของคุณ</p></div><span class="finance-heading-label">สมุดการเงินของฉัน</span></div>');
  html = html.replace('<nav class="bottom-nav">', '<nav class="bottom-nav" aria-label="เมนูหลักบนมือถือ">');
  return html;
}

export function applyLayoutJavaScript(js) {
  if (js.includes('layoutPageName')) return js;
  js = js.replace("document.querySelectorAll('.bottom-nav button[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === name));",
    `document.querySelectorAll('.bottom-nav button[data-page], .finance-sidebar button[data-page]').forEach(button => {
    const current = button.dataset.page === name;
    button.classList.toggle('active', current);
    if (current) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  if ($('layoutPageName')) $('layoutPageName').textContent = ({Dashboard:'ภาพรวมการเงิน',Transactions:'รายการทั้งหมด',Company:'เงินบริษัท',Debt:'หนี้',Recurring:'รายการประจำ'})[name] || '';`);
  return js;
}
