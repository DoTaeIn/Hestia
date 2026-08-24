create or replace function public.invite_workspace_member(target_workspace_id uuid, member_email text, next_role text)
returns table(user_id uuid, display_name text, role text)
language plpgsql security definer set search_path = public as $$
declare
  actor_role text;
  member_id uuid;
begin
  select wm.role into actor_role from public.workspace_members wm where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid();
  if actor_role not in ('owner', 'admin') then raise exception 'Not allowed to manage workspace members'; end if;
  if next_role not in ('admin', 'editor', 'viewer') then raise exception 'Invalid workspace role'; end if;
  if next_role = 'admin' and actor_role <> 'owner' then raise exception 'Only an owner can grant administrator access'; end if;
  select id into member_id from auth.users where lower(email) = lower(trim(member_email));
  if member_id is null then raise exception 'This email has not signed in to Hestia yet'; end if;
  insert into public.workspace_members (workspace_id, user_id, role) values (target_workspace_id, member_id, next_role)
  on conflict on constraint workspace_members_pkey do update set role = excluded.role where public.workspace_members.role <> 'owner';
  if not found then raise exception 'The workspace owner role cannot be changed'; end if;
  return query select member_id, coalesce(p.display_name, member_email), next_role from public.profiles p where p.id = member_id;
end;
$$;
