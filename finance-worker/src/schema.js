export const SCHEMA = {
  'ผู้ใช้งาน': ['user_id','display_name','email','role','is_active','created_at'],
  'บัญชี': ['account_id','user_id','account_name','account_type','opening_balance','opening_date','is_active','note','include_in_available'],
  'รายการเงิน': ['transaction_id','user_id','transaction_date','transaction_type','account_id','to_account_id','category_id','amount','expense_owner','description','source_type','attachment_url','ai_status','status','created_at','updated_at','void_reason','project_name','company_kind','to_project','recipient','company_funding','company_funded_amount','company_pool_amount','recurring_id'],
  'หมวดหมู่': ['category_id','category_name','transaction_type','is_active','sort_order','category_group'],
  'หนี้สิน': ['debt_id','user_id','debt_name','debt_type','opening_balance','start_date','due_day','total_interest','status','note','due_amount','opening_principal','opening_interest','opening_fees','balance_basis','statement_reference'],
  'รายการหนี้': ['debt_transaction_id','debt_id','transaction_date','transaction_type','amount','account_id','linked_transaction_id','description','status','created_at','updated_at','principal_amount','interest_amount','fee_amount','statement_reference'],
  'แผนชำระหนี้': ['plan_id','debt_id','due_month','amount','status','created_at','updated_at','paid_at_setting'],
  'เงินสำรองบริษัท': ['claim_id','user_id','transaction_id','expense_date','description','claim_amount','returned_amount','remaining_amount','status','created_at','updated_at'],
  'รายการประจำ': ['recurring_id','user_id','recurring_name','transaction_type','amount','frequency','due_day','account_id','category_id','expense_owner','start_date','end_date','is_active','note','icon_key'],
  'ตั้งค่าระบบ': ['setting_key','setting_value','description_th','updated_at'],
  'ประวัติการแก้ไข': ['audit_id','user_id','record_type','record_id','action','field_name','old_value','new_value','change_source','reason','changed_at'],
  'จับคู่เงินคืนบริษัท': ['match_id','reimbursement_transaction_id','claim_id','amount','status','created_at','updated_at'],
  'โปรเจกต์บริษัท': ['project_id','project_name','status','created_at','closed_at','close_transaction_id'],
};
export const MONEY_FIELDS = new Set(['amount','opening_balance','total_interest','due_amount','paid_at_setting',
  'claim_amount','returned_amount','remaining_amount','company_funded_amount','company_pool_amount',
  'opening_principal','opening_interest','opening_fees','principal_amount','interest_amount','fee_amount']);

export function moneyCents(value) {
  if (value === '' || value == null) return null;
  if (!['number', 'string'].includes(typeof value) || !/^-?\d+(?:\.\d{1,2})?$/.test(String(value)))
    throw new Error('จำนวนเงินต้องเป็นตัวเลขและมีทศนิยมไม่เกิน 2 ตำแหน่ง');
  const cents = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(cents)) throw new Error('จำนวนเงินเกินขอบเขตที่รองรับ');
  return cents;
}

export function moneyColumns(row) {
  return Object.fromEntries(Object.entries(row).filter(([key, value]) => MONEY_FIELDS.has(key) && value !== '' && value != null)
    .map(([key, value]) => [key, moneyCents(value)]));
}

export function emptySnapshot() {
  return { revision: 0, tables: Object.fromEntries(Object.entries(SCHEMA)
    .map(([name, headers]) => [name, { headers: [...headers], rows: [] }])) };
}
