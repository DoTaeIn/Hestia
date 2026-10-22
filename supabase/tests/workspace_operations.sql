-- Regression coverage for 0020_workspace_operations.sql: the two-argument
-- search_workspace(term, target_workspace_id) overload and the
-- move_page_before(target_page_id, before_page_id) reorder RPC.
--
-- Role simulation: this database has no PostgREST in front of it, so each
-- "as <user>" block does what PostgREST itself does on every request —
-- `set local role <authenticated|anon>` (so grants and `to authenticated`/
-- `to anon` RLS policies are actually evaluated instead of bypassed by a
-- superuser) plus `set_config('request.jwt.claims', ..., true)` (so
-- auth.uid() resolves the simulated caller via the `sub` claim). Both are
-- transaction-local and vanish at the final `rollback`, same as every
-- fixture row inserted below. Fixture UUIDs all use the `00000020-` prefix
-- (this migration's number) to avoid colliding with other test files'
-- fixtures; ground-truth row checks after an expected failure run back under
-- the superuser role so RLS cannot mask a real mutation as "no visible rows".
create extension if not exists pgtap;

begin;

select plan(23);

-- ===========================================================================
-- Fixtures
-- ===========================================================================

insert into auth.users (id, email) values
  ('00000020-b000-4000-8000-000000000001', 'wsops-owner@test.hestia'),
  ('00000020-b000-4000-8000-000000000002', 'wsops-editor@test.hestia'),
  ('00000020-b000-4000-8000-000000000003', 'wsops-viewer@test.hestia'),
  ('00000020-b000-4000-8000-000000000004', 'wsops-nonmember@test.hestia'),
  ('00000020-b000-4000-8000-000000000005', 'wsops-ownerb@test.hestia'),
  ('00000020-b000-4000-8000-000000000006', 'wsops-ownerc@test.hestia');

-- WS_A and WS_C deliberately share a display name: search must scope by
-- workspace_id, never by workspace_name.
insert into public.workspaces (id, name, slug, owner_id) values
  ('00000020-a000-4000-8000-000000000001', 'WSOps Alpha', 'wsops-alpha', '00000020-b000-4000-8000-000000000001'),
  ('00000020-a000-4000-8000-000000000002', 'WSOps Beta', 'wsops-beta', '00000020-b000-4000-8000-000000000005'),
  ('00000020-a000-4000-8000-000000000003', 'WSOps Alpha', 'wsops-alpha-dup', '00000020-b000-4000-8000-000000000006');

-- on_workspace_created already added each owner above as role 'owner'.
insert into public.workspace_members (workspace_id, user_id, role) values
  ('00000020-a000-4000-8000-000000000001', '00000020-b000-4000-8000-000000000002', 'editor'),
  ('00000020-a000-4000-8000-000000000001', '00000020-b000-4000-8000-000000000003', 'viewer');

insert into public.pages (id, workspace_id, parent_id, title, position, created_by, updated_by, document_owner_id) values
  ('00000020-c000-4000-8000-000000000001', '00000020-a000-4000-8000-000000000001', null, 'Quarterly 90% Review', 1024, '00000020-b000-4000-8000-000000000001', '00000020-b000-4000-8000-000000000001', '00000020-b000-4000-8000-000000000001'),
  ('00000020-c000-4000-8000-000000000002', '00000020-a000-4000-8000-000000000001', null, 'Budget plan_v1 notes', 2048, '00000020-b000-4000-8000-000000000001', '00000020-b000-4000-8000-000000000001', '00000020-b000-4000-8000-000000000001'),
  ('00000020-c000-4000-8000-000000000003', '00000020-a000-4000-8000-000000000001', '00000020-c000-4000-8000-000000000001', 'Review detail', 1024, '00000020-b000-4000-8000-000000000001', '00000020-b000-4000-8000-000000000001', '00000020-b000-4000-8000-000000000001'),
  ('00000020-c000-4000-8000-000000000007', '00000020-a000-4000-8000-000000000001', '00000020-c000-4000-8000-000000000003', 'Grandchild notes', 1024, '00000020-b000-4000-8000-000000000001', '00000020-b000-4000-8000-000000000001', '00000020-b000-4000-8000-000000000001'),
  ('00000020-c000-4000-8000-000000000005', '00000020-a000-4000-8000-000000000002', null, 'Beta doc', 1024, '00000020-b000-4000-8000-000000000005', '00000020-b000-4000-8000-000000000005', '00000020-b000-4000-8000-000000000005'),
  ('00000020-c000-4000-8000-000000000006', '00000020-a000-4000-8000-000000000003', null, 'Quarterly 90% Review', 1024, '00000020-b000-4000-8000-000000000006', '00000020-b000-4000-8000-000000000006', '00000020-b000-4000-8000-000000000006');

-- A trashed page, used to prove move_page_before rejects an inactive anchor
-- (the cycle trigger alone does not check deleted_at).
insert into public.pages (id, workspace_id, parent_id, title, position, created_by, updated_by, document_owner_id, deleted_at, deleted_by) values
  ('00000020-c000-4000-8000-000000000004', '00000020-a000-4000-8000-000000000001', null, 'Old draft', 3072, '00000020-b000-4000-8000-000000000001', '00000020-b000-4000-8000-000000000001', '00000020-b000-4000-8000-000000000001', now(), '00000020-b000-4000-8000-000000000001');

-- Same reason text in WS_A and in the same-named WS_C, to prove reason
-- search is also scoped by workspace_id.
insert into public.page_revisions (page_id, workspace_id, version, title, content, reason, created_by) values
  ('00000020-c000-4000-8000-000000000001', '00000020-a000-4000-8000-000000000001', 1, 'Quarterly 90% Review', '{"type":"doc","content":[]}'::jsonb, 'rolled back budget_cap 20%', '00000020-b000-4000-8000-000000000001'),
  ('00000020-c000-4000-8000-000000000006', '00000020-a000-4000-8000-000000000003', 1, 'Quarterly 90% Review', '{"type":"doc","content":[]}'::jsonb, 'rolled back budget_cap 20%', '00000020-b000-4000-8000-000000000006');

-- ===========================================================================
-- search_workspace(term, target_workspace_id)
-- ===========================================================================

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000020-b000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$ select * from public.search_workspace('90%') $$,
  'legacy one-argument search_workspace(term) overload still resolves without ambiguity'
);

