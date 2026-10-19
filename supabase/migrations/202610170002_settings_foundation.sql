-- Settings foundation for Kurionyx.
-- Apply only after 202610170001_stage1_inventory_integrity.sql.
-- This migration is additive: it does not rewrite legacy category, marketplace,
-- expense or stock data and it does not delete existing records.

begin;

select pg_advisory_xact_lock(hashtext('kurionyx:settings_foundation'));

do $$
declare
  missing_objects text[] := array[]::text[];
begin
  if to_regclass('public.workspaces') is null then missing_objects := array_append(missing_objects, 'public.workspaces'); end if;
  if to_regclass('public.workspace_members') is null then missing_objects := array_append(missing_objects, 'public.workspace_members'); end if;
  if to_regclass('public.stock_items') is null then missing_objects := array_append(missing_objects, 'public.stock_items'); end if;
  if to_regclass('public.stock_sales') is null then missing_objects := array_append(missing_objects, 'public.stock_sales'); end if;
  if to_regclass('public.expenses') is null then missing_objects := array_append(missing_objects, 'public.expenses'); end if;
  if to_regclass('public.inventory_movements') is null then missing_objects := array_append(missing_objects, 'public.inventory_movements'); end if;

  if array_length(missing_objects, 1) is not null then
    raise exception 'Settings migration prerequisites are missing: %', array_to_string(missing_objects, ', ')
      using hint = 'Verify and apply the repository migrations in order before continuing.';
  end if;
end $$;

