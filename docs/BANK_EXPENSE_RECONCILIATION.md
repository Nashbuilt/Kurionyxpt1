# Bank and expense reconciliation

This change links an existing Monzo payment identifier to one expense record. It does not import, move or alter money, and it does not give a workspace member banking authority.

## Safe deployment order

1. Back up the production database or take a Supabase point-in-time recovery checkpoint where available.
2. Review `supabase/migrations/20261021121542_bank_expense_reconciliation.sql` against the live schema.
3. Apply the migration in a disposable Supabase project and run `supabase/tests/bank_expense_reconciliation_test.sql`.
4. Confirm that existing expense row counts, amounts, categories and `external_transaction_id` values are unchanged.
5. Apply the migration to production before deploying the frontend. The new frontend reads `expenses.payment_reference` and calls `save_bank_expense`.
6. Deploy the frontend and refresh the installed PWA once so shell cache `kurionyx-shell-v8` replaces the previous cached files.

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
