-- Stage 1: reliable inventory records and data integrity.
--
-- REVIEW BEFORE APPLYING. This migration is intentionally additive and aborts
-- if the expected predecessor schema is missing. Existing stock balances are
-- preserved as unverified opening-balance snapshots; no historical receipts
-- are invented.

begin;

select pg_advisory_xact_lock(hashtext('kurionyx:stage1_inventory_integrity'));

do $$
declare
  missing_objects text[] := array[]::text[];
  missing_columns text[];
begin
  if to_regclass('public.workspaces') is null then missing_objects := array_append(missing_objects, 'public.workspaces'); end if;
  if to_regclass('public.workspace_members') is null then missing_objects := array_append(missing_objects, 'public.workspace_members'); end if;
  if to_regclass('public.stock_items') is null then missing_objects := array_append(missing_objects, 'public.stock_items'); end if;
  if to_regclass('public.stock_sales') is null then missing_objects := array_append(missing_objects, 'public.stock_sales'); end if;
  if to_regclass('public.expenses') is null then missing_objects := array_append(missing_objects, 'public.expenses'); end if;
  if to_regclass('public.shipments') is null then missing_objects := array_append(missing_objects, 'public.shipments'); end if;

  if array_length(missing_objects, 1) is not null then
    raise exception 'Stage 1 prerequisites are missing: %', array_to_string(missing_objects, ', ')
      using hint = 'Apply and verify schema.sql and inventory_expansion.sql before this migration.';
  end if;

  select array_agg(required.table_name || '.' || required.column_name order by required.table_name, required.column_name)
    into missing_columns
  from (values
    ('stock_items', 'workspace_id'), ('stock_items', 'product_name'), ('stock_items', 'category'),
    ('stock_items', 'sku'), ('stock_items', 'units'), ('stock_items', 'unit_cost'),
    ('stock_items', 'shipping_paid'), ('stock_items', 'other_fees'), ('stock_items', 'notes'),
    ('stock_sales', 'workspace_id'), ('stock_sales', 'stock_item_id'), ('stock_sales', 'units'),
    ('stock_sales', 'sold_at'), ('expenses', 'workspace_id'), ('shipments', 'workspace_id')
  ) as required(table_name, column_name)
  where not exists (
    select 1 from information_schema.columns as actual
    where actual.table_schema = 'public'
      and actual.table_name = required.table_name
      and actual.column_name = required.column_name
  );

  if array_length(missing_columns, 1) is not null then
    raise exception 'Stage 1 prerequisite columns are missing: %', array_to_string(missing_columns, ', ')
      using hint = 'Compare the live schema with the repository before applying this migration.';
  end if;
end $$;

alter table public.stock_items
  add column if not exists data_status text not null default 'unverified',
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

alter table public.stock_sales
  add column if not exists data_status text not null default 'unverified';

alter table public.expenses
  add column if not exists data_status text not null default 'unverified',
  add column if not exists archived_at timestamptz,
  add column if not exists archive_reason text;

alter table public.shipments
  add column if not exists data_status text not null default 'unverified',
  add column if not exists archived_at timestamptz,
  add column if not exists archive_reason text;

do $$
declare
  target_table regclass;
  constraint_name text;
begin
  foreach target_table in array array[
    'public.stock_items'::regclass,
    'public.stock_sales'::regclass,
    'public.expenses'::regclass,
    'public.shipments'::regclass
  ] loop
    constraint_name := replace(target_table::text, '.', '_') || '_data_status_check';
    if not exists (
      select 1 from pg_constraint
      where conrelid = target_table and conname = constraint_name
    ) then
      execute format(
        'alter table %s add constraint %I check (data_status in (''demonstration'', ''unverified'', ''verified''))',
        target_table,
        constraint_name
      );
    end if;
  end loop;
end $$;

create table if not exists public.inventory_movements (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  stock_item_id bigint not null references public.stock_items(id) on delete restrict,
  movement_type text not null check (movement_type in ('opening_balance', 'receipt', 'sale', 'return', 'adjustment')),
  quantity_delta bigint not null check (quantity_delta <> 0),
  reason text not null check (char_length(reason) between 3 and 500),
  data_status text not null default 'unverified' check (data_status in ('demonstration', 'unverified', 'verified')),
  source_type text,
  source_id bigint,
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (
    (movement_type in ('opening_balance', 'receipt', 'return') and quantity_delta > 0)
    or (movement_type = 'sale' and quantity_delta < 0)
    or movement_type = 'adjustment'
  ),
  check ((source_type is null) = (source_id is null))
);

