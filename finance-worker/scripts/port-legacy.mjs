// Explicit development-only port from the public v53 source. No runtime eval.
// This script writes only the new application's generated files.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = path.resolve(root, '../.publish/FinanceAAA/personal-finance');
const read = name => readFile(path.join(source, name), 'utf8');
let code = await read('Code.gs');
code = code.slice(code.indexOf('const TZ ='));
code = code.replace(/^const APP_FAVICON = .*\r?\n/m, '');
code = code.replace(/function ss_\(\) \{[^\n]+\}/, 'function ss_() { return adapter.book; }');
code = code.slice(0, code.indexOf('function include(')) + code.slice(code.indexOf('function getConnectionStatus('));
code = code.slice(0, code.indexOf('// LINE เข้าทาง')) + code.slice(code.indexOf('function getDashboard('));
code = code.replace(/function id_\(p\) \{[^\n]+\}/, 'function id_(p) { return p+"-"+Utilities.getUuid().replaceAll("-", "").toUpperCase(); }');
code = code.replace(/function today_\(\) \{[^\n]+\}/, 'function today_() { return formatDate(clock(), TZ, "yyyy-MM-dd"); }');
code = code.replace(/function now_\(\) \{[^\n]+\}/, 'function now_() { return formatDate(clock(), TZ, "yyyy-MM-dd\'T\'HH:mm:ss"); }');
code = code.slice(0, code.indexOf('function debtBalance_(')) +
  'function debtBalance_(debt,items) { return debtState(debt,items).balance; }\n' + code.slice(code.indexOf('function debtPlanSheet_('));
code = code.replace('return Object.assign({},d,{balance,due_date:', 'return Object.assign({},d,debtState(d,items),{balance,due_date:');
const reads = ['getConnectionStatus','getBootstrap','getDashboard','getCategories','getTransactions','getTransaction',
  'getLatestTransactions','getCompanySummary','getCompanyFundingPreview','getCompanyReceiptPreview',
  'getCompanyProjectClosePreview','getCompanyAdvanceCandidates','getReimbursementPreview','getDebts','getRecurringDue','reconcileDatabase'];
const writes = ['saveTransaction','updateTransaction','voidTransaction','confirmDraft','setAccountAvailable','createCategory',
  'updateCategory','renameCategory','setCategoryActive','moveCategory','createCompanyProject','closeCompanyProject',
  'reclassifyCompanyAdvance','setDebtMonthlyDue','adjustDebtBalance','saveDebtPlan','createDebt','renameDebt','increaseDebt','payDebt',
  'createRecurring','deactivateRecurring','payRecurring'];
