# SQL 설치와 업그레이드

Preview 0.1의 스키마 버전은 **0026**입니다. 앱과 DB를 같은 릴리스로 맞추세요. Supabase Auth·Storage·Realtime 및 표준 API 역할을 전제로 하며, 일반 PostgreSQL 단독 설치용 SQL은 아닙니다.

## 새 로컬 개발 환경

Node.js 24+, Docker, Supabase CLI가 필요합니다. 프로젝트 루트에서 `npm ci`, `npx supabase start`, `npx supabase migration up --local` 순서로 실행합니다. 로컬 상태에 표시된 URL과 publishable/anon key를 `.env.local`에 넣습니다. 기본 프로젝트 API 포트는 55421입니다. 로컬의 다른 프로젝트와 포트를 혼동하지 마세요.

## 새 Supabase DB에 SQL로 설치

CLI 대신 SQL로 설치할 때는 `install.sql` 하나를 사용합니다. `npm run release:preview`가 번호순 마이그레이션 원본으로 생성합니다. 비어 있는 Supabase 프로젝트에서 DB 관리자 권한으로 한 번 실행하세요. 전체 트랜잭션이며 기존 Hestia 테이블이 있으면 중단합니다. 성공 시 CLI 마이그레이션 이력도 0001–0026으로 기록합니다. `install.sql`과 번호별 SQL을 중복 실행하지 마세요.

## 기존 설치 업그레이드

데이터를 백업하고 `npx supabase migration list --local`로 이력을 확인한 뒤 `npx supabase migration up --local`로 미적용 번호만 적용합니다. 원격 환경은 대상 프로젝트를 명시해 별도로 관리하세요. 기존 DB에 `install.sql` 또는 `db reset`을 실행하지 마세요. 이 공유본의 실제 서비스 검증은 로컬에 한정합니다.

## 이력과 검증

- 0001–0018: 워크스페이스·페이지·버전·검색·댓글·알림 및 권한의 초기 스키마.
- 0019–0020: 권한 경계, 공동 편집 로그·복원 세대, 워크스페이스 운영 RPC.
- 0021–0022: 계정 삭제 시 공동 편집 작성자 참조 정리와 로그 보존.
- 0025–0026: TOTP 추가 인증의 DB/RPC 경계, 권한 변경 감사·보존 정리, 새 Realtime topic·메타데이터 보호.
- 0024: 워크스페이스별 커스텀 역할·독립 권한, 관리 요청 직렬화, 권한 상승 차단.
- 0023: 본인 프로필의 표시 이름·아바타 URL만 수정, 컬럼 단위 권한과 입력 제약.

번호별 SQL은 업그레이드의 기준입니다. 설치 번들은 자동 생성하며 직접 수정하지 않습니다. `seed.sql`은 개발 초기화용이며 개인 계정이나 비밀값을 포함하지 않습니다. `tests/`의 SQL 검증은 트랜잭션 후 롤백하고, 실제 Auth·Storage·Realtime 검증은 `npm run test:services`로 실행합니다. 결과와 한계는 [로컬 검증 기록](../docs/LOCAL-VALIDATION.md)을 참고하세요.

운영 적용 후 `security-check.sql`을 DB 관리자 권한으로 실행하면 RLS·직접 쓰기·보안 helper ACL·버킷을 읽기 전용으로 점검한다. Auth 제공자·도메인 설정은 [운영 체크리스트](../docs/PRODUCTION-SECURITY.md)에서 별도로 확인한다.
