-- Owner-only Monzo OAuth connection state and encrypted token storage.
begin;
select pg_advisory_xact_lock(hashtext('kurionyx:monzo_oauth_connection'));

create extension if not exists supabase_vault with schema vault;

create table if not exists public.monzo_oauth_states (
  state uuid primary key,
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.monzo_connections (
  workspace_id bigint primary key references public.workspaces(id) on delete cascade,
  account_id text not null,
  account_name text not null,
  account_type text,
  access_token_secret_id uuid not null,
  refresh_token_secret_id uuid,
  token_expires_at timestamptz,
  status text not null default 'connected' check (status in ('connected', 'reauthorisation_required', 'disconnected')),
  connected_by uuid references auth.users(id) on delete set null,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists monzo_oauth_states_expiry_idx on public.monzo_oauth_states (expires_at);
alter table public.monzo_oauth_states enable row level security;
alter table public.monzo_connections enable row level security;
revoke all on table public.monzo_oauth_states, public.monzo_connections from public, anon, authenticated;

create or replace function public.store_monzo_connection(
  p_workspace_id bigint,
  p_account_id text,
  p_account_name text,
  p_account_type text,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_connected_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.monzo_connections%rowtype;
  access_secret_id uuid;
  refresh_secret_id uuid;
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if nullif(trim(p_access_token), '') is null then
    raise exception 'Access token is required.' using errcode = '23514';
  end if;

  select * into existing from public.monzo_connections where workspace_id = p_workspace_id for update;
  if found then
    perform vault.update_secret(existing.access_token_secret_id, p_access_token);
    access_secret_id := existing.access_token_secret_id;
    if nullif(trim(coalesce(p_refresh_token, '')), '') is not null then
      if existing.refresh_token_secret_id is null then
        refresh_secret_id := vault.create_secret(p_refresh_token, 'kurionyx_monzo_refresh_' || p_workspace_id, 'Monzo refresh token for workspace');
      else
        perform vault.update_secret(existing.refresh_token_secret_id, p_refresh_token);
        refresh_secret_id := existing.refresh_token_secret_id;
      end if;
    else
      refresh_secret_id := existing.refresh_token_secret_id;
    end if;
  else
    access_secret_id := vault.create_secret(p_access_token, 'kurionyx_monzo_access_' || p_workspace_id, 'Monzo access token for workspace');
    if nullif(trim(coalesce(p_refresh_token, '')), '') is not null then
      refresh_secret_id := vault.create_secret(p_refresh_token, 'kurionyx_monzo_refresh_' || p_workspace_id, 'Monzo refresh token for workspace');
    end if;
  end if;

  insert into public.monzo_connections (
    workspace_id, account_id, account_name, account_type, access_token_secret_id,
    refresh_token_secret_id, token_expires_at, status, connected_by, connected_at, updated_at
  ) values (
    p_workspace_id, p_account_id, p_account_name, p_account_type, access_secret_id,
    refresh_secret_id, p_expires_at, 'connected', p_connected_by, now(), now()
  ) on conflict (workspace_id) do update set
    account_id = excluded.account_id,
    account_name = excluded.account_name,
    account_type = excluded.account_type,
    access_token_secret_id = excluded.access_token_secret_id,
    refresh_token_secret_id = excluded.refresh_token_secret_id,
    token_expires_at = excluded.token_expires_at,
    status = 'connected',
    connected_by = excluded.connected_by,
    connected_at = now(),
    updated_at = now();

  update public.workspace_integrations
  set status = 'connected', notes = 'Monzo account connected through the server-side OAuth flow.'
  where workspace_id = p_workspace_id and provider_key = 'monzo_developer_api';
end;
$$;

revoke all on function public.store_monzo_connection(bigint, text, text, text, text, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.store_monzo_connection(bigint, text, text, text, text, text, timestamptz, uuid) to service_role;
grant select, insert, update, delete on public.monzo_oauth_states to service_role;
grant select, insert, update on public.monzo_connections to service_role;
commit;
