-- Service-role-only helpers for reading and rotating Monzo credentials stored
-- in Vault. Browser roles never receive tokens or direct table access.
begin;
select pg_advisory_xact_lock(hashtext('kurionyx:monzo_bank_read_api'));

create or replace function public.get_monzo_connection_for_sync(p_workspace_id bigint)
returns table (account_id text, account_name text, account_type text, access_token text,
  refresh_token text, token_expires_at timestamptz, status text)
language sql security definer set search_path = '' as $$
  select connection.account_id, connection.account_name, connection.account_type,
         access_secret.decrypted_secret, refresh_secret.decrypted_secret,
         connection.token_expires_at, connection.status
  from public.monzo_connections as connection
  join vault.decrypted_secrets as access_secret on access_secret.id = connection.access_token_secret_id
  left join vault.decrypted_secrets as refresh_secret on refresh_secret.id = connection.refresh_token_secret_id
  where connection.workspace_id = p_workspace_id;
$$;

create or replace function public.rotate_monzo_connection_tokens(
  p_workspace_id bigint, p_access_token text, p_refresh_token text, p_expires_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare connection public.monzo_connections%rowtype;
begin
  select * into connection from public.monzo_connections where workspace_id = p_workspace_id for update;
  if not found then raise exception 'Monzo connection not found.' using errcode = 'P0002'; end if;
  if nullif(trim(p_access_token), '') is null then
    raise exception 'Access token is required.' using errcode = '23514';
  end if;
  perform vault.update_secret(connection.access_token_secret_id, p_access_token);
  if nullif(trim(coalesce(p_refresh_token, '')), '') is not null then
    if connection.refresh_token_secret_id is null then
      connection.refresh_token_secret_id := vault.create_secret(p_refresh_token,
        'kurionyx_monzo_refresh_' || p_workspace_id, 'Monzo refresh token for workspace');
    else
      perform vault.update_secret(connection.refresh_token_secret_id, p_refresh_token);
    end if;
  end if;
  update public.monzo_connections
  set refresh_token_secret_id = connection.refresh_token_secret_id, token_expires_at = p_expires_at,
      status = 'connected', updated_at = now()
  where workspace_id = p_workspace_id;
end;
$$;

create or replace function public.set_monzo_connection_sync_state(
  p_workspace_id bigint, p_status text, p_synced boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('connected', 'reauthorisation_required', 'disconnected') then
    raise exception 'Invalid Monzo connection status.' using errcode = '23514';
  end if;
  update public.monzo_connections
  set status = p_status, last_synced_at = case when p_synced then now() else last_synced_at end,
      updated_at = now()
  where workspace_id = p_workspace_id;
  update public.workspace_integrations
  set status = p_status,
      notes = case p_status when 'connected' then 'Monzo Business is connected securely.'
        when 'reauthorisation_required' then 'Monzo requires the owner to reconnect the business account.'
        else 'Monzo is disconnected.' end
  where workspace_id = p_workspace_id and provider_key = 'monzo_developer_api';
end;
$$;

revoke all on function public.get_monzo_connection_for_sync(bigint) from public, anon, authenticated;
revoke all on function public.rotate_monzo_connection_tokens(bigint, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.set_monzo_connection_sync_state(bigint, text, boolean) from public, anon, authenticated;
grant execute on function public.get_monzo_connection_for_sync(bigint) to service_role;
grant execute on function public.rotate_monzo_connection_tokens(bigint, text, text, timestamptz) to service_role;
grant execute on function public.set_monzo_connection_sync_state(bigint, text, boolean) to service_role;
commit;
