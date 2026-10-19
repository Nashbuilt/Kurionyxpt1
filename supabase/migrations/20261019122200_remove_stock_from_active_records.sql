-- Remove stock from active records without deleting its audit history.
-- Any remaining balance is closed through a reasoned adjustment first.

begin;

select pg_advisory_xact_lock(hashtext('kurionyx:remove_stock_from_active_records'));

create or replace function public.archive_stock_item(p_stock_item_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_workspace_id bigint;
  current_units bigint;
  item_data_status text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A removal reason is required.' using errcode = '23514';
  end if;

  select item.workspace_id, item.units, item.data_status
    into item_workspace_id, current_units, item_data_status
  from public.stock_items as item
  where item.id = p_stock_item_id
    and item.archived_at is null
    and exists (
      select 1 from public.workspace_members as member
      where member.workspace_id = item.workspace_id
        and member.user_id = auth.uid()
    )
  for update;

  if not found then
    raise exception 'Stock item not found or access denied.' using errcode = '42501';
  end if;

  if current_units > 0 then
    insert into public.inventory_movements (
      workspace_id, stock_item_id, movement_type, quantity_delta, reason,
      data_status, occurred_at, created_by
    ) values (
      item_workspace_id,
      p_stock_item_id,
      'adjustment',
      -current_units,
      'Removed from active records: ' || trim(p_reason),
      item_data_status,
      now(),
      auth.uid()
    );
  end if;

  update public.stock_items
  set archived_at = now(),
      archived_by = auth.uid(),
      notes = concat_ws(E'\n', nullif(notes, ''), 'Removed from active records: ' || trim(p_reason))
  where id = p_stock_item_id;
end;
$$;

revoke all on function public.archive_stock_item(bigint, text) from public, anon;
grant execute on function public.archive_stock_item(bigint, text) to authenticated;

commit;
