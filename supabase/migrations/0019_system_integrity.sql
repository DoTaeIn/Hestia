-- 0019 — system integrity: authorization repair, version/ownership enforcement,
-- append-only collaboration persistence, private Realtime policy, grant hardening.
--
-- Audited against the *effective* schema after 0001..0018, not against each
-- migration in isolation. Nothing here rewrites history; it only moves forward.
-- Implements the workspace, document and collaboration integrity boundary.
--
-- Four classes of defect are fixed:
--
--   1. `actor_role not in ('owner','admin')` is NULL — not true — when the caller
--      has no membership row. NULL is not a raise condition, so every one of the
--      0005/0006/0007 member-management RPCs let a non-member through and then ran
--      a SECURITY DEFINER write with RLS bypassed. `transfer_page_ownership` had the
--      same hole via `document_owner_id <> auth.uid()` with a NULL `auth.uid()`:
--      an anonymous caller could hand any page to any user. Guards are now explicit
--      `is null` / `coalesce` checks and every function rejects `auth.uid() is null`.
--
--   2. 0015 re-created `save_page_version` / `restore_page_revision` from the 0004
--      bodies, silently reverting the 0011 document-owner rule and the 0012/0013
--      collaboration reset. Any editor could save or restore versions, and a restore
--      left the live Yjs state and generation untouched, so every connected client
--      kept editing — and re-persisting — the pre-restore document.
--
--   3. The `pages` update grant was table-wide, so a client could PATCH
--      `content`, `title` or `document_owner_id` directly and bypass the version and
--      ownership RPCs entirely. Column grants now allow `parent_id`/`position` only.
--
--   4. `save_page_collaboration(uuid, text)` from 0011 was never dropped when 0013
--      added the generation-checked 3-arg version, leaving an overload that wrote the
--      whole document with no generation check at all. Whole-document writes are the
--      deeper problem: two partitioned clients each write a state that lacks the
--      other's edits and the later write wins. Persistence is now an append-only log
--      of opaque Yjs updates plus a conditionally seeded canonical state, and
--      *every* whole-document write path is removed rather than deprecated: a
--      compacting checkpoint has the same loss window as save (a client that merged
--      through seq 8 can replace a checkpoint that already pruned seq 9 and 10), and
--      a non-compacting one can still replace a newer canonical state with an older
--      snapshot. SQL cannot merge Yjs, so SQL must never choose between two states.
--
--   5. Supabase's bootstrap grants `EXECUTE`/`ALL` to `anon` and `authenticated`
--      *explicitly* (not only through PUBLIC), and installs default privileges that
--      repeat that for every new object. Revoking PUBLIC therefore left `anon`
--      holding its own grant on every function and table in `public`. Section 8
--      strips `anon` outright and re-grants `authenticated` column by column.
--
--   6. `pages` INSERT was only constrained by `created_by = auth.uid()` in the RLS
--      policy; `document_owner_id`, `updated_by`, `deleted_at` and `deleted_by` were
--      free-form on insert. A trigger now pins them for authenticated callers.
--
-- Functions also get `search_path = public, pg_temp`. Without pg_temp listed
-- explicitly Postgres still searches it first for *relations*, so a caller could
-- create `pg_temp.pages` and shadow the real table inside a SECURITY DEFINER body.

-- ---------------------------------------------------------------------------
-- 1. Null-safe role helpers
-- ---------------------------------------------------------------------------

-- Returns NULL for anonymous callers and non-members. Everything below compares
-- against it with explicit null handling rather than `not in`.
create or replace function public.workspace_role(target_workspace_id uuid) returns text
language sql security definer set search_path = public, pg_temp stable as $$
  select wm.role
  from public.workspace_members wm
  where wm.workspace_id = target_workspace_id
    and auth.uid() is not null
    and wm.user_id = auth.uid();
$$;

comment on function public.workspace_role(uuid) is
  'The calling user''s role in a workspace, or NULL when anonymous or not a member.';

-- Can this caller write documents in the workspace at all (membership + role)?
create or replace function public.can_edit_workspace(target_workspace_id uuid) returns boolean
language sql security definer set search_path = public, pg_temp stable as $$
  select coalesce(public.workspace_role(target_workspace_id), '') in ('owner', 'admin', 'editor');
$$;

create or replace function public.is_workspace_member(target_workspace_id uuid) returns boolean
language sql security definer set search_path = public, pg_temp stable as $$
  select public.workspace_role(target_workspace_id) is not null;
$$;

alter function public.shares_workspace_with(uuid) set search_path = public, pg_temp;
alter function public.handle_new_user() set search_path = public, pg_temp;
alter function public.add_workspace_owner() set search_path = public, pg_temp;
alter function public.validate_page_parent() set search_path = public, pg_temp;
alter function public.touch_page() set search_path = public, pg_temp;
alter function public.validate_comment_thread() set search_path = public, pg_temp;
alter function public.notify_on_comment() set search_path = public, pg_temp;
alter function public.mark_notifications_read(uuid[]) set search_path = public, pg_temp;
alter function public.trash_page(uuid) set search_path = public, pg_temp;
alter function public.restore_page(uuid) set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 2. Member management — reject NULL roles
-- ---------------------------------------------------------------------------

