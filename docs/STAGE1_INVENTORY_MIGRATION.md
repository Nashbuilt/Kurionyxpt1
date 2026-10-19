# Stage 1 inventory integrity migration

This change is prepared for review only. It has not been applied to Supabase or deployed to Vercel.

## Design decisions

- Existing `stock_items.units` values are preserved exactly.
- Every positive balance at migration time receives one `opening_balance` movement marked `unverified`. This is a migration snapshot, not an invented supplier receipt.
- Existing stock, sales, expenses and shipments default to `unverified`. No historical record is automatically treated as genuine business data.
- New stock quantities change only through inventory movements.
- New sales keep the existing atomic decrement contract, but the decrement is now performed by their linked `sale` movement. The previous direct decrement is replaced, not retained, preventing a double-decrement.
- Stock and movement history is append-only for browser users. Zero-balance stock can be archived with a reason instead of deleted.
- Confirmed dashboard KPIs include only records explicitly marked `verified`.

## Required pre-deployment checks

1. Take a Supabase backup or confirm Point-in-Time Recovery availability.
2. In a read-only SQL session, verify that the expected tables and columns from `schema.sql` and `inventory_expansion.sql` exist.
3. Record row counts and quantity totals for `stock_items`, `stock_sales`, `expenses` and `shipments`.
4. Review all existing records. In particular, do not classify the Chromecast demonstration stock as verified. Confirm Nike Dri-FIT quantities and costs from source evidence before marking them verified.
5. Apply the migration to a disposable Supabase branch/local environment first.
6. Run `supabase/tests/stage1_inventory_ledger_test.sql` there.
7. Verify that every pre-existing positive stock balance has exactly one unverified `opening_balance` movement and that stock totals are unchanged.
8. Deploy the database migration before deploying the updated static frontend. The frontend expects the new columns, table and RPC functions.

## Suggested verification queries

These are read-only and should be reviewed before use against production.

```sql
select count(*) as stock_rows, coalesce(sum(units), 0) as total_units
from public.stock_items;

select data_status, count(*) as rows, coalesce(sum(units), 0) as units
from public.stock_items
group by data_status
order by data_status;

select count(*) as opening_rows, coalesce(sum(quantity_delta), 0) as opening_units
from public.inventory_movements
where movement_type = 'opening_balance';

select item.id, item.sku, item.units,
       coalesce(sum(movement.quantity_delta), 0) as movement_balance
from public.stock_items as item
left join public.inventory_movements as movement on movement.stock_item_id = item.id
group by item.id, item.sku, item.units
having item.units <> coalesce(sum(movement.quantity_delta), 0);
```

The final query must return no rows immediately after migration.

## Recovery and rollback guidance

The migration is wrapped in one transaction. If a statement fails while applying it, PostgreSQL rolls the whole migration back.

After users have created Stage 1 movements, do **not** run an automated down migration: dropping the ledger would destroy new audit history. Recovery options are:

1. pause writes;
2. preserve/export new `inventory_movements` and sales created after migration;
3. fix forward with a reviewed corrective migration; or
4. restore the pre-migration database backup and deliberately replay validated post-migration transactions.

The static frontend can be rolled back independently to its previous Git commit only if the database compatibility has been reviewed. The additive columns do not break the old reads, but the old frontend tries to insert stock directly and will be blocked by the new permissions.

## Safe production order

1. Announce a brief maintenance window and pause toolkit writes.
2. Capture pre-migration counts and totals.
3. Take/verify backup.
4. Apply the migration once.
5. Run verification queries and tests.
6. Deploy the updated frontend.
7. Sign in with a non-production test item and verify receipt, adjustment and sale behaviour.
8. Review and classify real records manually.

