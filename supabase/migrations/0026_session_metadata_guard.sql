-- Relationship helper is also callable directly through RPC. Do not reveal
-- membership relationships to a TOTP-enrolled account at aal1.
create or replace function public.shares_workspace_with(target_user_id uuid) returns boolean
language sql security definer set search_path = public, pg_temp stable as $$
  select public.session_is_allowed() and exists (
    select 1 from public.workspace_members mine
    join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
    where mine.user_id = auth.uid() and theirs.user_id = target_user_id
  );
$$;
revoke execute on function public.shares_workspace_with(uuid) from public, anon;
grant execute on function public.shares_workspace_with(uuid) to authenticated;
