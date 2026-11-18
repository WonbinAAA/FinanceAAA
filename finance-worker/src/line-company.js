export const companyDirections = { expense: 'เงินจ่าย', income: 'รับเงินบริษัท' };
export const companyFunding = {
  EXPENSE: 'ค่าใช้จ่ายบริษัท',
  OTHER_ALLOWANCE: 'จ่ายเบี้ยเลี้ยงให้คนอื่น',
  SELF_ALLOWANCE: 'เบี้ยเลี้ยงตัวเอง',
};

export const isSelfAllowance = entry => entry.direction === 'expense' && entry.fundingKind === 'SELF_ALLOWANCE';
export const companyAccountLabel = direction => direction === 'income' ? 'บัญชีที่รับเงินจริง'
  : direction === 'expense' ? 'บัญชีที่จ่ายเงินจริง' : 'บัญชีเงินจริง';

export function companyItemFields({ direction, item }, refs = []) {
  if (direction !== 'expense' || !item) return { vehicle: false, person: false, lodging: false };
  const template = refs.find(ref => ref.kind === 'item' && ref.name === item && ref.direction === direction);
  const vehicle = Boolean(template?.vehicle_required)
    || /น้ำมัน|ดีเซล|เบนซิน|แก๊สรถ|ก๊าซรถ|^แก๊ส$|^ก๊าซ$/u.test(item);
  const person = /^เบี้ยเลี้ยง/u.test(item);
  return { vehicle, person, lodging: !vehicle && !person && /^(?:ค่า)?(?:ที่พัก|โรงแรม)/u.test(item) };
}

export function companyFormFields(entry, applicable = companyItemFields(entry)) {
  return [
    ['direction', 'รับ–จ่าย'], ['cents', 'จำนวนเงิน'], ['date', 'วันที่รายการ'], ['item', 'รายการ'],
    ...(applicable.vehicle ? [['vehicle', 'ทะเบียนรถ']] : []),
    ...(applicable.person ? [['person', 'ผู้รับเบี้ยเลี้ยง']] : []),
    ...(applicable.lodging ? [['lodging', 'ชื่อที่พัก']] : []),
    ['project', 'งาน / โครงการ'],
    ...(entry.direction === 'expense' ? [['fundingKind', 'ประเภทเงิน']] : []),
    ...(!isSelfAllowance(entry) ? [['account', companyAccountLabel(entry.direction)]] : []),
    ['note', 'หมายเหตุ'],
  ];
}

export function companyMissingField(entry, applicable = companyItemFields(entry)) {
  if (entry.direction === 'expense' && entry.fundingKind && !Object.hasOwn(companyFunding, entry.fundingKind)) return 'fundingKind';
  return companyFormFields(entry, applicable).find(([key]) => !['project', 'note', 'lodging'].includes(key) && !entry[key])?.[0];
}

export function cleanCompanyItemFields(entry, applicable) {
  for (const key of ['vehicle', 'person', 'lodging']) {
    if (!applicable[key]) delete entry[key];
  }
}
