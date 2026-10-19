-- Ensure every expression returned by the workspace member RPC matches the
-- declared table shape. auth.users.email may be varchar on hosted projects.

begin;

select pg_advisory_xact_lock(hashtext('kurionyx:fix_workspace_member_list_types'));

create or replace function public.list_workspace_members(p_workspace_id bigint)
returns table (
  user_id uuid,
  display_name text,
  email text,
  role text,
  joined_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.workspace_members as current_member
    where current_member.workspace_id = p_workspace_id
      and current_member.user_id = auth.uid()
  ) then
    raise exception 'Workspace access required.' using errcode = '42501';
  end if;

  return query
  select
    member.user_id,
    member.display_name::text,
    coalesce(account.email, '')::text,
    member.role::text,
    member.created_at
  from public.workspace_members as member
  left join auth.users as account on account.id = member.user_id
  where member.workspace_id = p_workspace_id
  order by member.created_at;
end;
$$;

revoke all on function public.list_workspace_members(bigint) from public, anon;
grant execute on function public.list_workspace_members(bigint) to authenticated;

commit;
