# Hestia — 문서 협업 SaaS

> 상태: **구현 진행 중** · 최종 수정: 2026-08-16
> 이 문서는 다른 에이전트가 읽는 스펙이다. **코드와 어긋나면 코드가 옳다.** 어긋난 걸 발견하면 여기를 고친다.

---

## 0. 개요

| 항목 | 내용 |
| --- | --- |
| 프로젝트명 | Hestia (저장소 폴더명은 `Confluence` 그대로) |
| 형태 | **불특정 다수 대상 SaaS** — 외부 고객사가 직접 가입해 각자 워크스페이스를 만든다 (확정 2026-08-16). 사내 위키가 아니다 |
| 목표 | 워크스페이스–페이지 계층 구조 기반의 문서 작성·공유·검색 플랫폼 |
| 벤치마크 | Atlassian Confluence, Notion |
| Positioning | **"왜"를 1급 시민으로** — [WHY.md](WHY.md) 참조 |

### Positioning

버전이 텍스트가 아니라 **이유**를 보존한다. 본문이 지워져도 왜 지웠는지는 남고, 그 이유는 검색되고 링크된다.
Notion·Confluence의 가치 제안은 "마찰 없는 작성"이라 저장 시 이유를 묻는 선택을 구조적으로 못 한다.
설계·단계·폐기 기준은 [WHY.md](WHY.md) 에 있다. **아직 미구현이다.**

---

## 1. 실제 스택

| 영역 | 실제 |
| --- | --- |
| 웹 | Next.js 15 App Router + React 19 (`app/`) |
| 에디터 | TipTap 3 (`@tiptap/react`, starter-kit, table, image, placeholder) |
| 동시 편집 | **Yjs + `@tiptap/extension-collaboration`** — Supabase Realtime 로 awareness/update 중계 |
| 백엔드 | **Supabase** — Postgres + Auth + Storage + Realtime. 별도 API 서버 없음 |
| 권한 | Postgres RLS + `security definer` RPC. 판정은 전부 DB 안에서 |
| 파일 | Supabase Storage 버킷 `page-images` (RLS 정책으로 워크스페이스 격리) |
| 스타일 | 순수 CSS (`globals.css`, `sections.css`, `tool.css`). Tailwind 없음 |
| 상태 | React 내장. TanStack Query·Zustand 없음 |

**없는 것:** NestJS, S3, Redis, Elasticsearch, Tailwind, 편집 락.
이전 판 기획서에 위 항목들이 적혀 있었으나 전부 채택되지 않았다.

---

## 2. 데이터 모델 (실제 스키마)

```
profiles            id, display_name, ...
workspaces          id, name, ...
workspace_members   workspace_id, user_id, role(owner|admin|editor|viewer)
pages               id, workspace_id, parent_id, title, content(jsonb),
                    position, created_by, updated_by, deleted_at, deleted_by
page_revisions      id, page_id, workspace_id, version, title, content,
                    created_by, created_at        ← 이유 칸이 없다 (WHY.md P0)
page_collaboration  Yjs 문서 상태
comments            0008
notifications       0014
storage.objects     버킷 page-images
```

권한은 별도 `permissions` 테이블이 아니라 **워크스페이스 멤버십 역할 하나**로 판정한다.
`is_workspace_member()` / `can_edit_workspace()` 두 함수를 모든 RLS 정책과 RPC가 공유한다.
팀(Group) 테이블 없음. 페이지 단위 권한 오버라이드 없음.

주요 RPC: `save_page_version`, `restore_page_revision`, `restore_page`,
`invite_workspace_member`, `set_workspace_member_role`, `mark_notifications_read`.

마이그레이션은 `supabase/migrations/` 에 번호순으로 누적한다. 기존 파일을 고치지 않고 새 번호를 붙인다.

---

## 3. 현재 구현 상태

