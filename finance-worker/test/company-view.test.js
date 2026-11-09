import test from 'node:test';
import assert from 'node:assert/strict';
import { displayPersonalLedger } from '../src/company-view.js';

test('personal view excludes linked cash copies and old company categories before limiting latest rows', () => {
  const rows = [
    { transaction_id: 'linked', transaction_type: 'INCOME', category_id: 'IN' },
    { transaction_id: 'legacy', transaction_type: 'EXPENSE', category_id: 'OFFICE' },
    { transaction_id: 'allowance', transaction_type: 'EXPENSE', company_kind: 'SELF_ALLOWANCE' },
    { transaction_id: 'personal', transaction_type: 'EXPENSE', expense_owner: 'PERSONAL', category_id: 'EX' },
  ];
  const links = [{ transaction_id: 'linked' }];
  const categories = [{ category_id: 'OFFICE', category_group: 'OFFICE' }];
  assert.deepEqual(displayPersonalLedger(rows, links, categories, { limit: 1 }), [rows[3]]);
  assert.deepEqual(displayPersonalLedger(rows, links, categories, { source_id: 'old-company-source' }), []);
  assert.equal(rows.length, 4);
});
