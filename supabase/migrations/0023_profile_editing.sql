-- 0023: own profile editing; credentials remain with the Auth provider.
-- Normalize existing data, constrain fields, and grant UPDATE on two columns only.

create or replace function public.is_safe_avatar_url(value text) returns boolean
language sql immutable parallel safe as $fn$
  select value is null
     or (
       char_length(value) <= 2048
       and value = btrim(value)
       and value !~ '[[:cntrl:]]'
       and value !~* '^https?://[^/?#]*@'
       and value ~* '^https?://[^[:space:]/?#<>"''\\]+[^[:space:]<>"''\\]*$'
     );
$fn$;

comment on function public.is_safe_avatar_url(text) is
  'True for NULL or an absolute http(s) URL of at most 2048 characters with no whitespace, control or markup characters. Backs the profiles.avatar_url check.';

update public.profiles
   set display_name = coalesce(nullif(btrim(left(btrim(display_name), 80)), ''), '사용자'),
       avatar_url = case when public.is_safe_avatar_url(avatar_url) then avatar_url else null end
 where display_name is null
    or display_name <> coalesce(nullif(btrim(left(btrim(display_name), 80)), ''), '사용자')
    or not public.is_safe_avatar_url(avatar_url);

alter table public.profiles
  add constraint profiles_display_name_valid
  check (display_name is not null
         and display_name = btrim(display_name)
         and char_length(display_name) between 1 and 80) not valid;

alter table public.profiles
  add constraint profiles_avatar_url_valid
  check (public.is_safe_avatar_url(avatar_url)) not valid;

alter table public.profiles validate constraint profiles_display_name_valid;
alter table public.profiles validate constraint profiles_avatar_url_valid;

alter table public.profiles alter column display_name set not null;

create or replace function public.normalize_profile() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.display_name := btrim(new.display_name, E' \t\n\r\f\v');
  new.avatar_url := nullif(btrim(new.avatar_url), '');

  if tg_op = 'UPDATE' and auth.uid() is not null then
    if new.id is distinct from old.id then
      raise exception 'A profile id cannot be changed';
    end if;
    if new.created_at is distinct from old.created_at then
      raise exception 'A profile created_at cannot be changed';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists normalize_profile on public.profiles;
create trigger normalize_profile
  before insert or update on public.profiles
  for each row execute procedure public.normalize_profile();

create or replace function public.profile_display_name_from_signup(metadata jsonb, email text)
returns text language sql immutable parallel safe as $fn$
  with candidate as (
    select coalesce(
      nullif(btrim(case when jsonb_typeof(metadata -> 'display_name') = 'string' then metadata ->> 'display_name' end, E' \t\n\r\f\v'), ''),
      nullif(btrim(case when jsonb_typeof(metadata -> 'full_name') = 'string' then metadata ->> 'full_name' end, E' \t\n\r\f\v'), ''),
      nullif(btrim(case when jsonb_typeof(metadata -> 'name') = 'string' then metadata ->> 'name' end, E' \t\n\r\f\v'), ''),
      nullif(btrim(split_part(coalesce(email, ''), '@', 1)), ''),
      '사용자'
    ) as value
  )
  select coalesce(nullif(btrim(left(value, 80)), ''), '사용자') from candidate;
$fn$;

comment on function public.profile_display_name_from_signup(jsonb, text) is
  'Display name for a new signup: metadata display_name/full_name/name (strings only), then the email local part, then a placeholder. Always trimmed and at most 80 characters. Never reads metadata id or role.';

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    public.profile_display_name_from_signup(
      case when jsonb_typeof(new.raw_user_meta_data) = 'object' then new.raw_user_meta_data else '{}'::jsonb end,
      new.email
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop policy if exists "Users update their own profile" on public.profiles;
create policy "Users update their own profile" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

revoke update on public.profiles from authenticated;
revoke insert, delete, truncate, references, trigger on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

do $do$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    raise notice '0023: role anon is absent; nothing to revoke.';
    return;
  end if;
  execute 'revoke all on public.profiles from anon';
end;
$do$;

revoke execute on function
  public.handle_new_user(),
  public.normalize_profile(),
  public.profile_display_name_from_signup(jsonb, text),
  public.is_safe_avatar_url(text)
from public;

do $do$
declare api_role text;
begin
  foreach api_role in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format($g$revoke execute on function
          public.handle_new_user(),
          public.normalize_profile(),
          public.profile_display_name_from_signup(jsonb, text),
          public.is_safe_avatar_url(text)
        from %I$g$, api_role);
    end if;
  end loop;
end;
$do$;

grant execute on function public.is_safe_avatar_url(text) to authenticated;
