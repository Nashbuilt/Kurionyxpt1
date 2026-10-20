-- Private stock photography and workspace-scoped shipment tracking history.
-- Additive only: existing stock balances, shipments and tracking values are unchanged.

begin;

do $$
begin
  if to_regclass('public.stock_items') is null or to_regclass('public.shipments') is null then
    raise exception 'Stage 1 stock and shipment tables must exist before this migration.';
  end if;
end $$;

create table if not exists public.stock_images (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  stock_item_id bigint not null,
  storage_path text not null unique check (char_length(storage_path) between 3 and 500),
  alt_text text not null default '' check (char_length(alt_text) <= 240),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint stock_images_stock_workspace_fk
    foreign key (workspace_id, stock_item_id)
    references public.stock_items(workspace_id, id) on delete restrict
);

create index if not exists stock_images_stock_item_idx
  on public.stock_images (workspace_id, stock_item_id, sort_order, created_at);

alter table public.shipments
  add column if not exists final_mile_carrier text not null default '',
  add column if not exists final_mile_tracking_number text not null default '';

create unique index if not exists shipments_workspace_id_id_idx
  on public.shipments (workspace_id, id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shipments_final_mile_length_check' and conrelid = 'public.shipments'::regclass) then
    alter table public.shipments add constraint shipments_final_mile_length_check
      check (char_length(final_mile_carrier) <= 120 and char_length(final_mile_tracking_number) <= 160);
  end if;
end $$;

create table if not exists public.shipment_tracking_events (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  shipment_id bigint not null,
  event_status text not null check (event_status in ('info_received','in_transit','customs','out_for_delivery','delivered','exception')),
  description text not null check (char_length(description) between 2 and 500),
  location text not null default '' check (char_length(location) <= 200),
  occurred_at timestamptz not null,
  source text not null default 'manual' check (source in ('manual','17track','carrier')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint shipment_tracking_events_shipment_workspace_fk
    foreign key (workspace_id, shipment_id)
    references public.shipments(workspace_id, id) on delete restrict
);

create index if not exists shipment_tracking_events_shipment_idx
  on public.shipment_tracking_events (workspace_id, shipment_id, occurred_at desc);

alter table public.stock_images enable row level security;
alter table public.shipment_tracking_events enable row level security;

create policy "Workspace members can view stock images" on public.stock_images for select to authenticated
using (exists (select 1 from public.workspace_members m where m.workspace_id = stock_images.workspace_id and m.user_id = (select auth.uid())));
create policy "Workspace members can add stock images" on public.stock_images for insert to authenticated
with check (created_by = (select auth.uid()) and exists (select 1 from public.workspace_members m where m.workspace_id = stock_images.workspace_id and m.user_id = (select auth.uid())));
create policy "Workspace members can remove stock images" on public.stock_images for delete to authenticated
using (exists (select 1 from public.workspace_members m where m.workspace_id = stock_images.workspace_id and m.user_id = (select auth.uid())));

create policy "Workspace members can view tracking events" on public.shipment_tracking_events for select to authenticated
using (exists (select 1 from public.workspace_members m where m.workspace_id = shipment_tracking_events.workspace_id and m.user_id = (select auth.uid())));
create policy "Workspace members can add tracking events" on public.shipment_tracking_events for insert to authenticated
with check (created_by = (select auth.uid()) and exists (select 1 from public.workspace_members m where m.workspace_id = shipment_tracking_events.workspace_id and m.user_id = (select auth.uid())));

revoke all on public.stock_images, public.shipment_tracking_events from anon, authenticated;
grant select, insert, delete on public.stock_images to authenticated;
grant select, insert on public.shipment_tracking_events to authenticated;
grant usage, select on sequence public.stock_images_id_seq, public.shipment_tracking_events_id_seq to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stock-images', 'stock-images', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "Workspace members can read stock image files" on storage.objects for select to authenticated
using (bucket_id = 'stock-images' and (storage.foldername(name))[1] ~ '^[0-9]+$' and exists (
  select 1 from public.workspace_members m where m.workspace_id = ((storage.foldername(name))[1])::bigint and m.user_id = (select auth.uid())
));
create policy "Workspace members can upload stock image files" on storage.objects for insert to authenticated
with check (bucket_id = 'stock-images' and (storage.foldername(name))[1] ~ '^[0-9]+$' and exists (
  select 1 from public.workspace_members m where m.workspace_id = ((storage.foldername(name))[1])::bigint and m.user_id = (select auth.uid())
));
create policy "Workspace members can delete stock image files" on storage.objects for delete to authenticated
using (bucket_id = 'stock-images' and (storage.foldername(name))[1] ~ '^[0-9]+$' and exists (
  select 1 from public.workspace_members m where m.workspace_id = ((storage.foldername(name))[1])::bigint and m.user_id = (select auth.uid())
));

commit;