create or replace function public.invite_workspace_member(target_workspace_id uuid, member_email text, next_role text)
returns table(user_id uuid, display_name text, role text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor_role text;
  member_id uuid;
  existing_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  actor_role := public.workspace_role(target_workspace_id);
  if actor_role is null or actor_role not in ('owner', 'admin') then
    raise exception 'Not allowed to manage workspace members';
  end if;
  if next_role is null or next_role not in ('admin', 'editor', 'viewer') then raise exception 'Invalid workspace role'; end if;
  if next_role = 'admin' and actor_role <> 'owner' then raise exception 'Only an owner can grant administrator access'; end if;
  select id into member_id from auth.users where lower(email) = lower(btrim(member_email));
  if member_id is null then raise exception 'This email has not signed in to Hestia yet'; end if;
  select wm.role into existing_role from public.workspace_members wm
    where wm.workspace_id = target_workspace_id and wm.user_id = member_id for update;
  if actor_role = 'admin' and existing_role = 'admin' then
    raise exception 'Not allowed to manage this workspace member';
  end if;
  insert into public.workspace_members (workspace_id, user_id, role) values (target_workspace_id, member_id, next_role)
  on conflict on constraint workspace_members_pkey do update set role = excluded.role
    where public.workspace_members.role <> 'owner'
      and (actor_role = 'owner' or public.workspace_members.role <> 'admin');
  if not found then
    if actor_role = 'admin' and existing_role is distinct from 'owner' then
      raise exception 'Not allowed to manage this workspace member';
    end if;
    raise exception 'The workspace owner role cannot be changed';
  end if;
  return query select member_id, coalesce(p.display_name, member_email), next_role from public.profiles p where p.id = member_id;
end;
$$;

create or replace function public.set_workspace_member_role(target_workspace_id uuid, target_user_id uuid, next_role text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor_role text;
  target_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  actor_role := public.workspace_role(target_workspace_id);
  if actor_role is null or actor_role not in ('owner', 'admin') then
    raise exception 'Not allowed to manage workspace members';
  end if;
  select wm.role into target_role from public.workspace_members wm
   where wm.workspace_id = target_workspace_id and wm.user_id = target_user_id;
  if target_role is null then raise exception 'Workspace member was not found'; end if;
  if target_role = 'owner' then raise exception 'The workspace owner role cannot be changed'; end if;
  if next_role is null or next_role not in ('admin', 'editor', 'viewer') then raise exception 'Invalid workspace role'; end if;
  if next_role = 'admin' and actor_role <> 'owner' then raise exception 'Only an owner can grant administrator access'; end if;
  if actor_role = 'admin' and target_role = 'admin' then raise exception 'Not allowed to manage this workspace member'; end if;
  update public.workspace_members set role = next_role where workspace_id = target_workspace_id and user_id = target_user_id;
end;
$$;

create or replace function public.remove_workspace_member(target_workspace_id uuid, target_user_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor_role text;
  target_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  actor_role := public.workspace_role(target_workspace_id);
  if actor_role is null or actor_role not in ('owner', 'admin') then
    raise exception 'Not allowed to manage workspace members';
  end if;
  select wm.role into target_role from public.workspace_members wm
   where wm.workspace_id = target_workspace_id and wm.user_id = target_user_id;
  -- An absent target stays a no-op, as before: the UI treats removal as idempotent.
  if target_role is null then return; end if;
  if target_role = 'owner' or (actor_role = 'admin' and target_role = 'admin') then
    raise exception 'Not allowed to remove this workspace member';
  end if;
  delete from public.workspace_members where workspace_id = target_workspace_id and user_id = target_user_id;
end;
$$;

-- Same NULL-role shape: `created_by <> auth.uid() and actor_role not in (...)`
-- is NULL for an anonymous caller and for a non-member, so neither was rejected
-- and both could soft-delete any comment in the platform. Two separate guards are
-- needed: current membership (an author who left the workspace no longer manages
-- their comments) and a null-safe author comparison (`is distinct from`, so a NULL
-- `created_by` can never make the whole condition NULL and fall through).
create or replace function public.soft_delete_comment(target_comment_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  comment_row public.comments%rowtype;
  thread_workspace_id uuid;
  actor_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select c.* into comment_row from public.comments c where c.id = target_comment_id for update;
  if not found then raise exception 'Comment was not found'; end if;
  select t.workspace_id into thread_workspace_id from public.comment_threads t where t.id = comment_row.thread_id;
  -- Membership is required of everyone, the author included: leaving the
  -- workspace ends the right to edit its history.
  actor_role := public.workspace_role(thread_workspace_id);
  if actor_role is null then raise exception 'Not allowed to delete this comment'; end if;
  if comment_row.created_by is distinct from auth.uid()
     and coalesce(actor_role, '') not in ('owner', 'admin') then
    raise exception 'Not allowed to delete this comment';
  end if;
  if comment_row.deleted_at is null then
    update public.comments set deleted_at = now(), deleted_by = auth.uid() where id = target_comment_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Document ownership transfer
-- ---------------------------------------------------------------------------

create or replace function public.transfer_page_ownership(target_page_id uuid, next_owner_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_page public.pages%rowtype;
  next_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if next_owner_id is null then raise exception 'The next owner must be an editor in this workspace'; end if;
  select * into current_page from public.pages where id = target_page_id and deleted_at is null for update;
  if not found then raise exception 'Only the document owner can transfer ownership'; end if;
  -- The owner must still be able to edit here: an owner who was demoted to viewer
  -- or removed from the workspace no longer controls the document.
  if not public.can_edit_workspace(current_page.workspace_id) then
    raise exception 'Only the document owner can transfer ownership';
  end if;
  if current_page.document_owner_id is distinct from auth.uid() then
    raise exception 'Only the document owner can transfer ownership';
  end if;
  select wm.role into next_role from public.workspace_members wm
   where wm.workspace_id = current_page.workspace_id and wm.user_id = next_owner_id;
  if next_role is null or next_role not in ('owner', 'admin', 'editor') then
    raise exception 'The next owner must be an editor in this workspace';
  end if;
  update public.pages set document_owner_id = next_owner_id where id = target_page_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Append-only collaboration log
-- ---------------------------------------------------------------------------

-- base64 as produced by btoa(): no newlines, padded to a multiple of 4.
-- 4 MiB of base64 is ~3 MiB of Yjs binary — far above a sane single update.
create or replace function public.is_base64_payload(value text) returns boolean
language sql immutable parallel safe as $$
  select value is not null
     and length(value) between 1 and 4194304
     and length(value) % 4 = 0
     and value ~ '^[A-Za-z0-9+/]+={0,2}$';
$$;

create table if not exists public.page_collaboration_updates (
  id uuid primary key default gen_random_uuid(),
  -- client-generated; makes the append idempotent so a retry cannot duplicate
  operation_id uuid not null,
  page_id uuid not null references public.pages(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  generation integer not null,
  seq bigint not null generated always as identity,
  payload text not null check (public.is_base64_payload(payload)),
  -- Nullable + `set null`, deliberately: `on delete restrict` would make deleting
  -- a user fail (or, worse, invite a cascade) because of document deltas that the
  -- remaining members still need to reconstruct the page.
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Named, not inferred: `on conflict (…, operation_id)` inside the append
  -- function would parse `operation_id` as an expression and collide with the
  -- plpgsql parameter of the same name.
  constraint page_collaboration_updates_operation_key unique (page_id, generation, operation_id)
);

create index if not exists page_collaboration_updates_page_generation_seq_idx
  on public.page_collaboration_updates (page_id, generation, seq);

-- Append-only: a stored update is never rewritten. Deletes stay legal because the
-- page cascade and generation pruning both need them.
create or replace function public.reject_collaboration_update_mutation() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'Collaboration updates are append-only';
end;
$$;

drop trigger if exists reject_collaboration_update_mutation on public.page_collaboration_updates;
create trigger reject_collaboration_update_mutation
  before update on public.page_collaboration_updates
  for each row execute procedure public.reject_collaboration_update_mutation();

alter table public.page_collaboration_updates enable row level security;

drop policy if exists "Members can read collaboration updates" on public.page_collaboration_updates;
create policy "Members can read collaboration updates" on public.page_collaboration_updates
  for select to authenticated using (public.is_workspace_member(workspace_id));

-- Read-only to clients. Every write goes through the RPCs below, which is what
-- makes the generation fence and the member check unavoidable. Supabase's
-- default privileges hand `anon`/`authenticated` ALL on every new table, so the
-- revoke is not redundant: without it `authenticated` holds INSERT/UPDATE/DELETE
-- and only RLS stands between a client and the log.
revoke all on public.page_collaboration_updates from public;
grant select on public.page_collaboration_updates to authenticated;

do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.page_collaboration_updates from anon';
  end if;
end;
$do$;
revoke insert, update, delete, truncate, references, trigger on public.page_collaboration_updates from authenticated;

-- Take the per-page collaboration row lock, creating the row if it is missing.
--
-- `insert … on conflict do nothing` is not enough on its own: when another
-- session has inserted the same page_id but not committed, DO NOTHING skips
-- *without waiting*, and the follow-up `select … for update` still sees no row.
-- The caller would then run with a NULL collaboration row — seed would report
-- `seeded = true` while updating nothing, and restore would advance no
-- generation. DO UPDATE does wait for the other session, so the fallback below
-- always returns a locked, committed row.
--
-- Not SECURITY DEFINER: every caller is, so this runs as the owner anyway.
create or replace function public.lock_page_collaboration(target_page_id uuid, target_workspace_id uuid)
returns public.page_collaboration
language plpgsql set search_path = public, pg_temp as $$
declare collab public.page_collaboration%rowtype;
begin
  select * into collab from public.page_collaboration where page_id = target_page_id for update;
  if found then return collab; end if;

  insert into public.page_collaboration (page_id, workspace_id)
  values (target_page_id, target_workspace_id)
  on conflict (page_id) do update set workspace_id = excluded.workspace_id
  returning * into collab;
  return collab;
end;
$$;

comment on function public.lock_page_collaboration(uuid, uuid) is
  'Internal: FOR UPDATE on the page_collaboration row, creating it if absent. Not granted to any API role.';

-- Seed state + the whole delta log for the current generation. Membership is
-- enough: a viewer may follow the live document, it just cannot write to it.
create or replace function public.load_page_collaboration(target_page_id uuid)
returns table(collaboration_state text, collaboration_generation integer, should_seed boolean, latest_update_seq bigint, updates jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_page public.pages%rowtype;
  collab public.page_collaboration%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  -- Always lock the page before collaboration rows: foreign-key checks on
  -- delta inserts also touch pages, so reverse ordering can deadlock a restore.
  select * into current_page from public.pages where id = target_page_id and deleted_at is null for no key update;
  if not found or not public.is_workspace_member(current_page.workspace_id) then
    raise exception 'Not allowed to read this page';
  end if;

  -- Locked, not read: without the lock a restore can commit between reading the
  -- generation and reading the log, and the client would get generation N's
  -- seed with generation N+1's (empty) log. With it, load either runs entirely
  -- before the restore or entirely after it.
  collab := public.lock_page_collaboration(current_page.id, current_page.workspace_id);

  return query
  select
    collab.state,
    collab.generation,
    collab.state is null,
    coalesce(max(u.seq), 0),
    coalesce(
      jsonb_agg(jsonb_build_object('seq', u.seq, 'operation_id', u.operation_id, 'payload', u.payload) order by u.seq)
        filter (where u.seq is not null),
      '[]'::jsonb
    )
  from public.page_collaboration_updates u
  where u.page_id = target_page_id and u.generation = collab.generation;
end;
$$;

-- Conditional canonical initialization. The row lock is what stops two
-- concurrent initializers from each believing their own seed won.
create or replace function public.seed_page_collaboration(target_page_id uuid, seed_state text, expected_generation integer default null)
returns table(collaboration_state text, collaboration_generation integer, seeded boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_page public.pages%rowtype;
  collab public.page_collaboration%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_base64_payload(seed_state) then raise exception 'Invalid collaboration state encoding'; end if;
  -- Always lock the page before collaboration rows: foreign-key checks on
  -- delta inserts also touch pages, so reverse ordering can deadlock a restore.
  select * into current_page from public.pages where id = target_page_id and deleted_at is null for no key update;
  if not found or not public.can_edit_workspace(current_page.workspace_id) then
    raise exception 'Not allowed to collaborate on this page';
  end if;

  collab := public.lock_page_collaboration(current_page.id, current_page.workspace_id);

  if expected_generation is not null and collab.generation <> expected_generation then
    raise exception 'This document was restored. Refresh to continue editing.';
  end if;

  if collab.state is null then
    update public.page_collaboration
       set state = seed_state, updated_by = auth.uid(), updated_at = now()
     where page_id = target_page_id
    returning * into collab;
    return query select collab.state, collab.generation, true;
  else
    -- Someone else seeded first; the caller must adopt this state instead.
    return query select collab.state, collab.generation, false;
  end if;
end;
$$;

-- One opaque Yjs update. Idempotent on (page, generation, operation_id).
create or replace function public.append_page_collaboration_update(
  target_page_id uuid,
  expected_generation integer,
  operation_id uuid,
  update_payload text
)
returns table(status text, collaboration_generation integer, update_seq bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_page public.pages%rowtype;
  collab public.page_collaboration%rowtype;
  stored_seq bigint;
  stored_payload text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if operation_id is null then raise exception 'An operation id is required'; end if;
  if expected_generation is null then raise exception 'An expected generation is required'; end if;
  if not public.is_base64_payload(update_payload) then raise exception 'Invalid collaboration update encoding'; end if;
  -- Always lock the page before collaboration rows: foreign-key checks on
  -- delta inserts also touch pages, so reverse ordering can deadlock a restore.
  select * into current_page from public.pages where id = target_page_id and deleted_at is null for no key update;
  if not found or not public.can_edit_workspace(current_page.workspace_id) then
    raise exception 'Not allowed to collaborate on this page';
  end if;

  -- FOR UPDATE, not a plain read: a restore that commits first is then visible
  -- here, and a restore that commits later cannot miss this row. It also makes
  -- the appends of one page serial, which is what lets the duplicate branch
  -- below read a committed row rather than racing a speculative insert.
  collab := public.lock_page_collaboration(current_page.id, current_page.workspace_id);

  if collab.generation <> expected_generation then
    return query select 'stale_generation'::text, collab.generation, null::bigint;
    return;
  end if;

  insert into public.page_collaboration_updates (operation_id, page_id, workspace_id, generation, payload)
  values (operation_id, target_page_id, current_page.workspace_id, collab.generation, update_payload)
  on conflict on constraint page_collaboration_updates_operation_key do nothing
  returning seq into stored_seq;

  if stored_seq is null then
    select u.seq, u.payload into stored_seq, stored_payload
      from public.page_collaboration_updates u
     where u.page_id = target_page_id
       and u.generation = collab.generation
       and u.operation_id = append_page_collaboration_update.operation_id;
    if stored_seq is null then
      -- The unique constraint fired but the row is not readable. Nothing was
      -- stored under this call, so it must not be reported as success.
      raise exception 'This update could not be stored. Retry with the same operation id.';
    end if;
    -- `duplicate` is the client's licence to drop the outbox entry, so it may
    -- only be returned when the stored bytes are the bytes that were sent.
    -- Reusing an operation id for different content is a client bug, not a
    -- retry, and silently acknowledging it would lose that update.
    if stored_payload is distinct from update_payload then
      raise exception 'This operation id was already used for a different update';
    end if;
    return query select 'duplicate'::text, collab.generation, stored_seq;
    return;
  end if;

  return query select 'appended'::text, collab.generation, stored_seq;
end;
$$;

-- No compaction in this release, and no whole-document write path of any kind.
--
-- A compacting checkpoint is unsafe for the same reason `save` was. Client A
-- merges through seq 10, checkpoints and prunes <= 10. Client B, which loaded
-- through seq 8, checkpoints a moment later: its state does not contain seq 9
-- and 10, those rows are already gone, and the edits are lost for good — both
-- calls passed the generation check, because a restore never happened. Passing
-- `merged_through_seq => 0` only narrows the window: the later caller still
-- replaces a canonical state that may already have absorbed (and pruned) deltas
-- the caller never saw. The database cannot merge two Yjs states, so it must
-- never be asked to pick one; the only safe compaction needs a persisted
-- watermark and a compare-and-set on the base checkpoint, which is deferred
-- rather than shipped half-proven.
--
-- Consequence, stated plainly: the delta log for a generation only shrinks on
-- restore. See §6 of the contract.
drop function if exists public.checkpoint_page_collaboration(uuid, integer, text, bigint);

-- Tombstones for the two shipped-client entry points. They are kept (rather than
-- dropped) so an old tab gets one deterministic, actionable error instead of
-- PostgREST's 404 for a missing function. The message is deliberately *not* the
-- stale-generation message: this is not recoverable by retrying.
--
-- `initialize_page_collaboration` was read-only, but it cannot stay functional:
-- it returns the canonical state without the delta log, so an old tab would
-- render a document missing every appended edit and let the user type into it.
-- Failing at load is the honest outcome.
create or replace function public.initialize_page_collaboration(target_page_id uuid)
returns table(collaboration_state text, should_seed boolean, collaboration_generation integer)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception 'Hestia was updated. Reload this page to keep editing.'
    using hint = 'initialize_page_collaboration was removed in 0019: it does not return the append-only update log. Use load_page_collaboration.';
end;
$$;

create or replace function public.save_page_collaboration(target_page_id uuid, next_state text, expected_generation integer)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception 'Hestia was updated. Reload this page to keep editing.'
    using hint = 'save_page_collaboration was removed in 0019: a whole-document write overwrites concurrent edits. Use seed_page_collaboration and append_page_collaboration_update.';
end;
$$;

-- The 0011 overload never checked the generation at all. 0013 added the 3-arg
-- form with `create or replace`, which left this one in place as a bypass.
drop function if exists public.save_page_collaboration(uuid, text);

comment on function public.initialize_page_collaboration(uuid) is
  'REMOVED in 0019 (raises upgrade-required). Use load_page_collaboration.';
comment on function public.save_page_collaboration(uuid, text, integer) is
  'REMOVED in 0019 (raises upgrade-required). Use seed_page_collaboration / append_page_collaboration_update.';

-- ---------------------------------------------------------------------------
-- 5. Version save / restore — document owner, on the server
-- ---------------------------------------------------------------------------

-- The UI has always gated both on `page.document_owner_id === currentUserId`.
-- That policy is preserved and now enforced here, plus the workspace edit
-- capability the shared contract requires even of document owners.
create or replace function public.save_page_version(target_page_id uuid, next_title text, next_content jsonb, change_reason text default null)
returns public.page_revisions language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_page public.pages%rowtype;
  new_revision public.page_revisions%rowtype;
  next_version integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into current_page from public.pages where id = target_page_id and deleted_at is null for update;
  if not found or not public.can_edit_workspace(current_page.workspace_id) then
    raise exception 'Not allowed to save this page';
  end if;
  if current_page.document_owner_id is distinct from auth.uid() then
    raise exception 'Only the document owner can save a version';
  end if;

  update public.pages set title = next_title, content = next_content, updated_at = now(), updated_by = auth.uid()
   where id = target_page_id;
  select coalesce(max(version), 0) + 1 into next_version from public.page_revisions where page_id = target_page_id;
  insert into public.page_revisions (page_id, workspace_id, version, title, content, reason)
  values (target_page_id, current_page.workspace_id, next_version, next_title, next_content, nullif(btrim(change_reason), ''))
  returning * into new_revision;
  return new_revision;
end;
$$;

-- Restores the snapshot, appends the restore as a new revision (0015's reason is
-- preserved), clears the live collaboration state and advances the generation so
-- every connected client is fenced out — all under the page row lock, as 0012 and
-- 0013 intended before 0015 reverted it.
create or replace function public.restore_page_revision(target_page_id uuid, source_revision_id uuid, change_reason text default null)
returns public.page_revisions language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_page public.pages%rowtype;
  source_revision public.page_revisions%rowtype;
  restored_revision public.page_revisions%rowtype;
  next_version integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  -- Lock the page first so saves and restores always allocate versions in order.
  -- Lock order across the whole schema is pages -> page_collaboration.
  select * into current_page from public.pages where id = target_page_id and deleted_at is null for update;
  if not found or not public.can_edit_workspace(current_page.workspace_id) then
    raise exception 'Not allowed to restore this page';
  end if;
  if current_page.document_owner_id is distinct from auth.uid() then
    raise exception 'Only the document owner can restore a version';
  end if;

  select * into source_revision from public.page_revisions
   where id = source_revision_id and page_id = target_page_id and workspace_id = current_page.workspace_id;
  if not found then raise exception 'Revision not found'; end if;

  update public.pages set title = source_revision.title, content = source_revision.content
   where id = target_page_id;

  -- Through the helper, so a collaboration row that another session created but
  -- has not committed is waited for instead of skipped. `do nothing` plus a
  -- blind UPDATE could match zero rows here and leave the generation — the only
  -- fence that stops connected clients from re-persisting the pre-restore
  -- document — unchanged.
  perform public.lock_page_collaboration(current_page.id, current_page.workspace_id);
  update public.page_collaboration
     set state = null, generation = generation + 1, updated_by = auth.uid(), updated_at = now()
   where page_id = target_page_id;
  -- Every delta belongs to a generation that no longer exists.
  delete from public.page_collaboration_updates where page_id = target_page_id;

  select coalesce(max(version), 0) + 1 into next_version from public.page_revisions where page_id = target_page_id;
  insert into public.page_revisions (page_id, workspace_id, version, title, content, reason)
  values (target_page_id, current_page.workspace_id, next_version, source_revision.title, source_revision.content, nullif(btrim(change_reason), ''))
  returning * into restored_revision;
  return restored_revision;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Close the direct-write bypass on pages
-- ---------------------------------------------------------------------------

-- 0002 granted table-wide UPDATE, so `PATCH /pages?id=eq.…` with a `content`,
-- `title` or `document_owner_id` body went straight past save_page_version and
-- transfer_page_ownership (the RLS policy only asks for edit capability).
-- Tree moves are the only direct update the client actually performs.
revoke update on public.pages from authenticated;
grant update (parent_id, position) on public.pages to authenticated;

-- INSERT was only half-constrained: the 0002 policy pins `created_by` but says
-- nothing about `document_owner_id`, `updated_by`, `deleted_at` or `deleted_by`,
-- all of which are plain insertable columns. A client could therefore create a
-- page owned by somebody else (that user, not the author, then controls versions
-- and receives its comment notifications), stamp a false `updated_by`, or insert
-- a page that is already in the trash.
--
-- A column grant cannot express this — `insert (…)` would also forbid the
-- *defaults* from being used by name — so it is a trigger. It only overrides
-- what the app never sets: `SpaceHome` inserts (id, workspace_id, title,
-- content) and nothing else, so every allowed insert is unaffected.
--
-- Scoped to callers that have an identity. A migration, a seed script or a
-- service_role request has `auth.uid() is null`, must be able to backfill
-- authorship explicitly, and is not a client.
create or replace function public.enforce_page_insert_ownership() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return new; end if;
  new.created_by := auth.uid();
  new.updated_by := auth.uid();
  new.document_owner_id := auth.uid();
  new.deleted_at := null;
  new.deleted_by := null;
  return new;
end;
$$;

drop trigger if exists enforce_page_insert_ownership on public.pages;
create trigger enforce_page_insert_ownership
  before insert on public.pages
  for each row execute procedure public.enforce_page_insert_ownership();

-- ---------------------------------------------------------------------------
-- 7. Private Realtime policy for page:<uuid>
-- ---------------------------------------------------------------------------

-- Parse defensively: anything that is not exactly `page:` + a UUID yields NULL,
-- which matches no page, so the policies fail closed instead of erroring.
create or replace function public.page_topic_page_id(topic text) returns uuid
language sql immutable parallel safe as $$
  select case
    when topic ~ '^page:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then substring(topic from 6)::uuid
  end;
$$;

-- Receive: any workspace member, viewers included.
create or replace function public.can_read_page_topic(topic text) returns boolean
language sql security definer set search_path = public, pg_temp stable as $$
  select exists (
    select 1
    from public.pages p
    where p.id = public.page_topic_page_id(topic)
      and public.is_workspace_member(p.workspace_id)
  );
$$;

-- Send: current edit capability, and not a trashed page.
create or replace function public.can_write_page_topic(topic text) returns boolean
language sql security definer set search_path = public, pg_temp stable as $$
  select exists (
    select 1
    from public.pages p
    where p.id = public.page_topic_page_id(topic)
      and p.deleted_at is null
      and public.can_edit_workspace(p.workspace_id)
  );
$$;

-- Not attempted here: filtering a broadcast by the `generation` inside its
-- payload. Realtime authorizes a client's broadcast by rehearsing an INSERT on
-- realtime.messages with the topic set, and the policy therefore cannot depend
-- on content the sender has not sent through this table. A stale tab can still
-- *broadcast* an update tagged with an old generation; what it cannot do is
-- persist it (append_page_collaboration_update returns `stale_generation`).
-- Receivers must drop any payload whose generation differs from theirs — that
-- is a client obligation, stated in the contract, not a server control.
comment on function public.can_read_page_topic(text) is
  'Realtime authorization for private topic page:<uuid> — SELECT on realtime.messages (receive).';
comment on function public.can_write_page_topic(text) is
  'Realtime authorization for private topic page:<uuid> — INSERT on realtime.messages (send).';

do $do$
begin
  if to_regclass('realtime.messages') is null then
    raise notice '0019: realtime.messages is absent; page topic policies were not created. Re-run on a database with Realtime.';
    return;
  end if;

  -- Realtime ships with RLS already on; only touch it if it is not, so the
  -- migration does not need table ownership in the normal case.
  if not (select c.relrowsecurity from pg_class c where c.oid = 'realtime.messages'::regclass) then
    execute 'alter table realtime.messages enable row level security';
  end if;

  execute 'drop policy if exists "Hestia members receive page topics" on realtime.messages';
  execute $p$
    create policy "Hestia members receive page topics" on realtime.messages
      for select to authenticated
      using (public.can_read_page_topic(realtime.topic()))
  $p$;

  execute 'drop policy if exists "Hestia editors send page topics" on realtime.messages';
  execute $p$
    create policy "Hestia editors send page topics" on realtime.messages
      for insert to authenticated
      with check (public.can_write_page_topic(realtime.topic()))
  $p$;

  -- Realtime normally grants these already; only fill a gap, never assume.
  if not has_table_privilege('authenticated', 'realtime.messages', 'select') then
    execute 'grant select on table realtime.messages to authenticated';
  end if;
  if not has_table_privilege('authenticated', 'realtime.messages', 'insert') then
    execute 'grant insert on table realtime.messages to authenticated';
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- 8. Grants: functions are EXECUTE-to-PUBLIC by default
-- ---------------------------------------------------------------------------

-- Every SECURITY DEFINER function above was callable by `anon` through the
-- PostgreSQL default `EXECUTE` grant to PUBLIC, which is exactly how an
-- anonymous caller reached the NULL-role holes. Drop PUBLIC, then grant back
-- only what the `authenticated` role must be able to call. Trigger functions get
-- nothing: a trigger function cannot be invoked directly and its EXECUTE
-- privilege is checked at CREATE TRIGGER time, not when the trigger fires.
--
-- Revoking PUBLIC is necessary but *not* sufficient, and the first cut of this
-- migration got that wrong. Supabase's bootstrap grants EXECUTE to `anon` and
-- `authenticated` by name, so `anon` kept its own grant and reached these
-- bodies anyway — it was stopped only by the `auth.uid() is null` checks, one
-- layer instead of two. Section 8b strips `anon` by name.
revoke execute on function
  public.handle_new_user(),
  public.add_workspace_owner(),
  public.validate_page_parent(),
  public.touch_page(),
  public.validate_comment_thread(),
  public.notify_on_comment(),
  public.reject_collaboration_update_mutation(),
  public.enforce_page_insert_ownership(),
  public.lock_page_collaboration(uuid, uuid),
  public.is_workspace_member(uuid),
  public.can_edit_workspace(uuid),
  public.workspace_role(uuid),
  public.shares_workspace_with(uuid),
  public.document_plain_text(jsonb),
  public.is_base64_payload(text),
  public.page_topic_page_id(text),
  public.can_read_page_topic(text),
  public.can_write_page_topic(text),
  public.search_workspace(text),
  public.trash_page(uuid),
  public.restore_page(uuid),
  public.soft_delete_comment(uuid),
  public.mark_notifications_read(uuid[]),
  public.invite_workspace_member(uuid, text, text),
  public.set_workspace_member_role(uuid, uuid, text),
  public.remove_workspace_member(uuid, uuid),
  public.transfer_page_ownership(uuid, uuid),
  public.save_page_version(uuid, text, jsonb, text),
  public.restore_page_revision(uuid, uuid, text),
  public.initialize_page_collaboration(uuid),
  public.load_page_collaboration(uuid),
  public.seed_page_collaboration(uuid, text, integer),
  public.append_page_collaboration_update(uuid, integer, uuid, text),
  public.save_page_collaboration(uuid, text, integer)
from public, authenticated;

-- Helpers the authenticated role evaluates itself: RLS policy predicates, and
-- the immutable text extractor behind the pages.search_text generated column.
grant execute on function
  public.is_workspace_member(uuid),
  public.can_edit_workspace(uuid),
  public.workspace_role(uuid),
  public.shares_workspace_with(uuid),
  public.document_plain_text(jsonb),
  public.is_base64_payload(text),
  public.page_topic_page_id(text),
  public.can_read_page_topic(text),
  public.can_write_page_topic(text),
  public.search_workspace(text)
to authenticated;

grant execute on function
  public.trash_page(uuid),
  public.restore_page(uuid),
  public.soft_delete_comment(uuid),
  public.mark_notifications_read(uuid[]),
  public.invite_workspace_member(uuid, text, text),
  public.set_workspace_member_role(uuid, uuid, text),
  public.remove_workspace_member(uuid, uuid),
  public.transfer_page_ownership(uuid, uuid),
  public.save_page_version(uuid, text, jsonb, text),
  public.restore_page_revision(uuid, uuid, text),
  public.initialize_page_collaboration(uuid),
  public.load_page_collaboration(uuid),
  public.seed_page_collaboration(uuid, text, integer),
  public.append_page_collaboration_update(uuid, integer, uuid, text),
  public.save_page_collaboration(uuid, text, integer)
to authenticated;

-- Schema grants: the API roles need USAGE and nothing else. CREATE in `public`
-- for an API role would let a client plant objects the Data API may expose.
do $do$
declare api_role text;
begin
  revoke create on schema public from public;
  foreach api_role in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format('grant usage on schema public to %I', api_role);
      execute format('revoke create on schema public from %I', api_role);
    end if;
  end loop;
end;
$do$;

-- ---------------------------------------------------------------------------
-- 8b. `anon` keeps nothing in public, and `authenticated` keeps an allowlist
-- ---------------------------------------------------------------------------

-- Hestia has no anonymous surface: `middleware.ts` sends every unauthenticated
-- request to /login, and sign-in itself talks to GoTrue, not to PostgREST. The
-- anon key must therefore reach no table and no function here. Today RLS stops
-- it anyway (no policy mentions `anon`), but "the row filter happened to return
-- nothing" is a weaker statement than "the role cannot execute this", and it is
-- the statement the contract makes.
do $do$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    raise notice '0019: role anon is absent; nothing to revoke.';
    return;
  end if;
  execute 'revoke all on all tables in schema public from anon';
  execute 'revoke all on all sequences in schema public from anon';
  execute 'revoke all on all functions in schema public from anon';
  execute 'grant usage on schema public to anon';
end;
$do$;

-- …and the same for objects created later, where it is allowed. Default
-- privileges belong to the role that creates the object, so this only covers
-- grantors the migration can speak for; it is best effort and announces what it
-- could not do rather than pretending.
do $do$
declare grantor text;
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then return; end if;
  foreach grantor in array array['postgres', 'supabase_admin', current_user]
  loop
    if exists (select 1 from pg_roles where rolname = grantor) and pg_has_role(current_user, grantor, 'member') then
      execute format('alter default privileges for role %I in schema public revoke all on tables from anon', grantor);
      execute format('alter default privileges for role %I in schema public revoke all on sequences from anon', grantor);
      execute format('alter default privileges for role %I in schema public revoke all on functions from anon', grantor);
    else
      raise notice '0019: cannot alter default privileges for role % (not a member); new objects may still be granted to anon.', grantor;
    end if;
  end loop;
end;
$do$;

-- `authenticated` is pruned the same way, because the same bootstrap handed it
-- ALL on every table. This is not theoretical: `page_revisions` carries an
-- UPDATE policy from 0016 ("Editors can fill in a revision reason") and the
-- table-wide UPDATE grant from the Supabase defaults, so until now an editor
-- could PATCH a revision's `content` and rewrite document history — the column
-- grant in 0016 added `reason` to a privilege set that already included
-- everything. Every grant below matches a write the client actually performs:
--
--   workspaces       insert   app/onboarding/actions.ts
--   pages            insert   app/space/SpaceHome.tsx (columns pinned by trigger)
--   pages            update   Workbench.moveTo / SpaceHome reorder (2 columns)
--   page_revisions   update   Workbench reason editor (1 column)
--   comment_threads  insert   Doc.tsx
--   comments         insert   Doc.tsx
--   profiles         update   own row, RLS-pinned (0001)
--
-- Everything else is read-only to clients and moves through a SECURITY DEFINER
-- RPC, which runs as the owner and is unaffected by these grants.
do $do$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('revoke all on public.%I from authenticated', t.relname);
  end loop;
end;
$do$;

grant select on public.profiles, public.workspaces, public.workspace_members,
                public.pages, public.page_revisions, public.comment_threads,
                public.comments, public.notifications, public.page_collaboration,
                public.page_collaboration_updates
  to authenticated;

grant insert on public.workspaces, public.pages, public.comment_threads, public.comments to authenticated;
grant update on public.profiles to authenticated;
grant update (parent_id, position) on public.pages to authenticated;
grant update (reason) on public.page_revisions to authenticated;