create index if not exists inventory_movements_workspace_occurred_idx
  on public.inventory_movements (workspace_id, occurred_at desc);
create index if not exists inventory_movements_stock_occurred_idx
  on public.inventory_movements (stock_item_id, occurred_at desc);
create unique index if not exists inventory_movements_source_unique_idx
  on public.inventory_movements (workspace_id, source_type, source_id, movement_type)
  where source_id is not null;

-- Snapshot only the balance that exists at migration time. The status remains
-- unverified unless an owner reviews the source record later.
insert into public.inventory_movements (
  workspace_id, stock_item_id, movement_type, quantity_delta, reason,
  data_status, source_type, source_id, occurred_at, created_by
)
select
  item.workspace_id,
  item.id,
  'opening_balance',
  item.units,
  'Opening balance preserved during Stage 1 migration; historical source not inferred.',
  'unverified',
  'stock_item_migration',
  item.id,
  coalesce(item.created_at, now()),
  null
from public.stock_items as item
where item.units > 0
on conflict do nothing;

create or replace function private.apply_inventory_movement()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_units bigint;
  item_workspace_id bigint;
  item_archived_at timestamptz;
begin
  select item.workspace_id, item.units, item.archived_at
    into item_workspace_id, current_units, item_archived_at
  from public.stock_items as item
  where item.id = new.stock_item_id
  for update;

  if not found then
    raise exception 'Stock item not found.' using errcode = 'P0002';
  end if;
  if item_workspace_id <> new.workspace_id then
    raise exception 'The stock item does not belong to this workspace.' using errcode = '23514';
  end if;
  if item_archived_at is not null then
    raise exception 'Archived stock cannot receive inventory movements.' using errcode = '23514';
  end if;
  if current_units + new.quantity_delta < 0 then
    raise exception 'Only % units are currently available.', current_units using errcode = '23514';
  end if;

  update public.stock_items
  set units = current_units + new.quantity_delta
  where id = new.stock_item_id;

  return new;
end;
$$;

revoke all on function private.apply_inventory_movement() from public, anon, authenticated;

drop trigger if exists inventory_movements_apply_to_stock on public.inventory_movements;
create trigger inventory_movements_apply_to_stock
before insert on public.inventory_movements
for each row execute function private.apply_inventory_movement();

-- Preserve the existing sale insert contract. A sale now posts exactly one
-- linked movement, which performs the same locked atomic decrement.
create or replace function private.apply_stock_sale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_workspace_id bigint;
  item_status text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = new.workspace_id and member.user_id = auth.uid()
  ) then
    raise exception 'Workspace access required.' using errcode = '42501';
  end if;

  select item.workspace_id, item.data_status
    into item_workspace_id, item_status
  from public.stock_items as item
  where item.id = new.stock_item_id;

  if not found then
    raise exception 'Stock item not found.' using errcode = 'P0002';
  end if;
  if item_workspace_id <> new.workspace_id then
    raise exception 'The stock item does not belong to this workspace.' using errcode = '23514';
  end if;

  insert into public.inventory_movements (
    workspace_id, stock_item_id, movement_type, quantity_delta, reason,
    data_status, source_type, source_id, occurred_at, created_by
  ) values (
    new.workspace_id, new.stock_item_id, 'sale', -new.units,
    'Stock deducted for recorded sale.', new.data_status,
    'stock_sale', new.id, new.sold_at, auth.uid()
  );

  return new;
end;
$$;

revoke all on function private.apply_stock_sale() from public, anon, authenticated;

drop trigger if exists stock_sales_apply_to_inventory on public.stock_sales;
create trigger stock_sales_apply_to_inventory
after insert on public.stock_sales
for each row execute function private.apply_stock_sale();

