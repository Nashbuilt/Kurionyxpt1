begin;
select plan(8);
select has_table('public', 'income_records', 'income register exists');
select has_function('public', 'save_bank_income', array['bigint','bigint','text','text','date','numeric','text','text','text','text'], 'controlled income function exists');
select has_function('public', 'archive_income_record', array['bigint','text'], 'controlled archive function exists');
select col_is_pk('public', 'income_records', 'id', 'income id is the primary key');
select col_not_null('public', 'income_records', 'workspace_id', 'workspace is required');
select col_not_null('public', 'income_records', 'data_status', 'record status is required');
select policies_are('public', 'income_records', array['income_records_owner_select'], 'only owner read policy is installed');
select results_eq(
  $$select count(*)::bigint from pg_indexes where schemaname = 'public' and tablename = 'income_records' and indexdef ilike '%unique%external_transaction_id%'$$,
  array[1::bigint], 'a bank credit can only be reconciled once per workspace'
);
select * from finish();
rollback;
