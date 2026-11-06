export function isCompanyCategory(category) {
  const name = String(category?.category_name || '').normalize('NFKC').replace(/\s+/gu, '');
  return String(category?.category_group || '').toUpperCase() === 'OFFICE'
    || name === 'เงินคืนบริษัท' || name === 'ติดตั้งเครื่องงานศาล3260';
}

export function isCompanyRecord(record, category) {
  return record?.expense_owner === 'COMPANY' || Boolean(record?.company_kind || record?.company_funding || record?.project_name)
    || isCompanyCategory(category || record);
}
