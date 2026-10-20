-- Run only against a disposable local/test Supabase database after migrations.
begin;

create extension if not exists pgtap with schema extensions;
select plan(23);

insert into auth.users (id, email)
values
  ('10000000-0000-0000-0000-000000000001', 'stage1-one@example.invalid'),
  ('10000000-0000-0000-0000-000000000002', 'stage1-two@example.invalid');

insert into public.workspaces (name)
values ('Stage 1 test one'), ('Stage 1 test two');

insert into public.workspace_members (workspace_id, user_id, role)
select id, '10000000-0000-0000-0000-000000000001', 'owner'
from public.workspaces where name = 'Stage 1 test one';
insert into public.workspace_members (workspace_id, user_id, role)
select id, '10000000-0000-0000-0000-000000000002', 'owner'
from public.workspaces where name = 'Stage 1 test two';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select public.create_stock_item(
  (select id from public.workspaces where name = 'Stage 1 test one'),
  'Test item', 'Tests', 'STAGE1-ONE', 10, 2.50, 0, 0, '', 'verified'
);

select is((select units from public.stock_items where sku = 'STAGE1-ONE'), 10::bigint, 'initial receipt sets stock to ten');
select is((select count(*) from public.inventory_movements where movement_type = 'receipt'), 1::bigint, 'initial receipt creates one movement');
select is((select data_status from public.stock_items where sku = 'STAGE1-ONE'), 'verified', 'classification is retained');

insert into public.stock_sales (workspace_id, stock_item_id, units, unit_sale_price, marketplace, data_status)
select workspace_id, id, 3, 9.99, 'Direct', 'verified'
from public.stock_items where sku = 'STAGE1-ONE';

select is((select units from public.stock_items where sku = 'STAGE1-ONE'), 7::bigint, 'sale decrements stock once');
select is((select count(*) from public.inventory_movements where movement_type = 'sale'), 1::bigint, 'sale creates exactly one movement');
select is((select quantity_delta from public.inventory_movements where movement_type = 'sale'), (-3)::bigint, 'sale movement is negative');

select throws_ok(
  $$insert into public.stock_sales (workspace_id, stock_item_id, units, unit_sale_price, marketplace)
    select workspace_id, id, 100, 1, 'Direct' from public.stock_items where sku = 'STAGE1-ONE'$$,
  '23514', null, 'overselling is rejected'
);
select is((select units from public.stock_items where sku = 'STAGE1-ONE'), 7::bigint, 'rejected sale leaves stock unchanged');

select public.void_stock_sale(
  (select id from public.stock_sales where stock_item_id = (select id from public.stock_items where sku = 'STAGE1-ONE')),
  'Duplicate test sale'
);
select is((select units from public.stock_items where sku = 'STAGE1-ONE'), 10::bigint, 'voiding a sale restores its stock once');
select ok((select archived_at is not null from public.stock_sales limit 1), 'voided sale is archived rather than deleted');
select is((select count(*) from public.inventory_movements where source_type = 'stock_sale_void'), 1::bigint, 'void creates one compensating movement');
select throws_ok(
  $$select public.void_stock_sale((select id from public.stock_sales limit 1), 'Second void attempt')$$,
  '42501', null, 'a sale cannot be voided twice'
);

select public.create_stock_item(
  (select id from public.workspaces where name = 'Stage 1 test one'),
  'Archived sale item', 'Tests', 'STAGE1-ARCHIVED', 8, 3.00, 0, 0, '', 'verified'
);
insert into public.stock_sales (workspace_id, stock_item_id, units, unit_sale_price, marketplace, data_status)
select workspace_id, id, 3, 8.00, 'Direct', 'verified'
from public.stock_items where sku = 'STAGE1-ARCHIVED';
select public.archive_stock_item(
  (select id from public.stock_items where sku = 'STAGE1-ARCHIVED'),
  'No longer stocked'
);
select ok(
  (select archived_at is not null from public.stock_items where sku = 'STAGE1-ARCHIVED'),
  'stock linked to a sale can be archived'
);
select is(
  (select units from public.stock_items where sku = 'STAGE1-ARCHIVED'),
  0::bigint,
  'archiving closes the remaining active balance'
);
select public.void_stock_sale(
  (select id from public.stock_sales where stock_item_id = (select id from public.stock_items where sku = 'STAGE1-ARCHIVED')),
  'Sale entered by mistake'
);
select ok(
  (select archived_at is null from public.stock_items where sku = 'STAGE1-ARCHIVED'),
  'voiding the sale reactivates its archived stock item'
);
select is(
  (select units from public.stock_items where sku = 'STAGE1-ARCHIVED'),
  3::bigint,
  'voiding restores only the sold units after the prior archive adjustment'
);
select is(
  (select count(*) from public.inventory_movements
   where source_type = 'stock_sale_void'
     and stock_item_id = (select id from public.stock_items where sku = 'STAGE1-ARCHIVED')),
  1::bigint,
  'archived-stock sale void creates one compensating movement'
);

select public.record_inventory_movement(
  (select id from public.stock_items where sku = 'STAGE1-ONE'),
  'adjustment', -2, 'Count correction', 'verified'
);
select is((select units from public.stock_items where sku = 'STAGE1-ONE'), 8::bigint, 'reasoned adjustment changes stock');

select throws_ok(
  $$select public.record_inventory_movement(
    (select id from public.stock_items where sku = 'STAGE1-ONE'),
    'adjustment', 1, '', 'verified')$$,
  '23514', null, 'empty adjustment reason is rejected'
);

reset role;
insert into public.stock_items (workspace_id, product_name, category, sku, units, unit_cost, data_status)
select id, 'Other workspace item', 'Tests', 'STAGE1-TWO', 0, 1, 'verified'
from public.workspaces where name = 'Stage 1 test two';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok(
  $$select public.record_inventory_movement(
    (select id from public.stock_items where sku = 'STAGE1-TWO'),
    'receipt', 1, 'Wrong workspace attempt', 'verified')$$,
  '42501', null, 'cross-workspace movement is rejected'
);
select is((select count(*) from public.inventory_movements), 4::bigint, 'RLS exposes only the current workspace movements');

select throws_ok(
  $$update public.stock_items set units = 99 where sku = 'STAGE1-ONE'$$,
  '42501', null, 'direct quantity update is denied'
);
select throws_ok(
  $$delete from public.stock_items where sku = 'STAGE1-ONE'$$,
  '42501', null, 'direct stock deletion is denied'
);

select * from finish();
rollback;
