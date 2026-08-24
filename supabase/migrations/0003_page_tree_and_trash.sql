alter table public.pages add column deleted_at timestamptz;
alter table public.pages add column deleted_by uuid references auth.users(id) on delete set null;

create index pages_workspace_deleted_idx on public.pages (workspace_id, deleted_at, updated_at desc);

create or replace function public.validate_page_parent() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id = new.id then
    raise exception 'A page cannot be its own parent';
  end if;
  if new.parent_id is not null and not exists (
    select 1 from public.pages where id = new.parent_id and workspace_id = new.workspace_id
  ) then
    raise exception 'A page parent must belong to the same workspace';
  end if;
  if new.parent_id is not null and exists (
    with recursive descendants as (
      select id from public.pages where id = new.id
      union all
      select page.id from public.pages page join descendants on page.parent_id = descendants.id
    ) select 1 from descendants where id = new.parent_id
  ) then
    raise exception 'A page cannot move below one of its descendants';
  end if;
  return new;
end;
$$;

create or replace function public.trash_page(target_page_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare target_workspace_id uuid;
begin
  select workspace_id into target_workspace_id from public.pages where id = target_page_id;
  if target_workspace_id is null or not public.can_edit_workspace(target_workspace_id) then
    raise exception 'Not allowed to trash this page';
  end if;
  with recursive subtree as (
    select id from public.pages where id = target_page_id
    union all
    select page.id from public.pages page join subtree on page.parent_id = subtree.id
  )
  update public.pages set deleted_at = now(), deleted_by = auth.uid() where id in (select id from subtree) and deleted_at is null;
end;
$$;

create or replace function public.restore_page(target_page_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare target_workspace_id uuid;
begin
  select workspace_id into target_workspace_id from public.pages where id = target_page_id;
  if target_workspace_id is null or not public.can_edit_workspace(target_workspace_id) then
    raise exception 'Not allowed to restore this page';
  end if;
  with recursive subtree as (
    select id from public.pages where id = target_page_id
    union all
    select page.id from public.pages page join subtree on page.parent_id = subtree.id
  )
  update public.pages set deleted_at = null, deleted_by = null where id in (select id from subtree);
end;
$$;

drop policy "Editors can delete pages" on public.pages;
revoke delete on public.pages from authenticated;
grant execute on function public.trash_page(uuid), public.restore_page(uuid) to authenticated;
