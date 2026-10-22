-- Read-only launch check; run as database administrator after numbered migrations.
-- No user data, token or key is returned. This does not configure hosted Auth/Realtime.
begin read only;
do $$
declare relation text;
begin
 if coalesce((select max(version) from supabase_migrations.schema_migrations),'') < '0026' then raise exception 'Apply migrations through 0026'; end if;
 foreach relation in array array['profiles','workspaces','workspace_members','pages','page_revisions','page_collaboration','page_collaboration_updates','comment_threads','comments','notifications','workspace_roles','workspace_security_events'] loop
  if not coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.'||relation)),false) then raise exception 'RLS missing: %',relation; end if;
  if has_table_privilege('anon','public.'||relation,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Anonymous table grants remain: %',relation; end if;
 end loop;
 if has_table_privilege('authenticated','public.workspace_members','INSERT,UPDATE,DELETE') or has_table_privilege('authenticated','public.workspace_roles','INSERT,UPDATE,DELETE') or has_table_privilege('authenticated','public.workspace_security_events','INSERT,UPDATE,DELETE') then raise exception 'Direct role/audit writes are granted'; end if;
 if has_function_privilege('anon','public.session_is_allowed()','execute') or has_function_privilege('authenticated','public.prune_workspace_security_events(timestamptz)','execute') then raise exception 'Security helper ACL is unsafe'; end if;
 if to_regclass('auth.mfa_factors') is null then raise exception 'Auth MFA schema is missing'; end if;
 if not exists(select 1 from storage.buckets where id='page-images' and not public and file_size_limit <= 20971520 and allowed_mime_types <@ array['image/jpeg','image/png','image/gif','image/webp']::text[]) then raise exception 'Private image bucket/MIME policy is missing'; end if;
 raise notice 'DB launch checks passed. Verify Auth provider settings and private Realtime in the dashboard separately.';
end;
$$;
rollback;
