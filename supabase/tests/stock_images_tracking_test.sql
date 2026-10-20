-- Run only against a disposable local/test Supabase database after all migrations.
begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

select has_table('public', 'stock_images', 'stock image metadata table exists');
select has_table('public', 'shipment_tracking_events', 'shipment tracking history exists');
select has_column('public', 'shipments', 'final_mile_carrier', 'final-mile carrier is recorded');
select has_column('public', 'shipments', 'final_mile_tracking_number', 'final-mile tracking number is recorded');
select col_is_fk('public', 'stock_images', 'stock_item_id', 'stock images reference stock');
select col_is_fk('public', 'shipment_tracking_events', 'shipment_id', 'tracking events reference shipments');
select isnt_empty(
  $$select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_images' and cmd = 'SELECT'$$,
  'stock images have a read policy'
);
select is_empty(
  $$select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'shipment_tracking_events' and grantee = 'authenticated' and privilege_type = 'DELETE'$$,
  'tracking history cannot be deleted by browser clients'
);

select * from finish();
rollback;
