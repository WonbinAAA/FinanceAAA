// Manual statement accounting only. No APR, accrual, assumed allocation or future interest.
import { moneyCents } from './schema.js';

const keys = ['principal_amount','interest_amount','fee_amount'];
const complete = row => keys.every(key => row[key] !== '' && row[key] != null);
function parts(row) {
  const values = keys.map(key => {
    const value = moneyCents(row[key]);
    if (value == null || value < 0) throw new Error('กรอกเงินต้น ดอกเบี้ย และค่าธรรมเนียมแยกให้ครบ (ไม่มีให้กรอก 0)');
    return value;
  });
  return { principal: values[0], interest: values[1], fees: values[2] };
}
const total = value => {
  const amount = value.principal + value.interest + value.fees;
  if (!Number.isSafeInteger(amount)) throw new Error('ยอดหนี้รวมเกินขอบเขตที่รองรับ');
  return amount;
};
const ordered = (debt, items) => items.filter(row => row.debt_id === debt.debt_id && row.status === 'ACTIVE')
  .sort((a,b) => String(a.transaction_date).localeCompare(String(b.transaction_date)) || a._row - b._row);

export function debtState(debt, items) {
  let verified = debt.balance_basis === 'TOTAL_COMPONENTS_CONFIRMED';
  let value = verified ? { principal: moneyCents(debt.opening_principal), interest: moneyCents(debt.opening_interest), fees: moneyCents(debt.opening_fees) }
    : { principal: 0, interest: 0, fees: 0 };
  let legacy = moneyCents(debt.opening_balance) || 0;
  if (verified && (Object.values(value).some(v => v == null || v < 0) || total(value) !== legacy)) throw new Error('ส่วนประกอบยอดหนี้เริ่มต้นไม่ตรงกับยอดรวม');
  let statementDate = debt.start_date || '', interestPaid = 0, feesPaid = 0;
  for (const row of ordered(debt, items)) {
    const type = row.transaction_type, n = moneyCents(row.amount) || 0;
    if (type === 'STATEMENT') {
      value = parts(row);
      if (total(value) !== n) throw new Error('ส่วนประกอบใบแจ้งยอดไม่ตรงกับยอดรวม');
      legacy = total(value); verified = true; statementDate = row.transaction_date; continue;
    }
    const direction = ['INCREASE','ADJUST_UP'].includes(type) ? 1 : ['PAYMENT','ADJUST_DOWN'].includes(type) ? -1 : 0;
    legacy += direction * n;
    if (direction) {
      if (!complete(row)) verified = false;
      else {
        const split = parts(row);
        if (total(split) !== n) throw new Error('ส่วนประกอบรายการหนี้ไม่ตรงกับยอดรวม');
        for (const key of ['principal','interest','fees']) value[key] += direction * split[key];
        if (verified && Object.values(value).some(v => v < 0)) throw new Error('ส่วนประกอบหนี้ติดลบ กรุณาตรวจใบแจ้งยอด');
        if (type === 'PAYMENT') { interestPaid += split.interest; feesPaid += split.fees; }
      }
    }
  }
  return { balance: Math.max(0, verified ? total(value) : legacy) / 100,
    balance_breakdown: verified ? { principal: value.principal / 100, interest: value.interest / 100, fees: value.fees / 100 } : null,
    balance_components_recorded: verified, statement_date: statementDate,
    recorded_interest_paid: interestPaid / 100, recorded_fees_paid: feesPaid / 100 };
}

