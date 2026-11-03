let cloudSessionPromise;
const cloudPending = new Map();
const cloudWrites = new Set(['createAccount','saveTransaction','updateTransaction','voidTransaction','confirmDraft','setAccountAvailable',
  'createCategory','updateCategory','renameCategory','setCategoryActive','moveCategory','createCompanyProject','closeCompanyProject',
  'reclassifyCompanyAdvance','setDebtMonthlyDue','adjustDebtBalance','saveDebtPlan','createDebt','renameDebt','increaseDebt','payDebt',
  'createRecurring','deactivateRecurring','payRecurring']);

async function cloudSession() {
  cloudSessionPromise ||= fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' }).then(async response => {
    if (response.status === 401) { location.assign('/login'); throw new Error('กรุณาเข้าสู่ระบบ'); }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'เข้าสู่ระบบไม่สำเร็จ');
    if (data.development) document.querySelector('.cloud-banner')?.prepend('ทดสอบในเครื่อง · ');
    return data;
  }).catch(error => { cloudSessionPromise = null; throw error; });
  return cloudSessionPromise;
}
async function cloudRequest(path, body, key) {
  const auth = await cloudSession();
  const response = await fetch(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': auth.csrf_token, ...(key ? { 'Idempotency-Key': key } : {}) },
    body: JSON.stringify(body) });
  if (response.status === 401) { location.assign('/login'); throw new Error('กรุณาเข้าสู่ระบบใหม่'); }
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'ดำเนินการไม่สำเร็จ'); error.code = data.code; error.status = response.status; error.serverResponse = true; throw error; }
  return data;
}
window.financeRpc = async function(method, args) {
  const body = { method, args }, writing = cloudWrites.has(method);
  const digest = writing ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body)))))
    .map(b => b.toString(16).padStart(2, '0')).join('') : '';
  const storageKey = 'finance-pending-' + digest;
  let key;
  if (writing) {
    try { key = sessionStorage.getItem(storageKey); } catch {}
    key ||= cloudPending.get(digest) || crypto.randomUUID();
    cloudPending.set(digest, key);
    try { sessionStorage.setItem(storageKey, key); } catch {}
  }
  try {
    let result;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { result = await cloudRequest('/api/rpc', body, key); break; }
      catch (error) { if (error.serverResponse || attempt === 1) throw error; }
    }
    if (writing) { cloudPending.delete(digest); try { sessionStorage.removeItem(storageKey); } catch {} }
    cloudNotice(result);
    return result;
  } catch (error) {
    if (error.serverResponse && error.status < 500) { cloudPending.delete(digest); try { sessionStorage.removeItem(storageKey); } catch {} }
    else if (writing) error.message = 'ยังยืนยันผลบันทึกไม่ได้ กรุณาลองคำขอเดิมอีกครั้ง ระบบจะใช้รหัสเดิมป้องกันรายการซ้ำ';
    throw error;
  }
};
function cloudNotice(data) {
  if (data.accounts) document.getElementById('cloudSetup')?.classList.toggle('hidden', data.accounts.length > 0);
  if (data.debt_review) {
    for (const id of ['cloudDebtWarning', 'cloudDebtPageWarning']) {
      const node = document.getElementById(id);
      if (node) { node.textContent = data.debt_review.message; node.classList.toggle('hidden', data.debt_review.total_debts === 0); }
    }
  }
}
function openCloudAccount() {
  document.getElementById('cloudAccountName').value = '';
  document.getElementById('cloudAccountOpening').value = '';
  document.getElementById('cloudAccountDate').value = typeof BOOT !== 'undefined' ? BOOT?.today || '' : '';
  document.getElementById('cloudAccountAvailable').checked = false;
  document.getElementById('cloudAccountDialog').showModal();
}
async function saveCloudAccount(event) {
  event.preventDefault();
  const button = document.getElementById('cloudAccountSave');
  if (button.disabled) return;
  button.disabled = true;
  try {
    const data = await window.financeRpc('createAccount', [{ account_name: document.getElementById('cloudAccountName').value,
      account_type: document.getElementById('cloudAccountType').value, opening_balance: document.getElementById('cloudAccountOpening').value,
      opening_date: document.getElementById('cloudAccountDate').value, include_in_available: document.getElementById('cloudAccountAvailable').checked }]);
    renderAll(data);
    document.getElementById('cloudAccountDialog').close();
    notify('success', 'เพิ่มบัญชีแล้ว');
  } catch (error) { fail(error); }
  finally { button.disabled = false; }
}
async function cloudLogout() {
  try { await cloudRequest('/auth/logout', {}); location.assign('/login'); }
  catch (error) { window.alert(error.message); }
}