- [x] 인증 (Supabase Auth, 이메일 + OAuth 콜백 `app/auth/callback`)
- [x] 워크스페이스 생성·온보딩·초대·역할 변경
- [x] 페이지 CRUD, `parent_id` 트리, `position` 정렬, 휴지통(soft delete + 복원)
- [x] TipTap 에디터 (표·이미지·코드블록)
- [x] 이미지 업로드 (Supabase Storage)
- [x] 버전 저장·목록·복원
- [x] 댓글, 알림
- [x] 실시간 동시 편집 (Yjs)
- [x] 검색 서버 이관 — pg_trgm GIN + `search_workspace` RPC (`0017`). 옛 구현은 모든 페이지를 브라우저로 보내 `includes()` 로 걸렀다
- [x] 변경 이유 P0 ([WHY.md](WHY.md)) — `page_revisions.reason`, RPC `change_reason`, 이력 표시, 복원 시 입력
- [x] 변경 이유 P1 — 제목 변경·문단 삭제 감지 시 묻기(건너뛰기 가능), 지난 판에 나중에 채우기
- [x] 변경 이유 P2 — 이유가 검색 대상, 문서마다 "이 문서가 지금 모습이 된 이유들"
- [x] `0015`~`0018` 로컬 적용·검증 (2026-08-16) — RLS 누수 없음, `%` 이스케이프 동작, trigram 인덱스 사용 확인
- [x] **테넌트 격리 구멍 하나 막음** (`0018`) — `profiles` 가 `using (true)` 라 로그인한 누구나 전체 사용자 목록(= 이메일)을 읽었다. 사내 위키였을 땐 맞는 정책, SaaS 가 되면서 누수
- [ ] 원격 Supabase 프로젝트 link + 적용 — `supabase/.temp` 에 project-ref 가 없어 `db push` 는 아직 대상이 없다

---

## 4. 다음 할 일

1. 앱을 띄워 이유 흐름을 손으로 한 번 통과 — 저장 시 모달, 복원 시 입력, 이력에서 나중에 채우기, 검색에서 "변경 이유" 결과
2. 원격 Supabase 프로젝트 link 후 마이그레이션 적용 (사람이 승인할 일)
3. **폐기 기준 측정** — 실사용 2주 뒤 이유 입력률. [WHY.md](WHY.md) §4

---

## 5. 미정 (사람이 정한다)

- 과금 **숫자** — 무료 한도 N 명, 시트 단가, 플랜 이름. 모델은 확정([PRODUCT.md](../PRODUCT.md) 테넌시와 과금), 숫자만 미정
- 셀프서브 온보딩 — 워크스페이스 생성은 되지만 **팀원 초대가 막혀 있다**. `invite_workspace_member` 가 이미 가입한 이메일만 받아서 "초대하고 시작"이 불가능하다
- 배포 환경 — [DEPLOYMENT.md](DEPLOYMENT.md) 참조
- 한국어 검색 형태소 분석 도입 여부 — **더 이상 막고 있지 않다.** pg_trgm 이 조사 붙은 말도 찾는다. 관련도 순위가 필요해지면 그때 결정한다 ([WHY.md](WHY.md) 검색 이관 항목)

---

## 6. 기술적 리스크

| 리스크 | 영향 | 대응 |
| --- | --- | --- |
| 검색 SQL 미검증 | 높음 | `db push` 후 §4의 2번을 실제로 확인. 특히 RLS 누수 |
| 검색 관련도 순위 없음 | 중간 | trigram 의 대가. 문서가 많아져 순위가 필요해지면 형태소 분석기 + tsvector |
| 에디터 종속성 | 높음 | 본문은 ProseMirror JSON. 변환 레이어를 분리해 둘 것 |
| 권한 검증 누락 | 높음 | RLS 를 유일한 경계로 유지. 클라이언트 숨김은 UX 용도일 뿐 |
| 이유 입력 마찰 | 높음 | WHY.md §4 의 폐기 기준 |
| 버전 스토리지 증가 | 중간 | 델타 저장 전환, 보관 정책 |
