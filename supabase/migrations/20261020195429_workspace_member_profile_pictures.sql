-- Private, user-managed profile pictures for workspace members.
-- Additive only: existing memberships and display names are preserved.

begin;

select pg_advisory_xact_lock(hashtext('kurionyx:workspace_member_profile_pictures'));

do $$
begin
  if to_regclass('public.workspace_members') is null then
    raise exception 'workspace_members is required before applying profile pictures.';
  end if;
end $$;

alter table public.workspace_members add column if not exists avatar_path text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workspace_members_avatar_path_length_check' and conrelid = 'public.workspace_members'::regclass) then
    alter table public.workspace_members add constraint workspace_members_avatar_path_length_check
      check (avatar_path is null or char_length(avatar_path) between 10 and 500);
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-pictures', 'profile-pictures', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "Workspace members can read profile pictures" on storage.objects for select to authenticated
using (bucket_id = 'profile-pictures' and (storage.foldername(name))[1] ~ '^[0-9]+$' and exists (
  select 1 from public.workspace_members member where member.workspace_id = ((storage.foldername(name))[1])::bigint and member.user_id = (select auth.uid())
));

create policy "Users can upload their own profile picture" on storage.objects for insert to authenticated
with check (bucket_id = 'profile-pictures' and (storage.foldername(name))[1] ~ '^[0-9]+$'
  and (storage.foldername(name))[2] = (select auth.uid())::text and exists (
    select 1 from public.workspace_members member where member.workspace_id = ((storage.foldername(name))[1])::bigint and member.user_id = (select auth.uid())
  ));

create policy "Users can delete their own profile picture" on storage.objects for delete to authenticated
using (bucket_id = 'profile-pictures' and (storage.foldername(name))[1] ~ '^[0-9]+$'
  and (storage.foldername(name))[2] = (select auth.uid())::text and exists (
    select 1 from public.workspace_members member where member.workspace_id = ((storage.foldername(name))[1])::bigint and member.user_id = (select auth.uid())
  ));

create or replace function public.set_my_workspace_avatar(p_workspace_id bigint, p_avatar_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := auth.uid();
  expected_prefix text;
begin
  if current_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  expected_prefix := p_workspace_id::text || '/' || current_user_id::text || '/';
  if p_avatar_path is null or char_length(p_avatar_path) > 500 or left(p_avatar_path, char_length(expected_prefix)) <> expected_prefix then
    raise exception 'Invalid profile picture path.' using errcode = '22023';
  end if;
  update public.workspace_members set avatar_path = p_avatar_path
  where workspace_id = p_workspace_id and user_id = current_user_id;
  if not found then raise exception 'Workspace access required.' using errcode = '42501'; end if;
end;
$$;

revoke all on function public.set_my_workspace_avatar(bigint, text) from public, anon;
grant execute on function public.set_my_workspace_avatar(bigint, text) to authenticated;

drop function if exists public.list_workspace_members(bigint);
create function public.list_workspace_members(p_workspace_id bigint)
returns table (user_id uuid, display_name text, email text, role text, joined_at timestamptz, avatar_path text)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.workspace_members current_member
    where current_member.workspace_id = p_workspace_id and current_member.user_id = auth.uid()
  ) then raise exception 'Workspace access required.' using errcode = '42501'; end if;
  return query select member.user_id, member.display_name::text, coalesce(account.email, '')::text, member.role::text,
    member.created_at, member.avatar_path
  from public.workspace_members member left join auth.users account on account.id = member.user_id
  where member.workspace_id = p_workspace_id order by member.created_at;
end;
$$;

revoke all on function public.list_workspace_members(bigint) from public, anon;
grant execute on function public.list_workspace_members(bigint) to authenticated;

commit;
