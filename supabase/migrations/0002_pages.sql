alter table public.workspace_members drop constraint workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check check (role in ('owner', 'admin', 'editor', 'viewer'));

create function public.can_edit_workspace(target_workspace_id uuid) returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id and user_id = auth.uid()
      and role in ('owner', 'admin', 'editor')
  );
$$;

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  parent_id uuid references public.pages(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 240),
  content jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  position bigint not null default 0,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  updated_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pages_workspace_parent_position_idx on public.pages (workspace_id, parent_id, position, created_at);

create function public.validate_page_parent() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from public.pages where id = new.parent_id and workspace_id = new.workspace_id
  ) then
    raise exception 'A page parent must belong to the same workspace';
  end if;
  return new;
end;
$$;

create function public.touch_page() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

create trigger validate_page_parent before insert or update of parent_id, workspace_id on public.pages for each row execute procedure public.validate_page_parent();
create trigger touch_page before update on public.pages for each row execute procedure public.touch_page();

alter table public.pages enable row level security;

create policy "Members can read pages" on public.pages for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "Editors can create pages" on public.pages for insert to authenticated with check (public.can_edit_workspace(workspace_id) and created_by = auth.uid());
create policy "Editors can update pages" on public.pages for update to authenticated using (public.can_edit_workspace(workspace_id)) with check (public.can_edit_workspace(workspace_id));
create policy "Editors can delete pages" on public.pages for delete to authenticated using (public.can_edit_workspace(workspace_id));

grant select, insert, update, delete on public.pages to authenticated;
