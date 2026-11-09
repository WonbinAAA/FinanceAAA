(function () {
  let pending;
  const money = (cents, signed=false) => (cents < 0 ? '−฿' : signed&&cents>0 ? '+฿' : '฿') + (Math.abs(cents) / 100).toLocaleString('th-TH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  window.refreshCompanyLedgerNet = function () {
    if (pending) return pending;
    const value = document.getElementById('dashboardCompanyHeld');
    const caption = document.getElementById('dashboardCompanyNetCaption');
    const card = document.querySelector('.dashboard-company-funds');
    const reserve=document.getElementById('company');
    const reserveCard=document.getElementById('companyReserveCard');
    if (!value || !card) return Promise.resolve();
    value.textContent = '—';
    if(reserve)reserve.textContent='—';
    if(caption)caption.textContent = 'กำลังอ่านสมุดบริษัท…';
    card.setAttribute('aria-busy', 'true');
    card.setAttribute('aria-label','กำลังอ่านยอดเงินบริษัท');
    pending = (async () => {
      try {
        await cloudSession();
        const response = await fetch('/api/company-ledger-summary', {credentials: 'same-origin', cache: 'no-store'});
        if (!response.ok) throw new Error('unavailable');
        const data = await response.json();
        if (data.source !== 'company-owner-ledger' || data.owner_id !== 'owner' || data.scope !== 'all-active-entries' || data.currency !== 'THB'
          || !['net_cents','income_cents','expense_cents','pending_count'].every(key => Number.isSafeInteger(data[key]))
          || data.income_cents < 0 || data.expense_cents < 0 || data.pending_count < 0
          || data.net_cents !== data.income_cents - data.expense_cents) throw new Error('invalid');
        const advanced=Math.max(0,-data.net_cents);
        value.textContent = money(data.net_cents,true);
        if(reserve)reserve.textContent=money(advanced);
        if(reserveCard)reserveCard.classList.toggle('is-reserve',advanced>0);
        if(caption)caption.textContent = data.pending_count > 0 ? `สมุดบริษัท · รออัปเดตบัญชี ${data.pending_count} รายการ` : 'ตามสมุดบริษัท · ทุกช่วงวันที่';
        card.classList.toggle('company-net-negative', data.net_cents < 0);
        card.classList.toggle('company-net-positive', data.net_cents > 0);
        card.setAttribute('aria-label',`ยอดเงินบริษัท ${money(data.net_cents,true)} เปิดสมุดบริษัท`);
        if(reserveCard)reserveCard.setAttribute('aria-label',`บริษัทค้างจ่าย ${money(advanced)}`);
        card.setAttribute('title', `รับ ${money(data.income_cents)} − จ่าย ${money(data.expense_cents)} · ทุกงานและทุกช่วงวันที่`);
      } catch {
        value.textContent = '—';
        if(reserve)reserve.textContent='—';
        if(caption)caption.textContent = 'อ่านยอดไม่สำเร็จ · กดเปิดสมุดบริษัท';
        card.classList.toggle('company-net-negative', false);
        card.classList.toggle('company-net-positive', false);
        if(reserveCard)reserveCard.classList.toggle('is-reserve',false);
        card.setAttribute('aria-label','อ่านยอดเงินบริษัทไม่สำเร็จ กดเปิดสมุดบริษัท');
        card.removeAttribute('title');
      } finally { card.setAttribute('aria-busy', 'false'); }
    })().finally(() => { pending = undefined; });
    return pending;
  };
})();
