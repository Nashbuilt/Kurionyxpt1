-- Allow a recorded sale to be voided after its linked stock item was removed
-- from active records. Reactivation, compensation and sale archiving are one
-- transaction, so a failure cannot leave inventory in a partial state.

begin;

select pg_advisory_xact_lock(hashtext('kurionyx:void_sales_for_archived_stock'));

do $$
begin
  if to_regclass('public.stock_sales') is null
     or to_regclass('public.stock_items') is null
     or to_regclass('public.inventory_movements') is null then
    raise exception 'Sale void prerequisites are missing.'
      using hint = 'Apply the inventory integrity and sale void migrations first.';
  end if;
end $$;

create or replace function public.void_stock_sale(p_sale_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_sale public.stock_sales%rowtype;
  item_workspace_id bigint;
  item_archived_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A void reason is required.' using errcode = '23514';
  end if;

  select sale.* into target_sale
  from public.stock_sales as sale
  where sale.id = p_sale_id
    and sale.archived_at is null
    and exists (
      select 1 from public.workspace_members as member
      where member.workspace_id = sale.workspace_id
        and member.user_id = auth.uid()
    )
  for update;

  if not found then
    raise exception 'Sale not found, already voided, or access denied.' using errcode = '42501';
  end if;

  select item.workspace_id, item.archived_at
    into item_workspace_id, item_archived_at
  from public.stock_items as item
  where item.id = target_sale.stock_item_id
  for update;

  if not found or item_workspace_id <> target_sale.workspace_id then
    raise exception 'The sale stock item is missing or belongs to another workspace.' using errcode = '23514';
  end if;

  if item_archived_at is not null then
    update public.stock_items
    set archived_at = null,
        archived_by = null,
        notes = concat_ws(
          E'\n',
          nullif(notes, ''),
          'Returned to active records because sale ' || target_sale.id ||
          ' was removed: ' || trim(p_reason)
        )
    where id = target_sale.stock_item_id;
  end if;

  insert into public.inventory_movements (
    workspace_id, stock_item_id, movement_type, quantity_delta, reason,
    data_status, source_type, source_id, occurred_at, created_by
  ) values (
    target_sale.workspace_id,
    target_sale.stock_item_id,
    'adjustment',
    target_sale.units,
    'Sale voided: ' || trim(p_reason),
    target_sale.data_status,
    'stock_sale_void',
    target_sale.id,
    now(),
    auth.uid()
  );

  update public.stock_sales
  set archived_at = now(),
      archive_reason = trim(p_reason),
      archived_by = auth.uid()
  where id = target_sale.id;
end;
$$;

revoke all on function public.void_stock_sale(bigint, text) from public, anon;
grant execute on function public.void_stock_sale(bigint, text) to authenticated;

commit;
