-- Stock-linked expenses and Monzo Developer API configuration foundation.
-- Apply after 202610170002_settings_foundation.sql. This migration is additive:
-- existing expenses remain general/manual records and no bank data is imported.

begin;

select pg_advisory_xact_lock(hashtext('kurionyx:stock_linked_expenses'));

do $$
declare
  missing_objects text[] := array[]::text[];
begin
  if to_regclass('public.stock_items') is null then missing_objects := array_append(missing_objects, 'public.stock_items'); end if;
  if to_regclass('public.expenses') is null then missing_objects := array_append(missing_objects, 'public.expenses'); end if;
  if to_regclass('public.workspace_integrations') is null then missing_objects := array_append(missing_objects, 'public.workspace_integrations'); end if;
  if array_length(missing_objects, 1) is not null then
    raise exception 'Stock expense migration prerequisites are missing: %', array_to_string(missing_objects, ', ')
      using hint = 'Apply the repository migrations in order before continuing.';
  end if;
end $$;

-- A composite key ensures an expense can only link to stock in the same workspace.
create unique index if not exists stock_items_workspace_id_id_idx
  on public.stock_items (workspace_id, id);

alter table public.expenses
  add column if not exists stock_item_id bigint,
  add column if not exists include_in_landed_cost boolean not null default false,
  add column if not exists source_provider text not null default 'manual',
  add column if not exists external_transaction_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'expenses_stock_item_workspace_fk'
      and conrelid = 'public.expenses'::regclass
  ) then
    alter table public.expenses
      add constraint expenses_stock_item_workspace_fk
      foreign key (workspace_id, stock_item_id)
      references public.stock_items (workspace_id, id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'expenses_source_provider_check'
      and conrelid = 'public.expenses'::regclass
  ) then
    alter table public.expenses
      add constraint expenses_source_provider_check
      check (source_provider in ('manual', 'monzo'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'expenses_landed_cost_requires_stock_check'
      and conrelid = 'public.expenses'::regclass
  ) then
    alter table public.expenses
      add constraint expenses_landed_cost_requires_stock_check
      check (not include_in_landed_cost or stock_item_id is not null);
  end if;
end $$;

create index if not exists expenses_stock_item_date_idx
  on public.expenses (workspace_id, stock_item_id, expense_date desc)
  where stock_item_id is not null;

create unique index if not exists expenses_external_transaction_unique_idx
  on public.expenses (workspace_id, source_provider, external_transaction_id)
  where external_transaction_id is not null;

insert into public.workspace_integrations (
  workspace_id, provider_key, display_name, status, notes
)
select workspace.id, 'monzo_developer_api', 'Monzo Developer API', 'configuration_required',
       'Owner-only connection for Kurionyx bank transaction imports. No credentials or bank authority are granted by this record.'
from public.workspaces as workspace
on conflict (workspace_id, provider_key) do nothing;

-- Explicit Data API access. RLS policies already scope expenses by workspace.
revoke all on table public.expenses from anon;
revoke insert, update on table public.expenses from authenticated;
grant select on table public.expenses to authenticated;
grant insert (
  workspace_id, description, category, expense_date, amount,
  stock_item_id, include_in_landed_cost, data_status
) on table public.expenses to authenticated;

-- Browser users cannot impersonate a bank import or assign an external bank id.
-- Reviewed server-side import code may use the service role for those fields.
grant update (
  description, category, expense_date, amount,
  stock_item_id, include_in_landed_cost
) on table public.expenses to authenticated;

commit;
