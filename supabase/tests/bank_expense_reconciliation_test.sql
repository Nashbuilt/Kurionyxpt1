-- Run only against a disposable local/test Supabase database after all migrations.
begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email)
values
  ('40000000-0000-0000-0000-000000000001', 'bank-owner@example.invalid'),
  ('40000000-0000-0000-0000-000000000002', 'bank-member@example.invalid'),
  ('40000000-0000-0000-0000-000000000003', 'bank-other-owner@example.invalid');

insert into public.workspaces (name) values ('Bank expense test one'), ('Bank expense test two');
insert into public.workspace_members (workspace_id, user_id, role)
select id, '40000000-0000-0000-0000-000000000001', 'owner' from public.workspaces where name = 'Bank expense test one';
insert into public.workspace_members (workspace_id, user_id, role)
select id, '40000000-0000-0000-0000-000000000002', 'member' from public.workspaces where name = 'Bank expense test one';
insert into public.workspace_members (workspace_id, user_id, role)
select id, '40000000-0000-0000-0000-000000000003', 'owner' from public.workspaces where name = 'Bank expense test two';

set local role authenticated;
select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok(
  format(
    'select public.save_bank_expense(%s, null, ''Royal Mail labels'', ''Packaging & fulfilment'', current_date, 12.50, null, false, ''verified'', ''tx_test_one'', ''RM-ORDER-1'')',
    (select id from public.workspaces where name = 'Bank expense test one')
  ),
  'workspace owner can create an expense linked to a bank payment'
);
select is((select source_provider from public.expenses where external_transaction_id = 'tx_test_one'), 'monzo', 'linked expense records Monzo as its source');
select is((select payment_reference from public.expenses where external_transaction_id = 'tx_test_one'), 'RM-ORDER-1', 'payment reference is retained');
select throws_ok(
  format(
    'select public.save_bank_expense(%s, null, ''Duplicate'', ''Other'', current_date, 12.50, null, false, ''verified'', ''tx_test_one'', null)',
    (select id from public.workspaces where name = 'Bank expense test one')
  ),
  '23505', null, 'one bank payment cannot be linked to two expenses'
);

select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  format(
    'select public.save_bank_expense(%s, %s, ''Changed'', ''Other'', current_date, 1, null, false, ''verified'', ''tx_changed'', null)',
    (select id from public.workspaces where name = 'Bank expense test one'),
    (select id from public.expenses where external_transaction_id = 'tx_test_one')
  ),
  '42501', null, 'ordinary member cannot reconcile a bank payment'
);

select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*) from public.expenses), 0::bigint, 'other workspace cannot read the reconciled expense');

select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.save_bank_expense(
  (select id from public.workspaces where name = 'Bank expense test one'),
  (select id from public.expenses where external_transaction_id = 'tx_test_one'),
  'Royal Mail labels', 'Packaging & fulfilment', current_date, 12.50,
  null, false, 'verified', null, 'RM-ORDER-1'
);
select is((select source_provider from public.expenses where description = 'Royal Mail labels'), 'manual', 'unlinking a payment preserves the expense as a manual record');

select * from finish();
rollback;