create table if not exists public.workspace_profiles (
  workspace_id bigint primary key references public.workspaces(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  trading_name text not null default '' check (char_length(trading_name) <= 120),
  contact_email text not null default '' check (char_length(contact_email) <= 254),
  contact_telephone text not null default '' check (char_length(contact_telephone) <= 40),
  website text not null default '' check (char_length(website) <= 500),
  default_currency text not null default 'GBP' check (default_currency ~ '^[A-Z]{3}$'),
  business_status text not null default 'pre_incorporation'
    check (business_status in ('pre_incorporation', 'sole_trader', 'partnership', 'limited_company', 'other')),
  company_registration_number text not null default '' check (char_length(company_registration_number) <= 32),
  vat_registration_number text not null default '' check (char_length(vat_registration_number) <= 32),
  vat_registered boolean not null default false,
  notes text not null default '' check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  sourcing_platform text not null default '' check (char_length(sourcing_platform) <= 120),
  website_url text not null default '' check (char_length(website_url) <= 500),
  contact_name text not null default '' check (char_length(contact_name) <= 160),
  email text not null default '' check (char_length(email) <= 254),
  telephone text not null default '' check (char_length(telephone) <= 40),
  country text not null default '' check (char_length(country) <= 120),
  notes text not null default '' check (char_length(notes) <= 4000),
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists suppliers_workspace_active_name_idx
  on public.suppliers (workspace_id, lower(name)) where archived_at is null;
create index if not exists suppliers_workspace_archived_idx
  on public.suppliers (workspace_id, archived_at, name);

create table if not exists public.sales_channels (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  channel_type text not null check (channel_type in ('marketplace', 'webstore', 'direct', 'social', 'other')),
  account_display_name text not null default '' check (char_length(account_display_name) <= 160),
  notes text not null default '' check (char_length(notes) <= 2000),
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sales_channels_workspace_active_name_idx
  on public.sales_channels (workspace_id, lower(name)) where archived_at is null;
create index if not exists sales_channels_workspace_archived_idx
  on public.sales_channels (workspace_id, archived_at, name);

create table if not exists public.stock_locations (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  location_type text not null check (location_type in ('home', 'warehouse', 'amazon_fba', 'supplier', 'other')),
  description text not null default '' check (char_length(description) <= 1000),
  address text not null default '' check (char_length(address) <= 1000),
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists stock_locations_workspace_active_name_idx
  on public.stock_locations (workspace_id, lower(name)) where archived_at is null;
create index if not exists stock_locations_workspace_archived_idx
  on public.stock_locations (workspace_id, archived_at, name);

create table if not exists public.product_categories (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  notes text not null default '' check (char_length(notes) <= 1000),
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists product_categories_workspace_active_name_idx
  on public.product_categories (workspace_id, lower(name)) where archived_at is null;
create index if not exists product_categories_workspace_archived_idx
  on public.product_categories (workspace_id, archived_at, name);

create table if not exists public.expense_categories (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  notes text not null default '' check (char_length(notes) <= 1000),
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists expense_categories_workspace_active_name_idx
  on public.expense_categories (workspace_id, lower(name)) where archived_at is null;
create index if not exists expense_categories_workspace_archived_idx
  on public.expense_categories (workspace_id, archived_at, name);

create table if not exists public.workspace_integrations (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  provider_key text not null check (provider_key ~ '^[a-z0-9_]+$'),
  display_name text not null check (char_length(display_name) between 1 and 120),
  status text not null default 'not_connected'
    check (status in ('not_connected', 'planned', 'configuration_required')),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider_key)
);

create index if not exists workspace_integrations_workspace_status_idx
  on public.workspace_integrations (workspace_id, status);

insert into public.workspace_profiles (workspace_id, display_name)
select workspace.id, workspace.name
from public.workspaces as workspace
on conflict (workspace_id) do nothing;

insert into public.workspace_integrations (workspace_id, provider_key, display_name, status, notes)
select workspace.id, seed.provider_key, seed.display_name, seed.status, seed.notes
from public.workspaces as workspace
cross join (values
  ('amazon_sp_api', 'Amazon Selling Partner API', 'planned', 'Orders, fees and inventory. Amazon approval and secure server-side credentials will be required.'),
  ('ebay_api', 'eBay API', 'planned', 'Marketplace data connection; no account is connected.'),
  ('open_banking', 'Business banking / Open Banking', 'planned', 'Read-only banking may be considered after authority, account eligibility and provider approval are confirmed.'),
  ('openai', 'OpenAI', 'planned', 'Future assisted reporting only; no API key or connection is stored here.')
) as seed(provider_key, display_name, status, notes)
on conflict (workspace_id, provider_key) do nothing;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'workspace_profiles', 'suppliers', 'sales_channels', 'stock_locations',
    'product_categories', 'expense_categories', 'workspace_integrations'
  ] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_set_updated_at', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
      table_name || '_set_updated_at', table_name
    );
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

-- Workspace members can read settings. Only the application workspace owner
-- role can create or update them. This role is not legal ownership or banking authority.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'workspace_profiles', 'suppliers', 'sales_channels', 'stock_locations',
    'product_categories', 'expense_categories', 'workspace_integrations'
  ] loop
    execute format('drop policy if exists "Workspace members can view %s" on public.%I', table_name, table_name);
    execute format(
      'create policy "Workspace members can view %s" on public.%I for select to authenticated using (exists (select 1 from public.workspace_members as member where member.workspace_id = %I.workspace_id and member.user_id = (select auth.uid())))',
      table_name, table_name, table_name
    );

    execute format('drop policy if exists "Workspace owners can add %s" on public.%I', table_name, table_name);
    execute format(
      'create policy "Workspace owners can add %s" on public.%I for insert to authenticated with check (exists (select 1 from public.workspace_members as member where member.workspace_id = %I.workspace_id and member.user_id = (select auth.uid()) and member.role = ''owner''))',
      table_name, table_name, table_name
    );

    execute format('drop policy if exists "Workspace owners can update %s" on public.%I', table_name, table_name);
    execute format(
      'create policy "Workspace owners can update %s" on public.%I for update to authenticated using (exists (select 1 from public.workspace_members as member where member.workspace_id = %I.workspace_id and member.user_id = (select auth.uid()) and member.role = ''owner'')) with check (exists (select 1 from public.workspace_members as member where member.workspace_id = %I.workspace_id and member.user_id = (select auth.uid()) and member.role = ''owner''))',
      table_name, table_name, table_name, table_name
    );
  end loop;
end $$;

revoke all on table public.workspace_profiles from anon, authenticated;
revoke all on table public.suppliers from anon, authenticated;
revoke all on table public.sales_channels from anon, authenticated;
revoke all on table public.stock_locations from anon, authenticated;
revoke all on table public.product_categories from anon, authenticated;
revoke all on table public.expense_categories from anon, authenticated;
revoke all on table public.workspace_integrations from anon, authenticated;

grant select, insert, update on table public.workspace_profiles to authenticated;
grant select, insert, update on table public.suppliers to authenticated;
grant select, insert, update on table public.sales_channels to authenticated;
grant select, insert, update on table public.stock_locations to authenticated;
grant select, insert, update on table public.product_categories to authenticated;
grant select, insert, update on table public.expense_categories to authenticated;
grant select, insert, update on table public.workspace_integrations to authenticated;

grant usage, select on sequence public.suppliers_id_seq to authenticated;
grant usage, select on sequence public.sales_channels_id_seq to authenticated;
grant usage, select on sequence public.stock_locations_id_seq to authenticated;
grant usage, select on sequence public.product_categories_id_seq to authenticated;
grant usage, select on sequence public.expense_categories_id_seq to authenticated;
grant usage, select on sequence public.workspace_integrations_id_seq to authenticated;

create or replace function public.list_workspace_members(p_workspace_id bigint)
returns table (
  user_id uuid,
  email text,
  role text,
  joined_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.workspace_members as current_member
    where current_member.workspace_id = p_workspace_id
      and current_member.user_id = auth.uid()
  ) then
    raise exception 'Workspace access required.' using errcode = '42501';
  end if;

  return query
  select member.user_id, coalesce(account.email, ''), member.role, member.created_at
  from public.workspace_members as member
  left join auth.users as account on account.id = member.user_id
  where member.workspace_id = p_workspace_id
  order by member.created_at;
end;
$$;

revoke all on function public.list_workspace_members(bigint) from public, anon;
grant execute on function public.list_workspace_members(bigint) to authenticated;

commit;