const overriddenDebts = ['createDebt','payDebt','increaseDebt','adjustDebtBalance'];
for (const name of overriddenDebts) {
  const from = code.indexOf('function ' + name + '('), to = code.indexOf('\nfunction ', from + 1);
  if (from < 0 || to < 0) throw new Error('Cannot safely remove the legacy debt write: ' + name);
  code = code.slice(0, from) + code.slice(to + 1);
}
const result = `// Ported from public Apps Script v53, commit f5873ef.\n// Legacy debt writes removed; manual components live in debt-components.js.\nimport { createBook, formatDate } from './legacy-store.js';\nimport { debtState, createDebtOperations } from './debt-components.js';\nexport const READ_METHODS = ${JSON.stringify(reads)};\nexport const WRITE_METHODS = ${JSON.stringify(writes)};\nexport function createLegacyEngine(snapshot, options = {}) {\nconst adapter = createBook(snapshot);\nconst clock = options.clock || (() => new Date());\nconst Utilities = { formatDate, getUuid: options.uuid || (() => crypto.randomUUID()) };\nconst LockService = {getScriptLock:()=>({waitLock(){},releaseLock(){}})};\n${code}\nconst debtOps = createDebtOperations({ SH, rows: rows_, append: appendObj_, ensure: ensureColumn_, audit: audit_,\n  now: now_, today: today_, date: isoDate_, id: id_, validateTx: validateTx_, newTx: newTx_,\n  category: debtPaymentCategory_, mutate: transactionMutationResult_, lock: withLock_, setMonthlyDue: setDebtMonthlyDue });\nreturn { api: {${[...reads, ...writes.filter(name => !overriddenDebts.includes(name))].join(',')}, ...debtOps}, snapshot: adapter.snapshot };\n}\n`;
await mkdir(path.join(root, 'src'), { recursive: true });
await mkdir(path.join(root, 'public'), { recursive: true });
await writeFile(path.join(root, 'src/legacy-engine.js'), result);
let html = await read('Index.html');
html = html.replace("<?!= include('CSS'); ?>", '<link rel="stylesheet" href="/styles.css">\n<link rel="stylesheet" href="/cloud.css">');
html = html.replace("<?!= include('JavaScript'); ?>", '<script src="/app.js"></script>\n<script src="/cloud.js"></script>');
html = html.replace('<body>', `<body>\n<div class="cloud-banner"><span id="cloudAccessNote">ระบบใหม่ · Cloudflare + D1</span><a href="/migration">นำเข้า / ตรวจยอด</a><button id="cloudLogoutButton" onclick="cloudLogout()" hidden>ออกจากระบบ</button></div>`);
html = html.replace('<div id="pageDashboard" class="page">', `<div id="pageDashboard" class="page">\n<div id="cloudSetup" class="card section-card hidden"><h3>เริ่มฐานข้อมูลใหม่</h3><p>เพิ่มบัญชีโดยระบุยอดเริ่มต้นและวันที่เอง ระบบยังไม่ได้นำประวัติจากเว็บเดิมมาใช้</p><button class="primary" onclick="openCloudAccount()">เพิ่มบัญชี</button></div>\n<div id="cloudDebtWarning" class="info hidden" role="status"></div>`);
html = html.replace('<div id="accountSettingsList" class="list"></div>', '<div id="accountSettingsList" class="list"></div><button class="primary wide" onclick="cancelDialog(\'accountSettingsDialog\');openCloudAccount()">+ เพิ่มบัญชี</button>');
html = html.replace('<div id="debtPlanWarning"', '<div id="cloudDebtPageWarning" class="info hidden" role="status"></div><div id="debtPlanWarning"');
html = html.replace('<dialog id="helpDialog"', `<dialog id="cloudAccountDialog"><form method="dialog" class="dialog-body" onsubmit="saveCloudAccount(event)"><h2>เพิ่มบัญชี</h2><label>ชื่อบัญชี<input id="cloudAccountName" required maxlength="60"></label><label>ประเภท<select id="cloudAccountType"><option value="BANK">ธนาคาร</option><option value="CASH">เงินสด</option><option value="E_WALLET">กระเป๋าเงิน</option></select></label><label>ยอดเริ่มต้น (บาท)<input id="cloudAccountOpening" type="number" step="0.01" required></label><label>วันที่ยอดเริ่มต้น<input id="cloudAccountDate" type="date" required></label><label><input id="cloudAccountAvailable" type="checkbox"> รวมในเงินพร้อมใช้</label><p>ยอดเริ่มต้นต้องไม่ซ้ำกับรายการที่จะนำเข้าภายหลัง</p><div class="actions"><button type="button" class="secondary" onclick="$('cloudAccountDialog').close()">ยกเลิก</button><button id="cloudAccountSave" class="primary">บันทึก</button></div></form></dialog>\n<dialog id="helpDialog"`);
html = html.replace('<label>ยอดหนี้เริ่มต้น</label>', '<label>เงินต้นค้างเริ่มต้น</label>');
html = html.replace('<label>ดอกเบี้ยรวม</label>', '<label>ดอกเบี้ยค้างเริ่มต้น</label>');
html = html.replace('<div id="debtRenameFields"', `<div id="cloudDebtOpeningFields" class="hidden"><div class="field"><label>ค่าธรรมเนียมค้างเริ่มต้น</label><input id="debtOpeningFees" type="number" min="0" step="0.01"></div><div class="field"><label>อ้างอิงใบแจ้งยอด / แหล่งยอดจริง</label><input id="debtOpeningReference" maxlength="160"></div><div class="field"><label>วันที่ยอดเริ่มต้น</label><input id="debtOpeningDate" type="date"></div><p class="hint">ยอดคงเหลือรวมทั้งสามส่วน ไม่มีดอกเบี้ยหรือค่าธรรมเนียมให้กรอก 0 ไม่มีการคิดดอกเบี้ยอัตโนมัติ</p></div><div id="debtRenameFields"`);
html = html.replace('<label for="debtAdjustedBalance">ยอดหนี้คงเหลือใหม่</label>', '<label for="debtAdjustedBalance">เงินต้นค้างตามใบแจ้งยอด</label>');
html = html.replace('<div class="field"><label for="debtAdjustReason">', `<div class="field"><label>ดอกเบี้ยค้างตามใบแจ้งยอด</label><input id="debtAdjustedInterest" type="number" min="0" step="0.01"></div><div class="field"><label>ค่าธรรมเนียมค้างตามใบแจ้งยอด</label><input id="debtAdjustedFees" type="number" min="0" step="0.01"></div><div class="field"><label>อ้างอิงใบแจ้งยอด / แหล่งยอดจริง</label><input id="debtAdjustedReference" maxlength="160"></div><p class="hint">ระบุยอดค้าง ณ วันที่ใบแจ้งยอด หลังหักรายการก่อนหน้านั้นแล้ว การยืนยันนี้ไม่เปลี่ยนเงินในบัญชีและไม่สร้างการจ่ายซ้ำ</p><div class="field"><label for="debtAdjustReason">`);
html = html.replace('<div id="debtAccountField"', `<div id="debtSplitFields" class="hidden"><div class="field"><label>ส่วนที่ชำระเงินต้น</label><input id="debtPaidPrincipal" type="number" min="0" step="0.01"></div><div class="field"><label>ส่วนที่ชำระดอกเบี้ย</label><input id="debtPaidInterest" type="number" min="0" step="0.01"></div><div class="field"><label>ส่วนที่ชำระค่าธรรมเนียม</label><input id="debtPaidFees" type="number" min="0" step="0.01"></div><div class="field"><label>อ้างอิงใบแจ้งยอด / หลักฐานการชำระ</label><input id="debtPaymentReference" maxlength="160"></div><p class="hint">ยอดเงินที่จ่ายต้องเท่ากับสามส่วนรวมกัน หากยอดค้างเปลี่ยนให้ยืนยันใบแจ้งยอดก่อน ไม่มีส่วนใดให้กรอก 0</p></div><div id="debtAccountField"`);
await writeFile(path.join(root, 'public/index.html'), html);
await writeFile(path.join(root, 'public/styles.css'), (await read('CSS.html')).replace(/^\s*<style>/, '').replace(/<\/style>\s*$/, ''));
let js = (await read('JavaScript.html')).replace(/^\s*<script>/, '').replace(/<\/script>\s*$/, '');
const start = js.indexOf('function server(name, ...args)');
const end = js.indexOf('function fail(', start);
js = js.slice(0, start) + `function server(name, ...args) { return window.financeRpc(name, args); }\n` + js.slice(end);
js = js.replace('const outstandingDebts=items.filter(item=>Math.round(Number(item.balance||0)*100)>0);', 'const outstandingDebts=items.filter(item=>Math.round(Number(item.balance||0)*100)>0||!item.balance_components_recorded);');
js = js.replace('<div class="row-sub">ดอกเบี้ยรวม ${money(item.total_interest)}</div>', '${item.balance_components_recorded ? `<div class="row-sub">เงินต้น ${money(item.balance_breakdown.principal)} · ดอกเบี้ยค้าง ${money(item.balance_breakdown.interest)} · ค่าธรรมเนียมค้าง ${money(item.balance_breakdown.fees)}</div><div class="row-sub">ดอกเบี้ยที่บันทึกว่าจ่ายแล้ว ${money(item.recorded_interest_paid)} · ค่าธรรมเนียมที่จ่ายแล้ว ${money(item.recorded_fees_paid)}</div>` : `<div class="row-sub">ยอดเดิมยังไม่ทราบส่วนประกอบ กรุณายืนยันใบแจ้งยอดก่อนชำระ</div>`}');
js = js.replace("debtMode = mode; selectedDebtId = id || null;", `debtMode = mode; selectedDebtId = id || null;
  if(mode==='pay'&&!(BOOT?.debts||[]).find(item=>item.debt_id===id)?.balance_components_recorded) { notify('warning','กรุณายืนยันใบแจ้งยอดก่อน','ใช้ปุ่มปรับยอดหนี้เพื่อระบุเงินต้น ดอกเบี้ยค้าง และค่าธรรมเนียมค้าง');return; }
  $('cloudDebtOpeningFields').classList.toggle('hidden', mode!=='create');
  $('debtSplitFields').classList.toggle('hidden', mode!=='pay');
  ['debtPaidPrincipal','debtPaidInterest','debtPaidFees','debtPaymentReference'].forEach(key=>$(key).value='');
  if(mode==='create'){ $('debtOpeningFees').value='';$('debtOpeningReference').value='';$('debtOpeningDate').value=BOOT.today; }`);
