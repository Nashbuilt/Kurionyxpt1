# Bank and expense reconciliation

This change links an existing Monzo payment identifier to one expense record. It does not import, move or alter money, and it does not give a workspace member banking authority.

## Income classification

Migration `20261021123420_bank_income_classification.sql` adds a separate owner-only income register. Incoming Monzo payments can be described, referenced and classified as sales revenue, investment, owner contribution, loan received, refund/rebate, interest/rewards, tax refund, asset sale, grant or other. These are operational labels only; selecting “Investment” or “Owner contribution” does not establish company ownership or legal rights.

Apply it after `20261021121542_bank_expense_reconciliation.sql`. It does not rewrite historical records. A unique workspace/transaction index prevents a bank credit being linked twice, records are archived rather than deleted, and only an authenticated workspace owner can read or mutate them through controlled functions.

## Safe deployment order

1. Back up the production database or take a Supabase point-in-time recovery checkpoint where available.
2. Review `supabase/migrations/20261021121542_bank_expense_reconciliation.sql` against the live schema.
3. Apply the migration in a disposable Supabase project and run `supabase/tests/bank_expense_reconciliation_test.sql`.
4. Confirm that existing expense row counts, amounts, categories and `external_transaction_id` values are unchanged.
5. Apply the migration to production before deploying the frontend. The new frontend reads `expenses.payment_reference` and calls `save_bank_expense`.
6. Apply `20261021123420_bank_income_classification.sql` and run `supabase/tests/bank_income_classification_test.sql` in the disposable project.
7. Deploy the frontend and refresh the installed PWA once so shell cache `kurionyx-shell-v9` replaces the previous cached files.

The migration is additive. It adds `payment_reference`, seeds active category suggestions without changing historical category text, and creates an owner-checked reconciliation function. It does not delete records or invent links for historical payments.

## Metric definitions

- **Turnover:** verified, non-archived sales revenue.
- **Recorded spend:** verified, non-archived expense records.
- **Estimated cost of goods:** units sold multiplied by the current verified landed unit cost of the linked stock item.
- **Estimated profit:** turnover less estimated cost of goods, recorded marketplace fees and operating expenses.
- **Return on spend:** estimated profit divided by that total cost basis.

Expenses already included in a stock item's landed unit cost are not subtracted a second time as operating spend. Historical profitability can still change when a stock item's current cost changes because sales do not yet store a cost snapshot; the interface labels the result as an estimate.

## Access model

All workspace members can continue to view workspace expenses under RLS. Only the workspace `owner` role can attach, change or remove a Monzo transaction link. This application role is an access-control role only and is not a statement of legal ownership or banking authority.