export function createDebtOperations(h) {
  const { SH, rows, append, ensure, audit, now, today, date, id, validateTx, newTx, category, mutate, lock } = h;
  const ensureFields = (table, fields) => fields.forEach(key => ensure(table, key, key));
  const find = debtId => {
    const debt = rows(SH.DEBTS).find(row => row.debt_id === debtId && row.status !== 'VOID');
    if (!debt) throw new Error('ไม่พบเจ้าหนี้'); return debt;
  };
  const reference = input => {
    const value = String(input.statement_reference || '').trim();
    if (!value || value.length > 160) throw new Error('ระบุอ้างอิงใบแจ้งยอดหรือแหล่งยอดจริง 1–160 ตัวอักษร');
    return value;
  };
  const chronology = (debt, inputDate) => {
    const latest = [debt.start_date, ...ordered(debt, rows(SH.DEBT_TX)).map(row => row.transaction_date)].filter(Boolean).sort().at(-1);
    if (inputDate < latest) throw new Error('วันที่อยู่ก่อนรายการหนี้ล่าสุด ต้องตรวจประวัติก่อนปรับย้อนหลัง');
  };
  const add = (debt, type, split, input, linked = '') => {
    ensureFields(SH.DEBT_TX, [...keys,'statement_reference']);
    const item = { debt_transaction_id: id('DTX'), debt_id: debt.debt_id, transaction_date: date(input.transaction_date),
      transaction_type: type, amount: total(split) / 100, principal_amount: split.principal / 100,
      interest_amount: split.interest / 100, fee_amount: split.fees / 100,
      account_id: linked ? input.account_id : '', linked_transaction_id: linked,
      statement_reference: input.statement_reference || '', description: String(input.description || input.reason || ''),
      status: 'ACTIVE', created_at: now(), updated_at: now() };
    append(SH.DEBT_TX, item);
    audit('DEBT_TRANSACTION', item.debt_transaction_id, 'CREATE', '', '', JSON.stringify(item), input.reason || 'แยกยอดตามใบแจ้งยอด');
    return item;
  };
  return {
    createDebt: input => lock(() => {
      const split = parts(input), amount = total(split), name = String(input.debt_name || '').trim(), day = Number(input.due_day);
      if (!name || name.length > 100) throw new Error('ระบุชื่อเจ้าหนี้ 1–100 ตัวอักษร');
      if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error('วันครบกำหนดต้องอยู่ระหว่าง 1–31');
      const due = moneyCents(input.due_amount);
      if (due == null || due < 0 || due > amount) throw new Error('ยอดเดือนนี้ต้องไม่เกินหนี้รวมคงเหลือ');
      const ref = reference(input);
      ensureFields(SH.DEBTS, ['opening_principal','opening_interest','opening_fees','balance_basis','statement_reference','due_amount']);
      const debt = { debt_id: id('DEB'), user_id: 'USR001', debt_name: name, debt_type: String(input.debt_type || 'OTHER'),
        opening_balance: amount / 100, opening_principal: split.principal / 100, opening_interest: split.interest / 100, opening_fees: split.fees / 100,
        balance_basis: 'TOTAL_COMPONENTS_CONFIRMED', statement_reference: ref, start_date: date(input.start_date),
        due_day: day, total_interest: '', status: 'ACTIVE', note: String(input.note || ''), due_amount: 0 };
      append(SH.DEBTS, debt); audit('DEBT', debt.debt_id, 'CREATE', '', '', JSON.stringify(debt), 'เจ้าของระบุยอดค้างทั้งสามส่วน');
      if (due > 0) h.setMonthlyDue({ debt_id: debt.debt_id, due_month: today().slice(0,7), amount: due / 100 });
      return mutate({ id: debt.debt_id });
    }),
    payDebt: input => lock(() => {
      const debt = find(input.debt_id), state = debtState(debt, rows(SH.DEBT_TX)), split = parts(input);
      if (!state.balance_components_recorded) throw new Error('หนี้เดิมยังไม่ทราบส่วนประกอบ กรุณายืนยันยอดค้างจากใบแจ้งยอดก่อนชำระ');
      const amount = moneyCents(input.amount);
      if (!(amount > 0) || amount !== total(split)) throw new Error('ยอดเงินที่จ่ายต้องเท่ากับเงินต้น + ดอกเบี้ย + ค่าธรรมเนียม');
      const current = state.balance_breakdown;
      if (split.principal > moneyCents(current.principal) || split.interest > moneyCents(current.interest) || split.fees > moneyCents(current.fees))
        throw new Error('ส่วนที่ชำระเกินยอดค้างส่วนนั้น กรุณาอัปเดตใบแจ้งยอดก่อน');
      const transactionDate = date(input.transaction_date); chronology(debt, transactionDate);
      const ref = reference(input);
      const tx = newTx(validateTx({ transaction_type: 'EXPENSE', transaction_date: transactionDate, amount: amount / 100,
        account_id: input.account_id, category_id: category(), expense_owner: 'PERSONAL',
        description: 'ชำระหนี้ ' + debt.debt_name, source_type: 'WEB', status: 'ACTIVE' }));
      append(SH.TX, tx);
      add(debt, 'PAYMENT', split, { ...input, statement_reference: ref }, tx.transaction_id);
      audit('TRANSACTION', tx.transaction_id, 'CREATE', '', '', JSON.stringify(tx), 'จ่ายจริงครั้งเดียว แยกส่วนประกอบในรายการหนี้');
      return mutate({ id: tx.transaction_id });
    }),
    increaseDebt: input => lock(() => {
      const debt = find(input.debt_id), amount = moneyCents(input.amount);
      if (!(amount > 0)) throw new Error('ยอดเพิ่มเงินต้นต้องมากกว่า 0');
      chronology(debt, date(input.transaction_date));
      add(debt, 'INCREASE', { principal: amount, interest: 0, fees: 0 }, input);
      return mutate();
    }),
    adjustDebtBalance: input => lock(() => {
      const debt = find(input.debt_id), split = parts(input), ref = reference(input), day = date(input.transaction_date);
      if (!String(input.reason || '').trim()) throw new Error('กรุณาระบุเหตุผลการยืนยันยอด');
      chronology(debt, day);
      add(debt, 'STATEMENT', split, { ...input, statement_reference: ref });
      return mutate();
    }),
  };
}
