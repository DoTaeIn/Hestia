# Hestia — 사내 위키/문서 협업 플랫폼 기획서

> Confluence 형태의 문서 협업 시스템 구축을 위한 초기 기획 문서.
> 상태: **기획 단계 (Draft)** · 최종 수정: 2026-08-08

---

## 0. 개요

| 항목 | 내용 |
| --- | --- |
| 프로젝트명 | Hestia |
| 목표 | 스페이스–페이지 계층 구조 기반의 문서 작성·공유·검색 플랫폼 |
| 벤치마크 | Atlassian Confluence, Notion |
| 범위 (1차) | MVP 5대 기능 (에디터 / 계층 구조 / 권한 / 버전 / 검색) |
| 범위 제외 (1차) | 실시간 동시 편집(CRDT), 댓글 스레드, 매크로 플러그인 시스템 |

---

## 1. 필수 핵심 기능 (MVP)

개발 착수 전 반드시 확정되어야 할 5가지 기능.

### 1.1 리치 텍스트 에디터
마크다운 입력, 표, 이미지 첨부가 가능한 문서 작성 도구.

- 마크다운 단축 입력 (`#`, `-`, `>`, ` ``` ` 등)
- 표 삽입 및 셀 병합
- 이미지 드래그 앤 드롭 업로드 / 붙여넣기 업로드
- 코드 블록 (문법 하이라이팅)
- 문서 본문은 **구조화된 JSON(ProseMirror 문서 스키마)** 으로 저장하고, 검색 색인용 평문(plain text)을 별도 컬럼에 함께 보관

### 1.2 계층형 문서 구조
스페이스(프로젝트 단위)와 그 하위의 트리(Tree) 형태 페이지 구조.

- 스페이스: 팀·프로젝트 단위의 최상위 컨테이너
- 페이지: `parent_id` 를 통한 자기참조 트리, 무제한 depth
- 형제 페이지 간 정렬 순서(`position`) 유지, 드래그로 이동/재정렬
- 페이지 이동 시 하위 트리 전체가 함께 이동

### 1.3 권한 관리 (RBAC)
사용자·팀 단위로 읽기 / 쓰기 / 수정 권한 제어.

| 역할 | 권한 |
| --- | --- |
| Admin | 스페이스 설정, 권한 부여, 삭제 |
| Editor | 페이지 생성·수정·삭제 |
| Commenter | 읽기 + 댓글 (2차 범위) |
| Viewer | 읽기 전용 |

- 권한 부여 대상: 개인(User) 또는 팀(Group)
- 기본 상속 단위는 **스페이스**, 페이지 단위 개별 오버라이드 허용
- 권한 판정은 항상 서버(API 레이어)에서 수행 — 프론트엔드 숨김 처리는 UX 용도일 뿐 보안 경계가 아님

### 1.4 버전 관리 (히스토리)
누가 언제 문서를 수정했는지 기록하고 되돌리는 기능.

- 저장 시마다 스냅샷 1건 생성 (`page_versions`)
- 버전 목록: 수정자, 시각, 변경 요약
- 두 버전 간 diff 보기
- 특정 버전으로 복원 (복원 자체도 새 버전으로 기록 — 이력은 파괴하지 않음)
- 스토리지 절감이 필요해지면 N번째마다 전체 스냅샷 + 그 사이는 델타 저장 방식으로 전환

### 1.5 검색
제목뿐 아니라 본문까지 찾아내는 풀텍스트 검색.

- 제목 / 본문 / 첨부파일명 대상
- 스페이스·작성자·기간 필터
- 결과 하이라이팅 스니펫
- **1차: PostgreSQL Full-Text Search 로 시작 → 데이터 증가 시 Elasticsearch 로 이관** (아래 6장 참고)
- 한국어 형태소 분석 필요 (Nori / mecab-ko)

---

## 2. 프론트엔드

복잡한 UI 상태(트리 구조, 에디터 상태)를 다뤄야 하므로 모던 프레임워크를 사용한다.

| 영역 | 후보 | 권장 |
| --- | --- | --- |
| 웹 프레임워크 | React, Vue.js, Next.js | **Next.js** (App Router) — SEO·초기 로딩 속도 |
| 에디터 | TipTap, Quill, Editor.js, CKEditor | **TipTap** — ProseMirror 기반, 커스터마이징 유연, 추후 Yjs 연동으로 동시 편집 확장 가능 |
| UI 컴포넌트 | Tailwind CSS, MUI, Ant Design | **Tailwind CSS + shadcn/ui** |
| 서버 상태 | TanStack Query | 캐싱·낙관적 업데이트 |
| 클라이언트 상태 | Zustand | 트리 펼침 상태, 에디터 UI 상태 |

**에디터 선택이 가장 되돌리기 어려운 결정이다.** 문서 저장 포맷이 에디터에 종속되므로, 착수 전 프로토타입으로 표·이미지·마크다운 입력을 반드시 검증할 것.

---

## 3. 백엔드

트래픽, 비즈니스 로직, 권한 검증을 처리하는 API 서버.

### 3.1 서버 프레임워크

| 언어 환경 | 후보 |
| --- | --- |
| Node.js | **NestJS** (구조화된 모듈·DI, 권장) / Express |
| Python | Django / FastAPI |
| Java·Kotlin | Spring Boot (엔터프라이즈에서 가장 널리 사용) |

> 권장: 프론트와 언어를 통일할 수 있는 **NestJS**. 단, 팀이 이미 익숙한 스택이 있다면 그쪽을 우선한다.

### 3.2 인증 및 보안
- JWT 기반 로그인 유지 (Access Token 단기 + Refresh Token 회전)
- Refresh Token 은 httpOnly·Secure 쿠키로 전달
- OAuth 2.0 소셜 로그인 (Google / GitHub)
- 모든 API 요청에서 리소스 단위 권한 재검증
- 첨부파일은 S3 Pre-signed URL 로 접근 제어 (버킷 공개 금지)

### 3.3 실시간 동시 편집 (선택 / 고급)
여러 명이 동시에 편집하려면 WebSocket(Socket.io) 통신과 CRDT 또는 OT 알고리즘이 필요하다.

- **1차 릴리스에서는 문서 잠금(Lock) 방식으로 대체한다.**
  - 편집 진입 시 소프트 락 획득, TTL 만료 시 자동 해제
  - 다른 사용자에게 "OOO님이 편집 중" 표시
- 2차 확장: TipTap + **Yjs(CRDT)** + `y-websocket`
  - TipTap 을 1차부터 선택하는 이유가 여기 있다 — 에디터 교체 없이 확장 가능

---

## 4. 데이터베이스 및 스토리지

| 구분 | 선택 | 용도 |
| --- | --- | --- |
| 메인 RDBMS | **PostgreSQL** | 사용자, 문서 메타데이터, 권한, 스페이스 구조, 버전 |
| 검색 엔진 | **Elasticsearch** (2단계) | 방대한 텍스트 대상 풀텍스트 검색 |
| 파일 저장소 | **AWS S3** (또는 호환 Object Storage) | 이미지·첨부파일 |
| 캐시 | Redis | 세션, 권한 캐시, 편집 락 상태 |

PostgreSQL 을 MySQL 보다 우선하는 이유: JSONB(에디터 문서 저장), 재귀 CTE(페이지 트리 조회), 내장 Full-Text Search 를 모두 갖춰 초기 단계에서 별도 컴포넌트 없이 출발할 수 있다.

### 4.1 핵심 테이블 (초안)

```
users            id, email, name, avatar_url, created_at
teams            id, name
team_members     team_id, user_id, role
spaces           id, key, name, description, owner_id, created_at
pages            id, space_id, parent_id, title, content(jsonb),
                 content_text, position, status, created_by, updated_at
page_versions    id, page_id, version_no, content(jsonb), summary,
                 edited_by, created_at
permissions      id, subject_type(user|team), subject_id,
                 resource_type(space|page), resource_id, role
attachments      id, page_id, filename, s3_key, size, mime, uploaded_by
```

---

## 5. 시스템 구성도

```
[Browser]
    │  HTTPS
    ▼
[Next.js]  ──REST/tRPC──▶  [API Server (NestJS)]
                                │      │       │
                                │      │       └──▶ [S3]   첨부파일
                                │      └──────────▶ [Redis] 캐시·편집 락
                                ▼
                          [PostgreSQL]
                                │  (2단계) 색인 동기화
                                ▼
                         [Elasticsearch]
```

---

## 6. 단계별 로드맵

### Phase 1 — 기반 (MVP 착수)
- [ ] 인증: 이메일 가입/로그인, JWT 발급·갱신
- [ ] 스페이스 CRUD
- [ ] 페이지 CRUD + 트리 구조(생성·이동·정렬)
- [ ] TipTap 에디터 연동 (마크다운·표·코드블록)
- [ ] S3 이미지 업로드

### Phase 2 — 핵심 완성
- [ ] RBAC 권한 모델 및 API 레벨 검증
- [ ] 팀(Group) 관리
- [ ] 버전 저장·목록·diff·복원
- [ ] 검색 v1 (PostgreSQL FTS + 한국어 형태소)
- [ ] 편집 락 (동시 편집 충돌 방지)

### Phase 3 — 확장
- [ ] Elasticsearch 이관 및 색인 파이프라인
- [ ] OAuth (Google / GitHub)
- [ ] 댓글 / 멘션 / 알림
- [ ] 실시간 동시 편집 (Yjs CRDT)
- [ ] 페이지 템플릿, 즐겨찾기, 최근 방문

---

## 7. 확정 필요 사항 (Open Questions)

착수 전 결정해야 할 항목들.

1. **백엔드 언어** — 팀 숙련도 기준으로 NestJS / Spring Boot / FastAPI 중 확정
2. **배포 환경** — AWS / GCP / 온프레미스 중 어디인가 (S3 대체재 여부에 영향)
3. **사용자 규모** — 예상 인원과 문서 수. Elasticsearch 도입 시점을 좌우
4. **인증 주체** — 자체 가입인가, 사내 SSO(SAML/OIDC) 연동인가
5. **동시 편집 우선순위** — 1차 릴리스에 필수인가, 락으로 충분한가
6. **문서 저장 포맷** — ProseMirror JSON 고정 여부 (에디터 교체 비용과 직결)

---

## 8. 기술적 리스크

| 리스크 | 영향 | 대응 |
| --- | --- | --- |
| 에디터 종속성 | 높음 | 문서 저장 포맷을 표준 JSON 으로 유지, 변환 레이어 분리 |
| 권한 검증 누락 | 높음 | API 레벨 가드 일원화, 권한 테스트 케이스 필수화 |
| 트리 조회 성능 | 중간 | 재귀 CTE + 스페이스 단위 캐싱 |
| 검색 색인 동기화 | 중간 | Outbox 패턴으로 비동기 색인, 실패 시 재처리 |
| 버전 스토리지 증가 | 중간 | 델타 저장 전환, 오래된 버전 보관 정책 수립 |
