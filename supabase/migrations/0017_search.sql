-- 검색을 DB 로 내린다. 지금까지는 워크스페이스의 모든 페이지를 브라우저로 보내
-- 클라이언트에서 includes() 로 걸렀다. 그리고 docs/WHY.md P2 — 이유도 검색 대상이 된다.
--
-- tsvector 가 아니라 pg_trgm 을 쓴다. `to_tsvector` 는 낱말 경계로 자르는데
-- 한국어는 조사가 붙어("문서를") 형태소 분석기 없이는 "문서" 로 못 찾는다.
-- 형태소 분석기 도입 여부는 아직 사람이 정하지 않은 항목이라, 그 결정을 강요하지
-- 않는 쪽을 골랐다. trigram 은 부분 문자열 매칭이라 지금 UX(includes) 와 결과가
-- 같고, 조사가 붙어도 찾는다.
-- ponytail: 대신 관련도 순위가 없다. 정렬은 문서 먼저 / 이유 나중일 뿐이다.
-- 순위가 필요해지면 그때 형태소 분석기 + tsvector 를 얹는다.
create extension if not exists pg_trgm;

-- ProseMirror JSON 에서 평문만 뽑는다. lib/pages.ts 의 documentText 와 같은 일.
-- 생성 열에 쓰려면 immutable 이어야 한다.
--
-- jsonpath `$.**.text` 를 쓰면 안 된다. lax 모드에서 `**` 는 배열을 풀어헤치면서
-- 같은 노드에 두 경로로 도달해 본문이 그대로 두 번 나온다 (실제로 겪었다).
-- `content` 배열만 따라 내려가는 재귀가 ProseMirror 구조와도 정확히 맞는다.
-- path 로 정렬해야 문서 순서가 보존된다 — 순서가 틀리면 구절 검색이 깨진다.
create function public.document_plain_text(doc jsonb) returns text
language sql immutable parallel safe as $$
  with recursive walk(node, path) as (
    select doc, array[0]
    union all
    select child.value, walk.path || child.ord::int
    from walk cross join lateral jsonb_array_elements(walk.node -> 'content') with ordinality as child(value, ord)
    where jsonb_typeof(walk.node -> 'content') = 'array'
  )
  select coalesce(string_agg(node ->> 'text', ' ' order by path), '')
  from walk
  where node ? 'text';
$$;

alter table public.pages add column search_text text
  generated always as (coalesce(title, '') || ' ' || public.document_plain_text(content)) stored;

create index pages_search_trgm_idx on public.pages using gin (search_text gin_trgm_ops);
create index page_revisions_reason_trgm_idx on public.page_revisions using gin (reason gin_trgm_ops);

-- security definer 가 아니다. 호출자 권한으로 돌아 pages·page_revisions 의 RLS 가
-- 그대로 적용된다. 검색이 권한 우회 통로가 되면 안 된다.
-- 패턴 조립을 SQL 안에서 하는 이유: 클라이언트가 `%` 를 넣어 전체를 긁어가지 못하게.
create function public.search_workspace(term text)
returns table (kind text, page_id uuid, title text, workspace_name text, snippet text, version integer)
language sql stable as $$
  with needle as (
    select '%' || replace(replace(replace(btrim(term), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  )
  select 'page', p.id, p.title, w.name, p.search_text, null::integer
  from public.pages p
  join public.workspaces w on w.id = p.workspace_id
  cross join needle
  where p.deleted_at is null and p.search_text ilike needle.pattern
  union all
  select 'reason', r.page_id, p.title, w.name, r.reason, r.version
  from public.page_revisions r
  join public.pages p on p.id = r.page_id
  join public.workspaces w on w.id = r.workspace_id
  cross join needle
  where p.deleted_at is null and r.reason ilike needle.pattern;
$$;

grant execute on function public.search_workspace(text) to authenticated;
