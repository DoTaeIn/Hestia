# 로컬 보안 검증 · 2026-10-22

현재 공유본은 **0.1.0-preview.3**, DB는 **0026**이다. 외부 배포·운영 키 교체는 하지 않았다. 운영자가 설정할 것은 [운영 보안 체크리스트](PRODUCTION-SECURITY.md)에 모았다.

## 완료한 구현

- Next.js·TipTap·ProseMirror·이미지/빌드 의존성 보안 패치를 반영했다. npm 감사 경고는 35개에서 0개가 됐다. Next.js 15.5.28·TipTap 3.32.0·PostCSS 8.5.31 이상을 사용하고 lockfile로 설치한다.
- 공개 대기자 파일 쓰기 경로를 제거했다. framing/nosniff/referrer/권한 정책과 private/no-store 캐시를 적용하고, Auth 장애 시 보호 경로는 거부하면서 공개 로그인·소개 페이지는 유지한다.
- **스크립트 CSP nonce**를 매 요청 생성해 Next.js와 테마 스크립트에 전달한다. 외부에서 보낸 nonce/CSP 헤더는 덮어쓴다. production은 script의 unsafe-inline·unsafe-eval을 허용하지 않는다. 개발 HMR의 eval, 편집기/React의 inline style과 지정된 폰트 CDN은 용도에 맞춰 허용한다. [Next.js CSP 가이드](https://nextjs.org/docs/app/guides/content-security-policy).
- HTTPS site URL을 설정하면 Secure 쿠키·HSTS가 적용된다. 원격 production backend의 HTTPS site URL이 빠지면 빌드를 거부한다. CAPTCHA 위젯·서버 토큰 전달, 비밀값을 출력하지 않는 운영 환경 사전 검사를 추가했다. 실제 CAPTCHA secret은 Supabase Auth에 설정한다.
- **TOTP MFA** 등록·미완료 등록 정리·로그인 시 추가 확인·해지 확인 UI와 교체 가능한 SecurityAdapter를 추가했다. 0025의 restrictive RLS와 RPC guard가 MFA를 등록한 사용자의 aal1 접근을 DB·Storage·Realtime에서 막는다. 0026은 공유 구성원 관계를 조회하는 메타데이터 RPC까지 같은 조건으로 보호한다. 다른 인증 공급자도 같은 UUID/JWT와 assurance 경계를 맞춰야 한다. [Supabase TOTP](https://supabase.com/docs/guides/auth/auth-mfa/totp).
- **권한 감사 로그**는 DB 트리거로만 기록하고 해당 workspace의 관리자만 읽는다. 이름·이메일·본문·OTP/비밀키를 넣지 않고 actor/subject UUID와 권한 변화를 저장한다. 일반 계정은 위조·수정·삭제할 수 없다. 운영용 보존 기간 정리 함수만 service_role에 제공하며 자동 스케줄은 만들지 않았다.
- **공동 편집 wire protocol**을 `page-v2:`로 바꿨다. 본문·Yjs bytes·상태 벡터·사용자 이름·커서는 방송하지 않는다. 저장 성공 후 generation 알림만 보내고 수신자는 인증된 DB 조회로 내용을 받는다. 알림/조회는 병합하며 한 조회와 한 후속 요청까지만 유지한다. 5초 확인으로 누락 알림·권한 철회·복원을 감지하고 거부된 세션은 멈춘다. 원격 커서/awareness는 전송하지 않는다.
- 비공개 문서 이미지는 인증된 Storage 다운로드로 받아 해당 브라우저의 blob URL로 표시하고 해제한다. 공유 문서나 DOM에 재사용 가능한 서명 URL을 넣지 않는다. 외부 이미지에는 referrer를 보내지 않는다.
- 영구적인 payload 형식·크기 거부는 자동 재시도를 멈추고 복구 자료를 보존한다. 계정 보안에서 자기 계정의 브라우저 미전송/복구 자료를 내보내거나 확인 후 삭제할 수 있다. 인증 토큰과 다른 사용자의 자료는 건드리지 않는다.
- push/PR용 읽기 권한 CI 검사를 준비했다. 공식 GitHub Actions 커밋을 고정하고 감사·단위·타입·빌드를 실행한다. 실제 GitHub 실행은 아직 하지 않았다.

## 검증 결과

| 검사 | 결과 |
| --- | --- |
| 단위·계약 | 173개 통과 |
| 타입·프로덕션 빌드 | 통과 |
| 실제 로컬 Auth/PostgREST/Storage/Realtime | 53개 통과 |
| MFA·감사 SQL | 44개, 실패 0 |
| 커스텀 역할 SQL | 45개, 실패 0 |
| 기존 시스템 SQL | 278개 중 273개 통과·5개 명시적 건너뜀 |
| 프로필 SQL | 121개 중 117개 통과·4개 명시적 건너뜀 |
| 워크스페이스 SQL | 23개 통과 |
| 작성자 삭제·공유 편집 보존 | 통과 |
| 두 DB 세션의 관리자 강등/추가 경합 | 잠금 후 최신 권한으로 거부 |
| production HTTP·CSP | 무인증/위조 미들웨어 헤더 거부, nonce 변경·위조 차단·스크립트 nonce 일치 |
| 운영용 DB 읽기 점검 SQL | 통과 |
| 잘못 채운 운영 환경 예시 | 정상적으로 검사 실패, 비밀값 출력 없음 |

실제 TOTP 검증은 올바른 코드의 aal2 승격, 잘못된 코드 거부, 이전 aal1 토큰의 문서·관리 RPC·Storage 차단, aal1의 MFA 해지/대체 등록 우회 거부를 포함한다. 권한 철회 후 남은 실제 WebSocket 구독으로 새 본문을 받지 못했고 구형 raw payload 주입도 무시됐다. Auth에 새 TOTP·비밀번호 12자·OTP 10분 설정이 로드되고 약한 비밀번호 가입이 거부되는 것도 확인했다.

실제 production 브라우저에서 비밀번호 → OTP → workspace 진입, 등록된 factor/복구 관리 화면, 권한 변경 로그, 인증된 blob 이미지 로딩을 확인했다. CSP 오류는 0개였다. 화면은 Git/공유본에서 제외되는 `test-results/final-account-security.png`, `final-audit-log.png`, `final-private-image.png`에 있다.

로컬 데이터 보존 시험은 합성 문서의 Yjs 로그와 감사 기록을 캡처한 뒤 Hestia 스택만 볼륨을 보존해 재시작했다. Auth MFA·문서·Yjs 로그·감사 이벤트·비공개 이미지가 유지됐다. 이 시험은 운영 백업을 다른 프로젝트에 복원하는 재해 복구 시험이 아니다.

## 재현

```sh
npm ci
npm run security:audit
npm test
npm run typecheck
npm run build
npm run test:services
npm run test:roles:concurrency
# production 앱이 localhost:3010에서 실행 중일 때
npm run test:security:http
```

SQL 테스트는 `psql -v ON_ERROR_STOP=1`로 실행하며 전체를 롤백한다. 볼륨 재시작 검사는 `test:services -- --keep-fixtures`의 합성 데이터를 사용해 `node scripts/test-local-backup.mjs --capture`, 로컬 Supabase stop/start, `node scripts/test-local-backup.mjs` 순으로 수행한다. 해당 스크립트는 프로젝트·포트를 검증하며 다른 프로젝트를 거부한다. 검증 후 `npm run test:services:cleanup`으로 합성 MFA 계정·이미지·자료를 정리한다.

## 운영 설정과 구조적인 한계

실제 도메인 TLS·CAPTCHA secret·SMTP/OAuth·관리자 OTP 등록·백업/보존/알림·배포 관리자 접근은 운영 설정이다. [체크리스트](PRODUCTION-SECURITY.md)를 실제 대상에서 채운다. 로컬 config는 운영에 자동 반영되지 않는다.

이미 내려받은 문서·이미지·복구 파일은 회수할 수 없다. 이전 버전이 발급한 서명 URL도 자체 만료 전까지 남을 수 있다. 기존 Realtime 연결의 권한 캐시는 남을 수 있지만 새 클라이언트는 그 채널로 본문을 보내지 않고 DB가 새 데이터를 거부한다. 전환 시 구버전 탭·연결은 정리한다. 새로운 정상 클라이언트의 철회 표시에는 최대 약 5초가 걸릴 수 있다. 큰 로그를 다시 읽는 비용·다인/대용량 부하와 상류 서비스의 DoS 방어는 운영 용량·요청 제한과 함께 관찰한다. 로그 압축은 이 보안 변경에 포함하지 않았다.

브라우저 복구 저장소가 막히거나 넘치면 로컬 보존도 보장하지 않으므로 즉시 복사 안내를 따른다. 공용 기기에서는 필요한 자료를 내보낸 뒤 삭제하고 로그아웃한다. 외부 폰트·아바타/이미지는 허용한 호스트로 브라우저 요청을 보낸다. 감사 경고 0이나 이 검증이 알려지지 않은 모든 취약점이 없다는 보증은 아니다.

과거 PHP 우려는 [공식 공지](https://www.php.net/archive/2026.php#2026-10-21-5)를 확인했으나 이 앱은 PHP를 사용하지 않는다. 별도 PHP 서비스까지 검증한 것은 아니다. 이전 Preview 단계의 이력은 [시스템 감사 누적 기록](SYSTEM-AUDIT.md)에 남겼다.


최종 공유본 확인: 별도 빈 Supabase Postgres에 0026 설치 번들을 적용하고 6종 SQL 회귀와 운영 DB 점검을 통과했다. 기존 DB 재설치는 정상 차단됐다. ZIP을 새 폴더에 풀어 npm ci·173개 단위 테스트·타입 검사·production 빌드를 통과했다. 합성 사용자·워크스페이스·감사 이벤트·Storage 파일·MFA factor를 모두 정리했고 로컬 데이터 각 0건을 확인했다.