js = js.replace("$('debtOpening').value = '0';", "$('debtOpening').value = '';");
js = js.replace("$('debtInterest').value = '0';", "$('debtInterest').value = '';");
js = js.replace("$('debtAdjustedBalance').value = debt?.balance ?? 0;", `$('debtAdjustedBalance').value = debt?.balance_breakdown?.principal ?? '';
    $('debtAdjustedInterest').value = debt?.balance_breakdown?.interest ?? '';
    $('debtAdjustedFees').value = debt?.balance_breakdown?.fees ?? '';
    $('debtAdjustedReference').value = '';`);
js = js.replace("debt_name: $('debtName').value, opening_balance: $('debtOpening').value,", "debt_name: $('debtName').value, principal_amount: $('debtOpening').value, interest_amount: $('debtInterest').value, fee_amount: $('debtOpeningFees').value, statement_reference: $('debtOpeningReference').value,");
js = js.replace("total_interest: $('debtInterest').value, start_date: BOOT.today", "start_date: $('debtOpeningDate').value");
js = js.replace("debt_id: selectedDebtId, balance: $('debtAdjustedBalance').value, reason: $('debtAdjustReason').value,", "debt_id: selectedDebtId, principal_amount: $('debtAdjustedBalance').value, interest_amount: $('debtAdjustedInterest').value, fee_amount: $('debtAdjustedFees').value, statement_reference: $('debtAdjustedReference').value, reason: $('debtAdjustReason').value,");
js = js.replace("else result = await server('payDebt', { debt_id: selectedDebtId, amount: $('debtAmount').value,", "else result = await server('payDebt', { debt_id: selectedDebtId, amount: $('debtAmount').value, principal_amount: $('debtPaidPrincipal').value, interest_amount: $('debtPaidInterest').value, fee_amount: $('debtPaidFees').value, statement_reference: $('debtPaymentReference').value,");
// Cloud transport must load before the legacy app's immediate bootstrap request.
html = html.replace('<script src="/app.js"></script>\n<script src="/cloud.js"></script>', '<script src="/cloud.js"></script>\n<script src="/app.js"></script>');
await writeFile(path.join(root, 'public/index.html'), html);
await writeFile(path.join(root, 'public/app.js'), js);
console.log('Ported public v53 source into finance-worker only.');
