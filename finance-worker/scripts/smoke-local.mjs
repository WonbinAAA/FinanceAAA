// Optional real-browser QA. Uses only loopback and synthetic local records.
// FINANCE_PLAYWRIGHT_MODULE may point at an already installed Playwright module.
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.FINANCE_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:8787/');
  await page.waitForURL('**/login');
  await page.getByRole('button', { name: 'ทดสอบในเครื่องด้วยข้อมูลจำลอง' }).click();
  await page.waitForFunction(() => document.getElementById('syncStatus')?.classList.contains('hidden')).catch(async error => {
    await mkdir('.wrangler/screenshots', { recursive: true });
    await page.screenshot({ path: '.wrangler/screenshots/startup-error.png', fullPage: true });
    console.error('Startup browser errors:', errors);
    console.error('Startup status:', await page.locator('#connectionError').count() ? await page.locator('#connectionError').textContent() : 'not on app page');
    throw error;
  });
  const starting = await page.evaluate(async () => (await window.financeRpc('getDashboard', [])).available_cash);
  const formatted = value => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  await page.getByRole('button', { name: 'จัดการ', exact: true }).click();
  await page.getByRole('button', { name: '+ เพิ่มบัญชี', exact: true }).click();
  await page.locator('#cloudAccountName').fill('บัญชีทดสอบ ' + Date.now());
  await page.locator('#cloudAccountOpening').fill('1000.04');
  await page.locator('#cloudAccountDate').fill('2026-11-03');
  await page.locator('#cloudAccountAvailable').check();
  await page.locator('#cloudAccountSave').click();
  await page.waitForFunction(() => !document.getElementById('cloudAccountDialog').open);
  assert.ok((await page.locator('#cash').textContent()).includes(formatted(starting + 1000.04)));
  await page.getByRole('button', { name: 'เพิ่มรายการ', exact: true }).click();
  await page.locator('#amount').fill('0.01');
  await page.locator('#description').fill('ค่าใช้จ่ายจำลองสำหรับทดสอบเท่านั้น');
  await page.locator('#saveButton').click();
  await page.waitForFunction(() => !document.getElementById('entryDialog').open);
  assert.ok((await page.locator('#cash').textContent()).includes(formatted(starting + 1000.03)));
  await mkdir('.wrangler/screenshots', { recursive: true });
  await page.screenshot({ path: '.wrangler/screenshots/mobile-dashboard.png', fullPage: true });
  for (const name of ['รายการ', 'บริษัท', 'หนี้']) {
    await page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
    await page.screenshot({ path: '.wrangler/screenshots/mobile-' + ({ 'รายการ': 'transactions', 'บริษัท': 'company', 'หนี้': 'debt' })[name] + '.png', fullPage: true });
  }
  const creditor = 'เจ้าหนี้ทดสอบ ' + Date.now();
  await page.getByRole('button', { name: '+ เพิ่มเจ้าหนี้' }).click();
  await page.locator('#debtName').fill(creditor);
  await page.locator('#debtOpening').fill('1000');
  await page.locator('#debtInterest').fill('100');
  await page.locator('#debtOpeningFees').fill('50');
  await page.locator('#debtOpeningReference').fill('ใบแจ้งยอดจำลองเท่านั้น');
  await page.locator('#debtDueAmount').fill('300');
  await page.locator('#debtSubmitButton').click();
  await page.waitForFunction(() => !document.getElementById('debtDialog').open);
  await page.locator('.bottom-nav').getByRole('button', { name: 'หนี้', exact: true }).click();
  const card = page.locator('.debt-item').filter({ hasText: creditor });
  assert.match(await card.textContent(), /1,150\.00/);
  await card.getByRole('button', { name: 'ชำระหนี้', exact: true }).click();
  await page.locator('#debtAmount').fill('300');
  await page.locator('#debtPaidPrincipal').fill('200');
  await page.locator('#debtPaidInterest').fill('70');
  await page.locator('#debtPaidFees').fill('30');
  await page.locator('#debtPaymentReference').fill('การชำระจำลองเท่านั้น');
  await page.locator('#debtSubmitButton').click();
  await page.waitForFunction(() => !document.getElementById('debtDialog').open);
  assert.ok((await page.locator('#cash').textContent()).includes(formatted(starting + 700.03)));
  await page.locator('.bottom-nav').getByRole('button', { name: 'หนี้', exact: true }).click();
  assert.match(await card.textContent(), /850\.00/);
  await page.screenshot({ path: '.wrangler/screenshots/mobile-debt-components.png', fullPage: true });
  await page.goto('http://127.0.0.1:8787/migration');
  await page.getByRole('button', { name: 'ตรวจยอด D1 ปัจจุบัน' }).click();
  await page.waitForFunction(() => document.getElementById('importReport').textContent.includes('balances_cents'));
  assert.equal(errors.length, 0, errors.join('\n'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:8787/');
  await page.waitForFunction(() => document.getElementById('syncStatus')?.classList.contains('hidden'));
  await page.screenshot({ path: '.wrangler/screenshots/desktop-dashboard.png', fullPage: true });
  console.log('Browser QA passed: local login, explicit account balance, synthetic expense, mobile navigation, reconciliation and desktop.');
} finally { await browser.close(); }
