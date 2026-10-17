-- Kurionyx operations toolkit schema.
-- Apply in the Supabase SQL editor as the postgres role.

create table if not exists public.workspaces (
  id bigint generated always as identity primary key,
  name text not null unique check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_id_idx
  on public.workspace_members (user_id, workspace_id);

create table if not exists public.stock_items (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  product_name text not null check (char_length(product_name) between 1 and 200),
  sku text not null check (char_length(sku) between 1 and 80),
  units bigint not null default 0 check (units >= 0),
  unit_cost numeric(12, 2) not null default 0 check (unit_cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, sku)
);

create index if not exists stock_items_workspace_id_idx
  on public.stock_items (workspace_id);

create table if not exists public.expenses (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  description text not null check (char_length(description) between 1 and 240),
  category text not null check (char_length(category) between 1 and 80),
  expense_date date not null default current_date,
  amount numeric(12, 2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists expenses_workspace_date_idx
  on public.expenses (workspace_id, expense_date desc);

create schema if not exists private;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;

drop trigger if exists stock_items_set_updated_at on public.stock_items;
create trigger stock_items_set_updated_at
before update on public.stock_items
for each row execute function private.set_updated_at();

drop trigger if exists expenses_set_updated_at on public.expenses;
create trigger expenses_set_updated_at
before update on public.expenses
for each row execute function private.set_updated_at();

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.stock_items enable row level security;
alter table public.expenses enable row level security;

drop policy if exists "Members can view their workspace" on public.workspaces;
create policy "Members can view their workspace"
on public.workspaces for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_members as member
    where member.workspace_id = workspaces.id
      and member.user_id = (select auth.uid())
  )
);

drop policy if exists "Members can view their membership" on public.workspace_members;
create policy "Members can view their membership"
on public.workspace_members for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Members can view stock" on public.stock_items;
create policy "Members can view stock"
on public.stock_items for select
to authenticated
using (
  exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = stock_items.workspace_id
      and member.user_id = (select auth.uid())
  )
);

drop policy if exists "Members can add stock" on public.stock_items;
create policy "Members can add stock"
on public.stock_items for insert
to authenticated
with check (
  exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = stock_items.workspace_id
      and member.user_id = (select auth.uid())
  )
);

drop policy if exists "Members can update stock" on public.stock_items;
create policy "Members can update stock"
on public.stock_items for update
to authenticated
using (
  exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = stock_items.workspace_id
      and member.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = stock_items.workspace_id
      and member.user_id = (select auth.uid())
  )
);

drop policy if exists "Members can remove stock" on public.stock_items;
create policy "Members can remove stock"
on public.stock_items for delete
to authenticated
using (
  exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = stock_items.workspace_id
      and member.user_id = (select auth.uid())
  )
);

drop policy if exists "Members can view expenses" on public.expenses;
create policy "Members can view expenses"
on public.expenses for select
to authenticated
using (
  exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = expenses.workspace_id
      and member.user_id = (select auth.uid())
  )
);

drop policy if exists "Members can add expenses" on public.expenses;
create policy "Members can add expenses"
on public.expenses for insert
to authenticated
with check (
  exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = expenses.workspace_id
      and member.user_id = (select auth.uid())
  )
);

drop policy if exists "Members can update expenses" on public.expenses;
create policy "Members can update expenses"
on public.expenses for update
to authenticated
using (
  exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = expenses.workspace_id
      and member.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = expenses.workspace_id
      and member.user_id = (select auth.uid())
  )
);

drop policy if exists "Members can remove expenses" on public.expenses;
create policy "Members can remove expenses"
on public.expenses for delete
to authenticated
using (
  exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = expenses.workspace_id
      and member.user_id = (select auth.uid())
  )
);

revoke all on table public.workspaces from anon, authenticated;
revoke all on table public.workspace_members from anon, authenticated;
revoke all on table public.stock_items from anon, authenticated;
revoke all on table public.expenses from anon, authenticated;

grant select on table public.workspaces to authenticated;
grant select on table public.workspace_members to authenticated;
grant select, insert, update, delete on table public.stock_items to authenticated;
grant select, insert, update, delete on table public.expenses to authenticated;
grant usage, select on sequence public.stock_items_id_seq to authenticated;
grant usage, select on sequence public.expenses_id_seq to authenticated;

insert into public.workspaces (name)
values ('Kurionyx')
on conflict (name) do nothing;
