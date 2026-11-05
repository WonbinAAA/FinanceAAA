# Company ledger connection

The Finance dashboard's **ยอดเงินบริษัท** card reads the company owner's entire active book through the `COMPANY_LEDGER` service binding and `/finance/api/summary`: income minus expenses, in integer satang. This includes the book's self allowances and personally funded expenses, exactly as its unfiltered totals do. A positive net displays a plus sign and green text; a deficit displays red text. **สำรองจ่าย** displays `max(0, -net_cents)`, with a red title and amount only when positive. These are display rules, separate from reserved project/pool funds, reimbursement claims, bank balances and available cash; none of those accounting values are changed by this display. The browser loads the summary independently after the dashboard, so a company read failure shows unavailable amounts for both cards rather than wallet funds or a false zero, and cannot block the bank balance display.

The company app remains the place to create, edit, trash and restore linked company entries. Its existing report fields, PDF/Excel renderer and templates are unchanged. Finance shows the resulting bank and available-cash totals using the existing accounting engine. Company expenses that already affect a bank transaction must never be subtracted again merely to match the book's net. Review source links and target records before voiding a genuine duplicate; an unlinked historical company record is not automatically a duplicate.

New entries in the Finance form default to the active account named **กรุงไทย** when present; editing preserves the original account. The form offers personal expense, income and transfer. Historical company records remain available, and linked edits continue through the company app.

## Deployment order

1. Deploy Finance, including migration `0002_company_link.sql` and the named `CompanyFinance` RPC entrypoint.
2. Deploy the company Worker with its `FINANCE` service binding and `0007_finance_link.sql` migration.
3. Back up both applications privately. Review every active owner-company record, including aliases, dates and combined payments. Rehearse the complete baseline against a disposable database and compare all balances.
4. Submit the reviewed baseline through the company owner's authenticated API. Current source fields, revisions, every target hash and the Finance revision must still match. The operation retains all transaction IDs and records date corrections through the existing audited transaction API. Only that atomic operation enables synchronization.

No IDs, names, monetary history, private backup, initial mapping plan or credentials belong in this repository. Other company accounts are excluded; the bridge accepts only the fixed `owner` scope. An incomplete mapping does not enable synchronization.

## Recording money

New entries require a real bank account and an explicit money type. Expenses distinguish personal funding, project advances and the company pool. Incoming money distinguishes advances from manually selected reimbursement claims. Any surplus into the pool and any personal shortfall require explicit confirmation. Self allowances retain the existing noncash ownership-transfer rule; a self allowance with insufficient company funds is rejected.

Old unassigned funding can remain as historical data. Once a funding source has been specified it cannot be cleared to evade validation. A combined historical payment stays a single bank transaction; its source entries share the same financial configuration and date. Changing those independently requires a reviewed split, rather than silently duplicating the payment.

## Delivery and recovery

The company entry, audit, mutation receipt and outbox payload are committed in the same D1 transaction. An internal RPC sends the complete source state to Finance. Finance atomically commits its ledger/audit, source version, target hash and idempotency receipt behind the existing revision guard. Replays cannot move cash again. These are two databases, so delivery is not a single transaction across both databases: the company UI reports pending updates until acknowledged. Retry is available in the UI and runs on the company Worker's five-minute scheduled handler.

Newer unsent source versions supersede older pending versions without deleting outbox history. Unexpected target edits, stale versions, changed funding and conflicting reimbursements stop delivery for review. Finance rejects direct edits/VOID of linked transactions. A full delete keeps the bank transaction as VOID; restoring creates one replacement active transaction and retains the original VOID history.

Both backups include connection state. Finance's old generic import is refused while synchronization is enabled, because restoring the ledger alone would lose source/version relationships. Recovery must reconcile the ledger and connection state together.

The bridge uses a [named Cloudflare service binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/). It has no public HTTP command endpoint and exposes no company password or deployment token in browser code.