select is(
  (select count(*) from public.search_workspace('90%', '00000020-a000-4000-8000-000000000001'::uuid)),
  1::bigint,
  'workspace-scoped search for a literal percent term matches only the same-workspace page, not an identically named page in another workspace'
);

select is(
  (select page_id from public.search_workspace('90%', '00000020-a000-4000-8000-000000000001'::uuid) limit 1),
  '00000020-c000-4000-8000-000000000001'::uuid,
  'the literal-percent match is the expected page in the selected workspace'
);

select is(
  (select count(*) from public.search_workspace('plan_v1', '00000020-a000-4000-8000-000000000001'::uuid)),
  1::bigint,
  'workspace-scoped search for a literal underscore term matches the expected page'
);

select results_eq(
  $$ select kind, page_id, version from public.search_workspace('budget_cap 20%', '00000020-a000-4000-8000-000000000001'::uuid) $$,
  $$ values ('reason'::text, '00000020-c000-4000-8000-000000000001'::uuid, 1) $$,
  'reason search for a literal percent/underscore term is scoped to the selected workspace, not an identical reason in a same-named workspace'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000020-b000-4000-8000-000000000005","role":"authenticated"}', true);

select is(
  (select count(*) from public.search_workspace('budget_cap 20%', '00000020-a000-4000-8000-000000000002'::uuid)),
  0::bigint,
  'a reason that exists verbatim in another workspace does not leak into this workspace''s scoped search'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000020-b000-4000-8000-000000000003","role":"authenticated"}', true);

select is(
  (select count(*) from public.search_workspace('90%', '00000020-a000-4000-8000-000000000001'::uuid)),
  1::bigint,
  'a viewer can still search their own workspace (read access, not edit access)'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000020-b000-4000-8000-000000000004","role":"authenticated"}', true);

select is(
  (select count(*) from public.search_workspace('90%', '00000020-a000-4000-8000-000000000001'::uuid)),
  0::bigint,
  'a signed-in non-member gets zero rows from RLS rather than another workspace''s data'
);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_like(
  $$ select * from public.search_workspace('90%', '00000020-a000-4000-8000-000000000001'::uuid) $$,
  '%permission denied%',
  'anonymous callers cannot execute search_workspace at all (PUBLIC/anon execute revoked)'
);

-- ===========================================================================
-- move_page_before(target_page_id, before_page_id)
-- ===========================================================================

select throws_like(
  $$ select public.move_page_before('00000020-c000-4000-8000-000000000002'::uuid, '00000020-c000-4000-8000-000000000001'::uuid) $$,
  '%permission denied%',
  'anonymous callers cannot execute move_page_before at all'
);

set local role authenticated;
select set_config('request.jwt.claims', '{}', true);

select throws_like(
  $$ select public.move_page_before('00000020-c000-4000-8000-000000000002'::uuid, '00000020-c000-4000-8000-000000000001'::uuid) $$,
  '%Authentication required%',
  'a request with no subject claim is rejected explicitly rather than silently no-op''ing'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000020-b000-4000-8000-000000000003","role":"authenticated"}', true);

select throws_like(
  $$ select public.move_page_before('00000020-c000-4000-8000-000000000002'::uuid, '00000020-c000-4000-8000-000000000001'::uuid) $$,
  '%Not allowed to reorder%',
  'a viewer cannot reorder pages'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000020-b000-4000-8000-000000000004","role":"authenticated"}', true);

select throws_like(
  $$ select public.move_page_before('00000020-c000-4000-8000-000000000002'::uuid, '00000020-c000-4000-8000-000000000001'::uuid) $$,
  '%Not allowed to reorder%',
  'a non-member cannot reorder pages in a workspace they do not belong to'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000020-b000-4000-8000-000000000001","role":"authenticated"}', true);

select throws_like(
  $$ select public.move_page_before('00000020-c000-4000-8000-000000000001'::uuid, '00000020-c000-4000-8000-000000000001'::uuid) $$,
  '%cannot be moved before itself%',
  'a page cannot be moved before itself'
);

select throws_like(
  $$ select public.move_page_before('00000020-c000-4000-8000-000000000001'::uuid, '00000020-c000-4000-8000-000000000004'::uuid) $$,
  '%reference page was not found%',
  'a trashed page cannot be used as the reorder anchor'
);

-- Owner of WS_A (the anchor's workspace) dragging a page that belongs to
-- WS_B — can_edit_workspace passes on WS_A, so the mismatch is caught by the
-- explicit same-workspace check on the dragged page, not by authorization.
select throws_like(
  $$ select public.move_page_before('00000020-c000-4000-8000-000000000005'::uuid, '00000020-c000-4000-8000-000000000001'::uuid) $$,
  '%same workspace%',
  'pages from different workspaces cannot be reordered against each other'
);

reset role;
select set_config('request.jwt.claims', '', true);

select results_eq(
  $$ select workspace_id, parent_id, position from public.pages where id = '00000020-c000-4000-8000-000000000005'::uuid $$,
  $$ values ('00000020-a000-4000-8000-000000000002'::uuid, null::uuid, 1024::bigint) $$,
  'the failed cross-workspace attempt left the other workspace''s page completely untouched'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000020-b000-4000-8000-000000000001","role":"authenticated"}', true);

-- Moving the root page to anchor on its own grandchild would set its
-- parent_id to the grandchild's parent (the child) — a descendant of itself.
select throws_like(
  $$ select public.move_page_before('00000020-c000-4000-8000-000000000001'::uuid, '00000020-c000-4000-8000-000000000007'::uuid) $$,
  '%descendant%',
  'a page cannot be moved to a position under one of its own descendants'
);

reset role;
select set_config('request.jwt.claims', '', true);

select results_eq(
  $$ select parent_id, position from public.pages where id = '00000020-c000-4000-8000-000000000001'::uuid $$,
  $$ values (null::uuid, 1024::bigint) $$,
  'the rejected descendant move left the dragged page''s parent and position unchanged'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000020-b000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$ select public.move_page_before('00000020-c000-4000-8000-000000000002'::uuid, '00000020-c000-4000-8000-000000000001'::uuid) $$,
  'an owner can reorder two root-level siblings in one call'
);

reset role;
select set_config('request.jwt.claims', '', true);

select ok(
  (select position from public.pages where id = '00000020-c000-4000-8000-000000000002'::uuid)
    < (select position from public.pages where id = '00000020-c000-4000-8000-000000000001'::uuid),
  'after the reorder, the moved page sorts before its former predecessor by position'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000020-b000-4000-8000-000000000002","role":"authenticated"}', true);

select lives_ok(
  $$ select public.move_page_before('00000020-c000-4000-8000-000000000003'::uuid, '00000020-c000-4000-8000-000000000002'::uuid) $$,
  'an editor (not just the owner) can move a page into a new parent and position in one call'
);

reset role;
select set_config('request.jwt.claims', '', true);

select is(
  (select parent_id from public.pages where id = '00000020-c000-4000-8000-000000000003'::uuid),
  null::uuid,
  'the moved page now shares its new sibling''s (root) parent instead of its old one'
);

select * from finish();

rollback;
