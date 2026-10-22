# 로컬 실행과 배포 준비

2026-10-22 현재 실제 적용·검증 대상은 로컬 Supabase다. 운영 프로젝트 연결이나 외부 사이트 배포는 하지 않았다.

## 로컬 실행

Node 24, Docker Desktop, Supabase CLI가 필요하다.

```sh
npm ci
npx supabase start
npx supabase migration up --local
npm run dev -- --port 3010
```

기존 데이터를 지우는 `supabase db reset`은 정상 실행이나 업데이트에 필요하지 않다. 마이그레이션은 `0001`부터 현재 마지막 번호까지 순서대로 적용한다. `supabase/seed.sql`은 의도적으로 비어 있다.

`.env.example`을 `.env.local`로 복사하고 로컬 Supabase가 제공한 Publishable Key를 입력한다. 현재 포트 구성:

| 서비스 | 주소 |
| --- | --- |
| 앱 | `http://localhost:3010` |
| Supabase API | `http://127.0.0.1:55421` |
| Studio | `http://127.0.0.1:55423` |
| 로그인 메일함(Mailpit) | `http://127.0.0.1:55424` |
| PostgreSQL | `127.0.0.1:55422` |

`supabase/config.toml`의 로컬 프로젝트 ID는 기존 데이터 보존을 위해 `Confluence`를 유지한다. 다른 로컬 Supabase 프로젝트의 54321 포트와 혼동하지 않는다. 키·비밀번호·로그인 토큰을 저장소나 채팅에 올리지 않는다.

## 로컬 로그인과 동아리 시작

1. 앱의 로그인 화면에 이메일을 입력한다. 로컬 메일은 외부로 발송되지 않고 Mailpit에 도착한다.
2. Mailpit에서 해당 메일의 로그인 링크를 **요청한 브라우저에서** 연다. PKCE verifier가 그 브라우저에 있기 때문이다. 첫 사용자는 온보딩에서 워크스페이스를 만든다.
3. 새 문서에 내용을 쓰고, 공동 편집 저장이 완료되면 상단 저장 버튼으로 버전을 기록한다.
4. 다른 구성원도 먼저 로그인한 뒤 owner가 문서의 공유 화면에서 그 이메일을 추가한다. 권한별 운영은 [개발자 운영 문서](developers/operations.md)에 있다.

로컬 콜백 허용 목록에는 `localhost:3000/auth/callback`과 `localhost:3010/auth/callback`이 등록되어 있다. Google은 현재 로컬에 설정되지 않아 버튼을 기본 숨긴다. 실제 provider 설정을 완료한 환경에서만 `NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true`를 지정한다.

## 실제 서비스 통합 검사

```sh
npm test
npx tsc --noEmit
npm run test:services
```

통합 검사는 실제 Auth 가입, PostgREST 권한과 검색, 비공개 Storage, private Realtime 정책, 두 Yjs 세션 수렴, 버전 복원 generation, 휴지통을 확인한다. URL과 Docker 프로젝트가 Hestia 로컬 환경인지 확인한 뒤 실행하며, 기본 실행은 자체 fixture만 삭제한다. DB 초기화나 기존 사용자 삭제를 하지 않는다.

```sh
# 브라우저에서 추가 검증할 때만 사용
npm run test:services -- --keep-fixtures
# 검증 후 해당 실행의 fixture와 메일 정리
npm run test:services:cleanup
```

유지한 계정 정보는 `/private/tmp/hestia-service-fixtures.json`에 접근 제한을 두어 저장한다. 반복해서 keep 실행을 시작하기 전에 기존 fixture를 먼저 정리한다. 브라우저 검증 증거는 Git에서 제외되는 `test-results/`에 보관했다.

개발 서버와 프로덕션 빌드를 동시에 실행하면 `.next` 캐시가 충돌할 수 있다. `npm run build` 전에는 개발 서버를 종료하고, 빌드 후 `npm start -- --port 3010`으로 검증한다.

## 외부 배포를 결정하면

운영 Supabase 프로젝트·호스팅·도메인을 먼저 확정하고, 앱과 동일한 버전의 마이그레이션을 적용한다. 실제 도메인의 Auth Site URL/콜백, Email SMTP, 비공개 `page-images` 버킷과 private Realtime 설정을 확인한다. 브라우저에는 Publishable Key만 제공한다. service-role 키를 `NEXT_PUBLIC_*`에 넣지 않는다.

외부 발행은 별도 사용자 확인 후 진행한다. 로컬 테스트 통과가 SMTP 전달률, Google OAuth, 외부 네트워크, 운영 규모 부하 검증을 대신하지는 않는다.


운영 전 보안 설정은 [운영 보안 체크리스트](PRODUCTION-SECURITY.md)를 따른다. Preview 0.1 최종 보안 스키마는 0026이다.
