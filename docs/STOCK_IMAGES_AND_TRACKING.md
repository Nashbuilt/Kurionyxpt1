# Stock images and shipment tracking

This feature is additive. It does not alter existing inventory quantities, sales, movements, shipment status, or historical tracking numbers.

## Safe release order

1. Back up the production database and review the migration.
2. Apply `supabase/migrations/20261020164207_stock_images_tracking_timeline.sql` to a disposable Supabase project first.
3. Run `supabase/tests/stock_images_tracking_test.sql` there together with the existing SQL suites.
4. Confirm that the private `stock-images` bucket and its workspace-scoped RLS policies exist.
5. Apply the migration to production.
6. Deploy the frontend only after the database migration succeeds. The new frontend queries the new tables at startup.
7. Test one small image upload and one manual tracking update from both team accounts.

## What works now

- Up to four private JPG, PNG, or WebP photos (maximum 5 MB each) can be added to a stock item.
- Photo metadata and files are isolated by workspace; browser clients receive one-hour signed image URLs.
- Shipments can retain an international carrier/tracking number and a separate final-mile carrier/tracking number.
- Manual, append-only tracking events appear as an in-app timeline.
- Tracking history cannot be deleted by browser users.

## Automatic carrier updates

Automatic universal tracking is not enabled. It requires a server-side provider integration such as 17TRACK, provider approval, an API token stored as a Supabase Edge Function secret, registration of each tracking number, and a verified webhook. The browser must never receive the provider token.

When that account is available, add an Edge Function that verifies the provider webhook, resolves the shipment inside its workspace, and inserts events with `source = '17track'`. Use an idempotency key or a unique provider-event identifier before enabling retries. Royal Mail may be the final-mile carrier even when the original Chinese courier uses a different tracking number, which is why both references are stored.

## Recovery

Do not roll back by dropping the tables after users have uploaded photos or added tracking events. If the frontend must be rolled back, redeploy the previous frontend and leave the additive tables in place. The existing records and stock balances remain compatible.
