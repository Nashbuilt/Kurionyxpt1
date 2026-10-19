-- Void recorded sales without deleting history. The sale is archived and a
-- compensating inventory adjustment restores the units in one transaction.
begin;
select pg_advisory_xact_lock(hashtext('kurionyx:void_stock_sales'));

do $$
begin
  if to_regclass('public.stock_sales') is null
     or to_regclass('public.stock_items') is null
     or to_regclass('public.inventory_movements') is null then
    raise exception 'Sale void prerequisites are missing.'
      using hint = 'Apply the Stage 1 inventory migration before this migration.';
  end if;
end $$;

alter table public.stock_sales
  add column if not exists archived_at timestamptz,
  add column if not exists archive_reason text,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

create index if not exists stock_sales_workspace_archived_sold_idx
  on public.stock_sales (workspace_id, archived_at, sold_at desc);

create or replace function public.void_stock_sale(p_sale_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_sale public.stock_sales%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'A void reason is required.' using errcode = '23514'; end if;

  select sale.* into target_sale
  from public.stock_sales as sale
  where sale.id = p_sale_id
    and sale.archived_at is null
    and exists (
      select 1 from public.workspace_members as member
      where member.workspace_id = sale.workspace_id and member.user_id = auth.uid()
    )
  for update;

  if not found then raise exception 'Sale not found, already voided, or access denied.' using errcode = '42501'; end if;

  insert into public.inventory_movements (
    workspace_id, stock_item_id, movement_type, quantity_delta, reason,
    data_status, source_type, source_id, occurred_at, created_by
  ) values (
    target_sale.workspace_id, target_sale.stock_item_id, 'adjustment', target_sale.units,
    'Sale voided: ' || trim(p_reason), target_sale.data_status,
    'stock_sale_void', target_sale.id, now(), auth.uid()
  );

  update public.stock_sales
  set archived_at = now(), archive_reason = trim(p_reason), archived_by = auth.uid()
  where id = target_sale.id;
end;
$$;

revoke all on function public.void_stock_sale(bigint, text) from public, anon;
grant execute on function public.void_stock_sale(bigint, text) to authenticated;
revoke update, delete on table public.stock_sales from authenticated;
commit;
