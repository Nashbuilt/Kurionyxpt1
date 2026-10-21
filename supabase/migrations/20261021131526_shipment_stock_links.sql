-- Workspace-safe stock contents for shipments and idempotent incoming receipt.
begin;
select pg_advisory_xact_lock(hashtext('kurionyx:shipment_stock_links'));

create unique index if not exists shipments_workspace_id_id_idx on public.shipments(workspace_id, id);
create unique index if not exists stock_items_workspace_id_id_idx on public.stock_items(workspace_id, id);

create table if not exists public.shipment_items (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  shipment_id bigint not null,
  stock_item_id bigint not null,
  quantity bigint not null check (quantity > 0),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (shipment_id, stock_item_id),
  foreign key (workspace_id, shipment_id) references public.shipments(workspace_id, id) on delete cascade,
  foreign key (workspace_id, stock_item_id) references public.stock_items(workspace_id, id) on delete restrict
);
create index if not exists shipment_items_workspace_shipment_idx on public.shipment_items(workspace_id, shipment_id);
alter table public.shipment_items enable row level security;
create policy "Workspace members can view shipment items" on public.shipment_items for select to authenticated using (exists (
  select 1 from public.workspace_members member where member.workspace_id = shipment_items.workspace_id and member.user_id = auth.uid()
));
revoke all on public.shipment_items from public, anon, authenticated;
grant select on public.shipment_items to authenticated;

create or replace function public.set_shipment_stock_link(p_shipment_id bigint, p_stock_item_id bigint, p_quantity bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.shipments%rowtype;
begin
  select * into target from public.shipments where id = p_shipment_id;
  if target.id is null then raise exception 'Shipment not found.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.workspace_members member where member.workspace_id = target.workspace_id and member.user_id = auth.uid()) then raise exception 'Workspace access required.' using errcode = '42501'; end if;
  if target.status = 'delivered' then raise exception 'A received shipment link cannot be changed.' using errcode = '22023'; end if;
  delete from public.shipment_items where shipment_id = target.id;
  if p_stock_item_id is not null then
    if p_quantity is null or p_quantity < 1 then raise exception 'A linked stock quantity is required.' using errcode = '22023'; end if;
    insert into public.shipment_items(workspace_id, shipment_id, stock_item_id, quantity)
    select target.workspace_id, target.id, stock.id, p_quantity from public.stock_items stock
    where stock.id = p_stock_item_id and stock.workspace_id = target.workspace_id and stock.archived_at is null;
    if not found then raise exception 'Active stock item not found in this workspace.' using errcode = 'P0002'; end if;
  end if;
end;
$$;

create or replace function public.receive_incoming_shipment(p_shipment_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.shipments%rowtype; line public.shipment_items%rowtype; receipt_count integer := 0;
begin
  select * into target from public.shipments where id = p_shipment_id for update;
  if target.id is null then raise exception 'Shipment not found.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.workspace_members member where member.workspace_id = target.workspace_id and member.user_id = auth.uid()) then raise exception 'Workspace access required.' using errcode = '42501'; end if;
  if target.direction <> 'incoming' then raise exception 'Only incoming shipments can be received into stock.' using errcode = '22023'; end if;
  if target.status = 'delivered' then raise exception 'This shipment has already been received.' using errcode = '23505'; end if;
  if target.status = 'cancelled' then raise exception 'A cancelled shipment cannot be received.' using errcode = '22023'; end if;
  for line in select * from public.shipment_items where shipment_id = target.id for update loop
    if exists (select 1 from public.inventory_movements movement where movement.workspace_id = target.workspace_id and movement.source_type = 'shipment_item' and movement.source_id = line.id and movement.movement_type = 'receipt') then raise exception 'This shipment line has already been received.' using errcode = '23505'; end if;
    update public.stock_items set units = units + line.quantity where id = line.stock_item_id and workspace_id = target.workspace_id and archived_at is null;
    if not found then raise exception 'Linked stock is archived or unavailable.' using errcode = '22023'; end if;
    insert into public.inventory_movements(workspace_id, stock_item_id, movement_type, quantity_delta, reason, data_status, source_type, source_id, created_by)
    values(target.workspace_id, line.stock_item_id, 'receipt', line.quantity, 'Received from incoming shipment: ' || target.item_name, target.data_status, 'shipment_item', line.id, auth.uid());
    receipt_count := receipt_count + 1;
  end loop;
  if receipt_count = 0 then raise exception 'Link at least one stock item before receiving this shipment.' using errcode = '22023'; end if;
  update public.shipments set status = 'delivered' where id = target.id;
end;
$$;

revoke all on function public.set_shipment_stock_link(bigint,bigint,bigint) from public, anon;
grant execute on function public.set_shipment_stock_link(bigint,bigint,bigint) to authenticated;
revoke all on function public.receive_incoming_shipment(bigint) from public, anon;
grant execute on function public.receive_incoming_shipment(bigint) to authenticated;

commit;
