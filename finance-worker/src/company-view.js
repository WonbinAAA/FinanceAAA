import { AppError } from './errors.js';
import { isCompanyCategory, isCompanyRecord } from './company-policy.js';

// The accounting copies still feed balances and audit history, but never appear as personal rows.
export function displayPersonalLedger(rows, links, categories, filters = {}) {
  if (filters.limit !== undefined && (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 50)) {
    throw new AppError('จำนวนรายการไม่ถูกต้อง');
  }
  if (filters.source_id) return [];
  const linkedTargets = new Set(links.map(link => link.transaction_id));
  const companyCategories = new Set(categories.filter(isCompanyCategory).map(category => category.category_id));
  const personal = rows.filter(row => !linkedTargets.has(row.transaction_id) && !companyCategories.has(row.category_id) && !isCompanyRecord(row));
  return filters.limit === undefined ? personal : personal.slice(0, filters.limit);
}
