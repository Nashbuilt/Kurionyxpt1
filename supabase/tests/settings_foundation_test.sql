-- Run only against a disposable local/test Supabase database after all migrations.
begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email)
values
  ('20000000-0000-0000-0000-000000000001', 'settings-owner@example.invalid'),
  ('20000000-0000-0000-0000-000000000002', 'settings-member@example.invalid'),
  ('20000000-0000-0000-0000-000000000003', 'settings-outsider@example.invalid');

insert into public.workspaces (name) values ('Settings test one'), ('Settings test two');
insert into public.workspace_members (workspace_id, user_id, role)
select id, '20000000-0000-0000-0000-000000000001', 'owner' from public.workspaces where name = 'Settings test one';
insert into public.workspace_members (workspace_id, user_id, role)
select id, '20000000-0000-0000-0000-000000000002', 'member' from public.workspaces where name = 'Settings test one';
insert into public.workspace_members (workspace_id, user_id, role)
select id, '20000000-0000-0000-0000-000000000003', 'owner' from public.workspaces where name = 'Settings test two';

-- Create legacy free-text records before adding configuration records.
insert into public.stock_items (workspace_id, product_name, category, sku, units, unit_cost, data_status)
select id, 'Legacy product', 'Legacy free-text product category', 'SETTINGS-LEGACY', 0, 1, 'unverified'
from public.workspaces where name = 'Settings test one';
insert into public.expenses (workspace_id, description, category, amount, data_status)
select id, 'Legacy expense', 'Legacy free-text expense category', 5, 'unverified'
from public.workspaces where name = 'Settings test one';

set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

insert into public.workspace_profiles (workspace_id, display_name, business_status)
select id, 'Kurionyx test', 'pre_incorporation' from public.workspaces where name = 'Settings test one';
select is((select display_name from public.workspace_profiles), 'Kurionyx test', 'owner can create the workspace profile');

insert into public.suppliers (workspace_id, name, sourcing_platform)
select id, 'Supplier One', 'Alibaba' from public.workspaces where name = 'Settings test one';
select is((select count(*) from public.suppliers), 1::bigint, 'owner can create a supplier');

update public.suppliers set contact_name = 'Contact' where name = 'Supplier One';
select is((select contact_name from public.suppliers where name = 'Supplier One'), 'Contact', 'owner can update a supplier');

select throws_ok(
  $$insert into public.suppliers (workspace_id, name)
    select id, 'supplier one' from public.workspaces where name = 'Settings test one'$$,
  '23505', null, 'duplicate active supplier names are rejected case-insensitively'
);

update public.suppliers set archived_at = now() where name = 'Supplier One';
select ok((select archived_at is not null from public.suppliers where name = 'Supplier One'), 'supplier can be archived');

insert into public.suppliers (workspace_id, name)
select id, 'Supplier One' from public.workspaces where name = 'Settings test one';
select is((select count(*) from public.suppliers where lower(name) = 'supplier one'), 2::bigint, 'archived name can be reused without deletion');

insert into public.product_categories (workspace_id, name)
select id, 'Clothing' from public.workspaces where name = 'Settings test one';
select is((select count(*) from public.product_categories), 1::bigint, 'owner can create a product category');

select is((select category from public.stock_items where sku = 'SETTINGS-LEGACY'), 'Legacy free-text product category', 'legacy stock category remains unchanged');
select is((select category from public.expenses where description = 'Legacy expense'), 'Legacy free-text expense category', 'legacy expense category remains unchanged');

select is((select count(*) from public.list_workspace_members((select id from public.workspaces where name = 'Settings test one'))), 2::bigint, 'workspace member list is scoped to the requested workspace');

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.suppliers), 2::bigint, 'ordinary member can read workspace suppliers');
select throws_ok(
  $$insert into public.suppliers (workspace_id, name)
    select id, 'Member write attempt' from public.workspaces where name = 'Settings test one'$$,
  '42501', null, 'ordinary member cannot create settings records'
);
update public.workspace_profiles set display_name = 'Unauthorised';
select is((select display_name from public.workspace_profiles), 'Kurionyx test', 'ordinary member cannot change the profile');
select throws_ok(
  $$delete from public.suppliers where name = 'Supplier One'$$,
  '42501', null, 'settings records cannot be deleted by browser users'
);

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*) from public.suppliers), 0::bigint, 'other workspace cannot read first workspace suppliers');
update public.suppliers set contact_name = 'Cross workspace' where name = 'Supplier One';
reset role;
select is((select count(*) from public.suppliers where contact_name = 'Cross workspace'), 0::bigint, 'other workspace cannot change first workspace suppliers');

select * from finish();
rollback;
