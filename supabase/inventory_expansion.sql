-- Kurionyx inventory, sales, and shipping expansion.
-- Run once in the Supabase SQL editor after the base schema.

begin;

alter table public.stock_items
  add column if not exists category text not null default 'Uncategorised',
  add column if not exists notes text not null default '',
  add column if not exists shipping_paid numeric(12, 2) not null default 0,
  add column if not exists other_fees numeric(12, 2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'stock_items_category_length_check'
      and conrelid = 'public.stock_items'::regclass
  ) then
    alter table public.stock_items
      add constraint stock_items_category_length_check
      check (char_length(category) between 1 and 100);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'stock_items_notes_length_check'
      and conrelid = 'public.stock_items'::regclass
  ) then
    alter table public.stock_items
      add constraint stock_items_notes_length_check
      check (char_length(notes) <= 2000);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'stock_items_additional_costs_check'
      and conrelid = 'public.stock_items'::regclass
  ) then
    alter table public.stock_items
      add constraint stock_items_additional_costs_check
      check (shipping_paid >= 0 and other_fees >= 0);
  end if;
end $$;

create table if not exists public.stock_sales (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  stock_item_id bigint not null references public.stock_items(id) on delete restrict,
  units bigint not null check (units > 0),
  unit_sale_price numeric(12, 2) not null default 0 check (unit_sale_price >= 0),
  marketplace text not null default 'Direct' check (char_length(marketplace) between 1 and 80),
  marketplace_fees numeric(12, 2) not null default 0 check (marketplace_fees >= 0),
  notes text not null default '' check (char_length(notes) <= 2000),
  sold_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists stock_sales_workspace_sold_at_idx
  on public.stock_sales (workspace_id, sold_at desc);
create index if not exists stock_sales_stock_item_id_idx
  on public.stock_sales (stock_item_id);

create table if not exists public.shipments (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  direction text not null check (direction in ('incoming', 'outgoing')),
  status text not null default 'planned' check (status in ('planned', 'in_transit', 'delivered', 'cancelled')),
  item_name text not null check (char_length(item_name) between 1 and 200),
  category text not null default 'Uncategorised' check (char_length(category) between 1 and 100),
  units bigint not null check (units > 0),
  origin text not null default '' check (char_length(origin) <= 200),
  destination text not null default '' check (char_length(destination) <= 200),
  carrier text not null default '' check (char_length(carrier) <= 120),
  tracking_number text not null default '' check (char_length(tracking_number) <= 160),
  shipping_cost numeric(12, 2) not null default 0 check (shipping_cost >= 0),
  expected_date date,
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shipments_workspace_status_expected_idx
  on public.shipments (workspace_id, status, expected_date);

drop trigger if exists shipments_set_updated_at on public.shipments;
create trigger shipments_set_updated_at
before update on public.shipments
for each row execute function private.set_updated_at();

create or replace function private.apply_stock_sale()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  available_units bigint;
  item_workspace_id bigint;
begin
  select item.workspace_id, item.units
    into item_workspace_id, available_units
  from public.stock_items as item
  where item.id = new.stock_item_id
  for update;

  if not found then
    raise exception 'Stock item not found.' using errcode = 'P0002';
  end if;

  if item_workspace_id <> new.workspace_id then
    raise exception 'The stock item does not belong to this workspace.' using errcode = '23514';
  end if;

  if new.units > available_units then
    raise exception 'Only % units are currently available.', available_units using errcode = '23514';
  end if;

  update public.stock_items
  set units = units - new.units
  where id = new.stock_item_id;

  return new;
end;
$$;

revoke all on function private.apply_stock_sale() from public, anon, authenticated;

drop trigger if exists stock_sales_apply_to_inventory on public.stock_sales;
create trigger stock_sales_apply_to_inventory
before insert on public.stock_sales
for each row execute function private.apply_stock_sale();

alter table public.stock_sales enable row level security;
alter table public.shipments enable row level security;

drop policy if exists "Members can view sales" on public.stock_sales;
create policy "Members can view sales"
on public.stock_sales for select
to authenticated
using (
  exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = stock_sales.workspace_id
      and member.user_id = (select auth.uid())
  )
);

drop policy if exists "Members can record sales" on public.stock_sales;
create policy "Members can record sales"
on public.stock_sales for insert
to authenticated
with check (
  exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = stock_sales.workspace_id
      and member.user_id = (select auth.uid())
  )
);

drop policy if exists "Members can view shipments" on public.shipments;
create policy "Members can view shipments"
on public.shipments for select
to authenticated
using (
  exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = shipments.workspace_id
      and member.user_id = (select auth.uid())
  )
);

drop policy if exists "Members can add shipments" on public.shipments;
create policy "Members can add shipments"
on public.shipments for insert
to authenticated
with check (
  exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = shipments.workspace_id
      and member.user_id = (select auth.uid())
  )
);

drop policy if exists "Members can update shipments" on public.shipments;
create policy "Members can update shipments"
on public.shipments for update
to authenticated
using (
  exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = shipments.workspace_id
      and member.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = shipments.workspace_id
      and member.user_id = (select auth.uid())
  )
);

drop policy if exists "Members can remove shipments" on public.shipments;
create policy "Members can remove shipments"
on public.shipments for delete
to authenticated
using (
  exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = shipments.workspace_id
      and member.user_id = (select auth.uid())
  )
);

revoke all on table public.stock_sales from anon, authenticated;
revoke all on table public.shipments from anon, authenticated;
grant select, insert on table public.stock_sales to authenticated;
grant select, insert, update, delete on table public.shipments to authenticated;
grant usage, select on sequence public.stock_sales_id_seq to authenticated;
grant usage, select on sequence public.shipments_id_seq to authenticated;

commit;
