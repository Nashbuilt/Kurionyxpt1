-- Human-readable application labels for the two existing Kurionyx accounts.
-- These labels do not establish legal ownership, directorship or banking authority.

begin;

select pg_advisory_xact_lock(hashtext('kurionyx:workspace_member_display_names'));

do $$
begin
  if to_regclass('public.workspace_members') is null then
    raise exception 'workspace_members is required before applying display names.'
      using hint = 'Apply the repository migrations in order before continuing.';
  end if;
end $$;

alter table public.workspace_members
  add column if not exists display_name text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'workspace_members_display_name_length_check'
      and conrelid = 'public.workspace_members'::regclass
  ) then
    alter table public.workspace_members
      add constraint workspace_members_display_name_length_check
      check (char_length(display_name) <= 120);
  end if;
end $$;

update public.workspace_members
set display_name = case user_id
  when 'a4e71697-51d1-4866-9cde-542abcceab90'::uuid then 'Nyasha'
  when '2f3afed4-7020-465e-9926-84503f793fa2'::uuid then 'Jonathan'
  else display_name
end
where user_id in (
  'a4e71697-51d1-4866-9cde-542abcceab90'::uuid,
  '2f3afed4-7020-465e-9926-84503f793fa2'::uuid
);

drop function if exists public.list_workspace_members(bigint);
create function public.list_workspace_members(p_workspace_id bigint)
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
  select member.user_id, member.display_name, coalesce(account.email, ''), member.role, member.created_at
  from public.workspace_members as member
  left join auth.users as account on account.id = member.user_id
  where member.workspace_id = p_workspace_id
  order by member.created_at;
end;
$$;

revoke all on function public.list_workspace_members(bigint) from public, anon;
grant execute on function public.list_workspace_members(bigint) to authenticated;

commit;
