let importPayload, importPlan;
const report = document.getElementById('importReport'), message = document.getElementById('importMessage');
const commit = document.getElementById('commitImport');
document.getElementById('importFile').addEventListener('change', () => { importPlan = null; importPayload = null; commit.disabled = true; });
document.getElementById('confirmImport').addEventListener('input', event => {
  commit.disabled = !(importPlan?.ok && importPlan.comparison?.ok && event.target.value.trim() === 'นำเข้า');
});
document.getElementById('previewImport').addEventListener('click', async () => {
  commit.disabled = true; importPlan = null;
  try {
    const file = document.getElementById('importFile').files[0];
    if (!file || file.size > 5 * 1024 * 1024) throw new Error('เลือกไฟล์ JSON ขนาดไม่เกิน 5 MB');
    importPayload = JSON.parse(await file.text());
    importPlan = await cloudRequest('/api/import/preview', { export: importPayload });
    report.textContent = JSON.stringify(importPlan, null, 2);
    message.textContent = importPlan.message;
    document.getElementById('confirmImport').value = '';
  } catch (error) { message.textContent = error.message; }
});
document.getElementById('checkCurrent').addEventListener('click', async () => {
  try { const response = await fetch('/api/reconcile', { cache: 'no-store' }); const data = await response.json();
    if (!response.ok) throw new Error(data.error); report.textContent = JSON.stringify(data, null, 2); }
  catch (error) { message.textContent = error.message; }
});
document.getElementById('downloadCurrent').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/export', { cache: 'no-store' });
    if (!response.ok) throw new Error('ดาวน์โหลดไม่สำเร็จ กรุณาเข้าสู่ระบบใหม่');
    const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'finance-backup.json'; link.click(); URL.revokeObjectURL(url);
  } catch (error) { message.textContent = error.message; }
});
commit.addEventListener('click', async () => {
  if (!importPlan?.ok || document.getElementById('confirmImport').value.trim() !== 'นำเข้า') return;
  commit.disabled = true;
  try {
    const result = await cloudRequest('/api/import/commit', { export: importPayload, confirm_digest: importPlan.digest,
      expected_revision: importPlan.revision }, crypto.randomUUID());
    report.textContent = JSON.stringify(result, null, 2); message.textContent = 'นำเข้าสำเร็จ'; importPlan = null;
  } catch (error) { message.textContent = error.message; }
});
