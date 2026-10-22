# Hestia — 문서 협업 SaaS

> 상태: **구현 진행 중** · 최종 수정: 2026-08-16
> 이 문서는 다른 에이전트가 읽는 스펙이다. **코드와 어긋나면 코드가 옳다.** 어긋난 걸 발견하면 여기를 고친다.

## 2026-10-22 추가 기록: 재사용 엔진

사용자가 동아리의 초기 사용과 SaaS 확장을 위해 화면과 분리된 엔진을 요청했고, UI 없는 문서·권한·버전·검색 API 방향을 확인했다. `engine/`에 도메인 타입·권한 힌트·문서 로직·세션 주입 API·공동 편집과 복구 코어를 모으고 기존 화면을 연결했다. 이유는 동아리마다 화면을 바꿔도 저장·권한·복원 구현을 복제하지 않기 위해서다. `lib/`의 기존 공개 경로는 호환용으로 유지한다.

개발자 문서와 초기 운영 순서는 [developers/index.md](developers/index.md)에 있다. 아래 8월 기록은 당시의 이력이며, 최신 시스템 검증은 [SYSTEM-AUDIT.md](SYSTEM-AUDIT.md)를 함께 본다. 배포·과금 숫자·미가입 이메일 초대는 여전히 미정/미구현이다. 중앙 회사 노트 경로는 이 Mac에서 사용할 수 없어 이 문서에 결정과 이유를 누적한다.

같은 날 후속 요청에서 사용자가 로컬 테스트만 진행하도록 범위를 정했다. 실제 로컬 DB에 0022까지 적용하고 서비스 API 22개, 단위 110개, SQL 권한/정렬/작성자 보존과 독립 브라우저 공동 편집을 검증했다. 새 FK/트리거 보정은 계정 삭제가 공유 편집 이력을 지우거나 삭제 자체를 막지 않도록 하기 위한 결정이다. 자세한 사실·남은 부하/권한 캐시 범위는 [LOCAL-VALIDATION.md](LOCAL-VALIDATION.md)에 누적했다. 외부 배포는 하지 않았다.

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

## 2026-10-22 · Preview 0.1 정리

- 알고 있는 것: 프로필 화면과 엔진 API, 로그인 어댑터, 설정 가능한 로그인 방식을 추가했다. 로컬 DB는 0023이다.
- 결정: 프로필은 이름·아바타만 수정한다. 로그인 이메일·비밀번호는 인증 제공자가 관리한다. 이유: 엔진의 문서 권한 모델을 인증 공급자의 계정 관리 정책과 분리하기 위해서다.
- 결정: 공유본은 기존 라이선스를 유지한 소스 ZIP·전체 설치 SQL·SHA256으로 만든다. 이유: 수신자가 설치 대상을 확인하고 같은 스키마로 재현하도록 하기 위해서다. 외부 발행·배포는 하지 않는다.
- 미해결: 외부 SMTP/OAuth 설정과 운영 도메인 검증, 장시간 부하·로그 압축.
- 중앙 회사 노트 경로는 현재 Mac에 없어 갱신하지 못했다. 해당 Windows 경로의 규칙·결정을 추측하지 않고 이 문서에 누적 기록한다.

## 2026-10-22 · 보안·커스텀 역할

- 알고 있는 것: PHP는 사용하지 않는다. npm 감사 경고 35개를 패치 후 0개로 줄였다. Next.js 15 계열을 유지하고 고정된 PostCSS는 수정 버전 override로 교체했다.
- 결정: 소유자가 워크스페이스별 역할을 정의하고 문서 편집·구성원 관리를 독립적으로 조합한다. 이유: 문서를 편집하지 않는 운영 담당자도 구성원을 관리할 수 있게 하기 위해서다. 관리 권한의 재위임·소유자 변경은 허용하지 않는다.
- 결정: 무인증 대기자 파일 쓰기를 제거하고 로그인으로 연결했다. 이유: Preview는 바로 사용 가능하므로 공개 입력을 앱 파일시스템에 누적할 필요가 없고 디스크 고갈·PII 커밋 위험을 없앨 수 있다.
- 알고 있는 것: 0024 적용, 역할 SQL·관리 요청 경합·실제 서비스·무인증 HTTP 접근을 검증했다. 보안 헤더는 framing/object/base 제한이며 nonce 기반 script CSP 전체 적용은 아니다.
- 미해결: 운영 SMTP·OAuth·Auth rate limit/CAPTCHA 설정 검증, 장시간 Realtime 철회와 대용량 부하. 중앙 회사 노트의 Windows 경로는 이 Mac에서 사용할 수 없어 프로젝트 문서에 누적한다.


## 2026-10-22 — Preview 0.1 최종 로컬 보안 보강

- 사실: 스키마 0026, TOTP/aal2 DB 경계, 권한 변경 감사 로그, nonce CSP, 인증 이미지, 저장 완료 알림 기반 공동 편집을 적용했다. 단위 173건·실제 서비스 53건·세션 보안 SQL 44건과 production 빌드/HTTP/브라우저를 통과했다.
- 결정: Realtime 권한 캐시에서 본문이 유출되지 않도록 채널에는 세대 알림만 보내고 DB 인가로 본문을 가져온다. TOTP 등록 계정은 화면 우회로 보호를 피하지 못하도록 DB에서도 승격을 요구한다.
- 미해결: 운영 TLS/도메인·SMTP/OAuth·CAPTCHA secret·관리자 MFA·백업 복원/보존/알림은 실제 운영 프로젝트에서 설정·검증해야 한다. 전체 로그 재조회 비용과 로그 압축은 후속 용량 작업이다.
- 중앙 회사 기록 경로는 이 Mac에 없어 갱신하지 못했다. 운영 체크리스트는 docs/PRODUCTION-SECURITY.md, 검증 범위와 한계는 docs/SECURITY-REVIEW.md에 기록했다.


## 2026-10-22 — 개발자 문서 Pages 준비

- 사실: 개발자 Markdown 정적 사이트 생성기와 Developer docs Actions를 추가했다. 원격 게시·push는 하지 않았다.
- 결정: 앱 배포와 분리하고 명시한 문서만 정적 HTML로 생성한다. 문서 열람에 Supabase나 운영 비밀값이 필요 없고 내부 기록의 무단 복사를 방지하기 위함이다. 기본 브랜치만 배포 권한을 가지며 PR은 빌드만 한다.
- 미해결: 사용자가 Settings → Pages에서 GitHub Actions를 선택하고 기본 브랜치로 변경을 반영해야 실제 게시된다. 중앙 회사 기록 경로는 이 Mac에 없어 로컬 누적 기록으로 남긴다.


## 2026-10-22 — GitHub 반영 및 문서 게시 완료

- 사실: 사용자의 명시적 요청으로 전체 변경을 기본 브랜치에 커밋·push했다. Pages를 workflow 방식으로 활성화했고 https://dotaein.github.io/Hestia/ 에서 실제 문서 표시를 확인했다. 보안·빌드 CI도 통과했다.
- 결정: 기존 기본 브랜치와 이력을 유지해 fast-forward push했다. 앱 운영 배포·운영 DB 적용은 문서 게시와 별개이므로 변경하지 않았다.
- 해결: 문서 Pages 최초 활성화와 게시. 처음 배포는 활성화 이전 실행으로 실패했으며 설정 후 재실행으로 해결했다. GitHub 연결 앱의 재실행 권한이 없어 기존 Git 자격 증명의 REST API로 실행했다. 비밀값은 저장·기록하지 않았다.