create or replace function public.create_stock_item(
  p_workspace_id bigint,
  p_product_name text,
  p_category text,
  p_sku text,
  p_initial_units bigint,
  p_unit_cost numeric,
  p_shipping_paid numeric,
  p_other_fees numeric,
  p_notes text,
  p_data_status text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_workspace_id bigint;
  new_stock_item_id bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if p_initial_units < 0 then raise exception 'Initial units cannot be negative.' using errcode = '23514'; end if;
  if p_data_status not in ('demonstration', 'unverified', 'verified') then raise exception 'Invalid data status.' using errcode = '23514'; end if;

  select member.workspace_id into member_workspace_id
  from public.workspace_members as member
  where member.user_id = auth.uid() and member.workspace_id = p_workspace_id;
  if member_workspace_id is null then raise exception 'Workspace access required.' using errcode = '42501'; end if;

  insert into public.stock_items (
    workspace_id, product_name, category, sku, units, unit_cost,
    shipping_paid, other_fees, notes, data_status
  ) values (
    member_workspace_id, trim(p_product_name), trim(p_category), trim(p_sku), 0,
    p_unit_cost, p_shipping_paid, p_other_fees, coalesce(trim(p_notes), ''), p_data_status
  ) returning id into new_stock_item_id;

  if p_initial_units > 0 then
    insert into public.inventory_movements (
      workspace_id, stock_item_id, movement_type, quantity_delta, reason,
      data_status, created_by
    ) values (
      member_workspace_id, new_stock_item_id, 'receipt', p_initial_units,
      'Initial stock receipt recorded when the stock item was created.',
      p_data_status, auth.uid()
    );
  end if;

  return new_stock_item_id;
end;
$$;

create or replace function public.record_inventory_movement(
  p_stock_item_id bigint,
  p_movement_type text,
  p_quantity bigint,
  p_reason text,
  p_data_status text,
  p_occurred_at timestamptz default now()
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_workspace_id bigint;
  movement_id bigint;
  signed_quantity bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if p_movement_type not in ('receipt', 'return', 'adjustment') then raise exception 'Invalid manual movement type.' using errcode = '23514'; end if;
  if p_quantity = 0 then raise exception 'Movement quantity cannot be zero.' using errcode = '23514'; end if;
  if p_movement_type in ('receipt', 'return') and p_quantity < 0 then raise exception 'Receipts and returns must add stock.' using errcode = '23514'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'A reason is required.' using errcode = '23514'; end if;
  if p_data_status not in ('demonstration', 'unverified', 'verified') then raise exception 'Invalid data status.' using errcode = '23514'; end if;

  select item.workspace_id into item_workspace_id
  from public.stock_items as item
  where item.id = p_stock_item_id
    and item.archived_at is null
    and exists (
      select 1 from public.workspace_members as member
      where member.workspace_id = item.workspace_id and member.user_id = auth.uid()
    );
  if item_workspace_id is null then raise exception 'Stock item not found or access denied.' using errcode = '42501'; end if;

  signed_quantity := case when p_movement_type in ('receipt', 'return') then abs(p_quantity) else p_quantity end;
  insert into public.inventory_movements (
    workspace_id, stock_item_id, movement_type, quantity_delta, reason,
    data_status, occurred_at, created_by
  ) values (
    item_workspace_id, p_stock_item_id, p_movement_type, signed_quantity,
    trim(p_reason), p_data_status, coalesce(p_occurred_at, now()), auth.uid()
  ) returning id into movement_id;

  return movement_id;
end;
$$;

create or replace function public.archive_stock_item(p_stock_item_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_units bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'An archive reason is required.' using errcode = '23514'; end if;

  select item.units into current_units
  from public.stock_items as item
  where item.id = p_stock_item_id
    and item.archived_at is null
    and exists (
      select 1 from public.workspace_members as member
      where member.workspace_id = item.workspace_id and member.user_id = auth.uid()
    )
  for update;
  if not found then raise exception 'Stock item not found or access denied.' using errcode = '42501'; end if;
  if current_units <> 0 then raise exception 'Stock must be zero before archiving.' using errcode = '23514'; end if;

  update public.stock_items
  set archived_at = now(), archived_by = auth.uid(), notes = concat_ws(E'\n', nullif(notes, ''), 'Archived: ' || trim(p_reason))
  where id = p_stock_item_id;
end;
$$;

create or replace function public.set_record_data_status(
  p_record_type text,
  p_record_id bigint,
  p_data_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_rows integer;
begin
  if auth.uid() is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if p_data_status not in ('demonstration', 'unverified', 'verified') then raise exception 'Invalid data status.' using errcode = '23514'; end if;

  if p_record_type = 'stock_sale' then
    update public.stock_sales as sale
    set data_status = p_data_status
    where sale.id = p_record_id
      and exists (
        select 1 from public.workspace_members as member
        where member.workspace_id = sale.workspace_id and member.user_id = auth.uid()
      );
    get diagnostics changed_rows = row_count;
    if changed_rows = 1 then
      update public.inventory_movements
      set data_status = p_data_status
      where source_type = 'stock_sale' and source_id = p_record_id;
    end if;
  elsif p_record_type = 'expense' then
    update public.expenses as expense
    set data_status = p_data_status
    where expense.id = p_record_id
      and exists (
        select 1 from public.workspace_members as member
        where member.workspace_id = expense.workspace_id and member.user_id = auth.uid()
      );
    get diagnostics changed_rows = row_count;
  elsif p_record_type = 'shipment' then
    update public.shipments as shipment
    set data_status = p_data_status
    where shipment.id = p_record_id
      and exists (
        select 1 from public.workspace_members as member
        where member.workspace_id = shipment.workspace_id and member.user_id = auth.uid()
      );
    get diagnostics changed_rows = row_count;
  else
    raise exception 'Unsupported record type.' using errcode = '23514';
  end if;

  if changed_rows <> 1 then raise exception 'Record not found or access denied.' using errcode = '42501'; end if;
end;
$$;

create or replace function public.archive_business_record(
  p_record_type text,
  p_record_id bigint,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_rows integer;
begin
  if auth.uid() is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'An archive reason is required.' using errcode = '23514'; end if;

  if p_record_type = 'expense' then
    update public.expenses as expense
    set archived_at = now(), archive_reason = trim(p_reason)
    where expense.id = p_record_id and expense.archived_at is null
      and exists (
        select 1 from public.workspace_members as member
        where member.workspace_id = expense.workspace_id and member.user_id = auth.uid()
      );
    get diagnostics changed_rows = row_count;
  elsif p_record_type = 'shipment' then
    update public.shipments as shipment
    set archived_at = now(), archive_reason = trim(p_reason)
    where shipment.id = p_record_id and shipment.archived_at is null
      and exists (
        select 1 from public.workspace_members as member
        where member.workspace_id = shipment.workspace_id and member.user_id = auth.uid()
      );
    get diagnostics changed_rows = row_count;
  else
    raise exception 'Unsupported record type.' using errcode = '23514';
  end if;

  if changed_rows <> 1 then raise exception 'Record not found or access denied.' using errcode = '42501'; end if;
end;
$$;

revoke all on function public.create_stock_item(bigint, text, text, text, bigint, numeric, numeric, numeric, text, text) from public, anon;
revoke all on function public.record_inventory_movement(bigint, text, bigint, text, text, timestamptz) from public, anon;
revoke all on function public.archive_stock_item(bigint, text) from public, anon;
revoke all on function public.set_record_data_status(text, bigint, text) from public, anon;
revoke all on function public.archive_business_record(text, bigint, text) from public, anon;
grant execute on function public.create_stock_item(bigint, text, text, text, bigint, numeric, numeric, numeric, text, text) to authenticated;
grant execute on function public.record_inventory_movement(bigint, text, bigint, text, text, timestamptz) to authenticated;
grant execute on function public.archive_stock_item(bigint, text) to authenticated;
grant execute on function public.set_record_data_status(text, bigint, text) to authenticated;
grant execute on function public.archive_business_record(text, bigint, text) to authenticated;

alter table public.inventory_movements enable row level security;

drop policy if exists "Members can view inventory movements" on public.inventory_movements;
create policy "Members can view inventory movements"
on public.inventory_movements for select
to authenticated
using (
  exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = inventory_movements.workspace_id
      and member.user_id = (select auth.uid())
  )
);

-- Important inventory history is append-only to browser clients.
revoke all on table public.inventory_movements from anon, authenticated;
grant select on table public.inventory_movements to authenticated;
grant usage, select on sequence public.inventory_movements_id_seq to authenticated;

revoke insert, delete on table public.stock_items from authenticated;
revoke update on table public.stock_items from authenticated;
grant update (product_name, category, sku, unit_cost, shipping_paid, other_fees, notes, data_status)
  on table public.stock_items to authenticated;
drop policy if exists "Members can remove stock" on public.stock_items;

revoke delete on table public.expenses from authenticated;
revoke delete on table public.shipments from authenticated;
drop policy if exists "Members can remove expenses" on public.expenses;
drop policy if exists "Members can remove shipments" on public.shipments;

commit;
