-- Actor attribution for operational records. Existing rows remain unassigned;
-- historical authorship is never guessed or backfilled.
begin;
select pg_advisory_xact_lock(hashtext('kurionyx:profile_audit_attribution'));

do $$
declare table_name text;
begin
  foreach table_name in array array['stock_items','stock_sales','expenses','shipments','income_records'] loop
    if to_regclass('public.' || table_name) is null then raise exception 'Required table public.% is missing.', table_name; end if;
    execute format('alter table public.%I add column if not exists created_by uuid references auth.users(id) on delete set null', table_name);
    execute format('alter table public.%I add column if not exists updated_by uuid references auth.users(id) on delete set null', table_name);
    execute format('alter table public.%I add column if not exists updated_at timestamptz not null default now()', table_name);
    execute format('create index if not exists %I on public.%I (workspace_id, updated_by)', table_name || '_workspace_updated_by_idx', table_name);
  end loop;
end $$;

create or replace function private.set_record_actor()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by = coalesce(new.created_by, auth.uid());
  end if;
  new.updated_by = auth.uid();
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function private.set_record_actor() from public, anon, authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array['stock_items','stock_sales','expenses','shipments','income_records'] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_set_record_actor', table_name);
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.set_record_actor()', table_name || '_set_record_actor', table_name);
  end loop;
end $$;

commit;
