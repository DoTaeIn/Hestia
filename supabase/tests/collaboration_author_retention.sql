-- Transactional real-row check: a departed author must not erase shared edits
-- or make account deletion impossible. Run as the local database admin.
\set ON_ERROR_STOP on
begin;
do $test$
declare
  v_owner uuid := gen_random_uuid();
  v_author uuid := gen_random_uuid();
  v_workspace uuid := gen_random_uuid();
  v_page uuid := gen_random_uuid();
  v_operation uuid := gen_random_uuid();
  v_retained integer;
begin
  insert into auth.users(id, email) values
    (v_owner, 'retention-owner-' || v_owner || '@example.test'),
    (v_author, 'retention-author-' || v_author || '@example.test');
  insert into public.workspaces(id, name, slug, owner_id)
    values (v_workspace, 'Author retention test', 'retention-' || v_workspace, v_owner);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  insert into public.pages(id, workspace_id, title) values (v_page, v_workspace, 'Retention test');
  insert into public.page_collaboration_updates(operation_id, page_id, workspace_id, generation, payload, created_by)
    values (v_operation, v_page, v_workspace, 1, 'AA==', v_author);

  begin
    update public.page_collaboration_updates set created_by = null where operation_id = v_operation;
    raise exception 'Direct author mutation unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'Direct author mutation unexpectedly succeeded' then raise; end if;
    if sqlerrm not like '%append-only%' then raise; end if;
  end;

  delete from auth.users where id = v_author;
  select count(*) into v_retained from public.page_collaboration_updates
    where operation_id = v_operation and created_by is null and payload = 'AA==';
  if v_retained <> 1 then raise exception 'Author deletion did not preserve the collaboration update'; end if;

  begin
    update public.page_collaboration_updates set payload = 'AQ==' where operation_id = v_operation;
    raise exception 'Mutation unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'Mutation unexpectedly succeeded' then raise; end if;
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
  raise notice 'PASS: deleted author is null, shared payload survives, mutation remains forbidden';
end;
$test$;
rollback;
