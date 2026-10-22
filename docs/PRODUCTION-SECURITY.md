# 운영 전 네가 설정할 것

앱 쪽 구현은 `0.1.0-preview.3` / DB `0026`에 반영했다. 아래는 운영 계정·도메인·제공자에서 직접 설정할 항목이다. 로컬의 `supabase/config.toml`은 운영 프로젝트 설정을 자동으로 바꾸지 않는다.

## 1. 앱 주소와 환경 변수

- [ ] 운영 HTTPS 도메인과 TLS 인증서를 연결하고 HTTP 접속을 HTTPS로 리다이렉트한다.
- [ ] `.env.production.example`을 참고해 배포 환경에 `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를 넣는다. URL은 실제 HTTPS origin이며 경로·쿼리를 넣지 않는다.
- [ ] 로그인 방식(`NEXT_PUBLIC_AUTH_EMAIL_LINK`, `NEXT_PUBLIC_AUTH_PASSWORD`, `NEXT_PUBLIC_AUTH_OAUTH_PROVIDERS`)을 선택한다.
- [ ] **빌드 전에** 값을 넣고 `npm ci`, `npm run security:check`, `npm run build`를 실행한다. 터미널의 파일로 검사하려면 `npm run security:check -- --env-file .env.production.local`을 사용한다. 값은 출력하지 않는다. `NEXT_PUBLIC_*`는 브라우저 번들에 들어가므로 바꾼 뒤 다시 빌드한다.
- [ ] 프록시/CDN이 HTTPS 정보와 Host를 정확하게 전달하고, 사용자별 응답의 `private, no-store`를 덮어쓰지 않는지 확인한다.

앱은 HTTPS site URL이 설정되면 Secure 쿠키와 HSTS(`max-age=31536000`)를 자동으로 적용한다. `includeSubDomains`·preload는 강제로 켜지 않는다. 스크립트 CSP nonce와 framing/nosniff 정책은 별도 설정 없이 생성된다. 브라우저 SDK가 세션을 읽어야 하므로 쿠키를 일괄 HttpOnly로 바꾸지 않는다. 원격 production backend에 HTTPS site URL이 빠지면 빌드가 실패한다.

## 2. Supabase Auth

- [ ] Auth Site URL을 실제 앱 origin으로 설정한다. Redirect URLs에는 **실제 앱의 `/auth/callback`**만 정확히 허용하고 필요 없는 localhost·wildcard 항목을 제거한다.
- [ ] 사용할 Email/OAuth provider만 활성화한다. OAuth는 제공자 콘솔의 redirect URI와 Supabase 설정을 모두 맞춘다. OAuth client secret·SMTP 비밀번호는 제공자/서버의 비밀 설정에 둔다.
- [ ] 이메일 확인, 양쪽 이메일 변경 확인, 안전한 비밀번호 변경을 켠다. 비밀번호는 최소 12자·대/소문자·숫자·기호 조건을 적용하고, 제공되는 유출 비밀번호 보호 기능도 확인한다.
- [ ] Email OTP/링크 유효기간은 10분을 출발점으로 설정한다. Refresh token rotation을 유지한다. 익명 로그인·불필요한 수동 계정 연결은 끈다.
- [ ] Auth의 TOTP MFA **등록·검증을 모두 켠다**. 실제 사용자 계정에서 계정 메뉴 → 계정 보안 → OTP 앱 등록을 완료한다. 운영 소유자·관리자 계정부터 등록하고, 별도 인증 앱/기기 백업을 준비한다.
- [ ] 앱의 추가 인증 성공 후 접근 가능 여부뿐 아니라 새 1차 로그인 세션이 추가 인증 화면으로 이동하는지 확인한다. DB도 검증된 TOTP가 있는 계정의 aal1 접근을 거부한다.

MFA를 사용하지 않는 계정의 로그인 방식은 그대로 선택할 수 있다. MFA 등록을 마친 계정은 UI에서 우회해도 DB·Storage·관리 RPC가 aal2를 요구한다. 기기 분실 시에는 운영자가 신원을 확인한 뒤 Auth 관리자 기능으로 factor를 초기화하는 절차를 정한다. OTP 복구를 위해 로그인 계정을 삭제하지 않는다. 특히 소유자 계정 삭제는 워크스페이스의 외래 키 연쇄 삭제를 일으킬 수 있으므로, 필요한 작업은 factor 초기화로 한정한다. 이 앱은 임의의 복구 코드나 고객 계정 강제 삭제 기능을 만들지 않았다. 다른 인증 제공자는 `lib/auth/security-browser.ts`·`security-server.ts`에 그 제공자의 추가 인증 흐름과 Supabase UUID/JWT 매핑을 연결해야 한다.

## 3. CAPTCHA·시도 제한·메일

- [ ] Cloudflare Turnstile에서 운영 도메인의 site key/secret을 만든다. **공개 site key만** 앱의 `NEXT_PUBLIC_TURNSTILE_SITE_KEY`에 넣는다.
- [ ] 같은 secret을 **Supabase Auth CAPTCHA 설정**에 넣고 Turnstile을 활성화한다. 프런트 표시만 켜면 서버 보호가 완성된 것이 아니다.
- [ ] 이메일 링크/비밀번호 로그인에서 정상 CAPTCHA·실패 CAPTCHA·만료 후 재시도를 확인한다. OAuth 자체의 보호는 OAuth 제공자 설정도 확인한다.
- [ ] Auth의 가입·로그인·OTP 검증·메일 재전송 rate limit을 설정한다. 로컬의 가입/로그인·검증 30회/5분을 출발점으로 삼되, 동아리실의 공유 IP가 정상 사용자를 과도하게 막지 않는지 확인한다. 무제한으로 풀지 않는다.
- [ ] 실제 SMTP와 발신 도메인 인증을 설정하고 새 로그인 링크가 수신·만료·1회 사용 후 거부되는지 확인한다. 로컬 Mailpit은 운영 메일 발송 설정을 대체하지 않는다.
- [ ] 배포 플랫폼의 요청 크기·접속 제한·WAF/봇 차단 기능을 사용 가능한 범위에서 설정한다. Studio·DB 관리자 포트·Docker API를 인터넷에 공개하지 않는다.

위젯·토큰 전달 코드는 구현돼 있다. 실제 Turnstile 운영 도메인 검증과 SMTP/OAuth 전달은 키·도메인이 있어야 최종 확인할 수 있다. [CAPTCHA 설정](https://supabase.com/docs/guides/auth/auth-captcha), [Auth 제한](https://supabase.com/docs/guides/auth/rate-limits).

## 4. DB·Storage·Realtime 적용

- [ ] 기존 DB는 먼저 백업하고 마이그레이션 이력을 확인한 뒤 **미적용 번호만** 적용한다. 새 DB만 `supabase/install.sql`을 사용한다. 기존 DB에 설치 번들이나 `db reset`을 실행하지 않는다.
- [ ] 운영 대상이 맞는지 확인한 뒤 0026까지 적용하고 `supabase/security-check.sql`을 DB 관리자 권한으로 실행한다. 읽기 전용 점검이며 사용자 자료나 키를 출력하지 않는다.
- [ ] `page-images`가 private이고 허용 MIME·크기 제한이 유지되는지 확인한다. 브라우저 앱의 service-role 사용, 역할/감사 테이블 직접 쓰기, RLS 비활성화를 허용하지 않는다.
- [ ] Realtime에서 public access를 끄고 private 채널만 사용하도록 설정한다. 현재 채널은 `page-v2:<문서 UUID>`이며 예전 `page:` 채널의 새 가입은 거부한다.
- [ ] 이번 보안 버전으로 바꿀 때 **기존 편집 탭을 모두 새로고침**하고, 기존 Realtime 연결을 재시작/종료할 수 있는 운영 방식으로 정리한다. 셀프호스트라면 Realtime 서비스를 재시작한다. 기존 토큰·연결이 남아 있는 동안 구버전 클라이언트만 계속 쓰도록 두지 않는다.

현재 클라이언트는 WebSocket에 본문·Yjs bytes·커서·이름을 보내지 않는다. 저장 완료 알림만 보내며 수신자는 DB에서 권한 확인 후 본문을 읽는다. 새 읽기는 DB가 거부하고 정상 클라이언트는 최대 약 5초의 확인 주기에도 권한 변경을 감지한다. 연결 자체의 캐시가 즉시 사라진다는 뜻은 아니다. 이미 보거나 다운로드한 자료는 회수할 수 없다. [Realtime 권한](https://supabase.com/docs/guides/realtime/authorization).

## 5. 백업·감사 로그·알림

- [ ] 운영 DB 백업의 주기·보존 기간과 필요한 복구 시점을 정하고 실제 다른 환경에 복원해 로그인·문서·권한을 확인한다. 로컬 볼륨 재시작 시험은 운영 재해 복구 시험을 대체하지 않는다.
- [ ] **Storage 파일은 별도로 백업**한다. DB 백업에는 Storage 객체 자체가 포함되지 않는다. [백업 문서](https://supabase.com/docs/guides/platform/backups).
- [ ] 권한 변경 기록 보존 기간을 정한다. 정리 도구는 `select public.prune_workspace_security_events(now() - interval '90 days');`처럼 운영자가 cutoff를 정해 실행한다. 30일보다 최근 자료는 이 도구로 지우지 못하며 일반 로그인 계정은 호출할 수 없다. 필요하면 선택한 주기로 운영 스케줄을 설정한다. 자동 삭제 스케줄은 포함하지 않았다.
- [ ] Auth/DB/앱 오류·반복 로그인 실패·5xx·용량·백업 실패에 대한 운영 알림을 연결한다. access token·OTP·TOTP 비밀 키·본문·개인정보를 로그나 오류 수집기에 첨부하지 않는다.
- [ ] 운영 키를 비밀 저장소에 보관하고 배포 관리자 접근과 MFA를 설정한다. 개발용 키를 운영에 복사하지 않는다. 유출된 비밀키는 해당 제공자에서 교체하고 필요한 세션을 무효화한다. 공개 publishable/anon key 자체는 비밀키가 아니다.

## 마지막 출시 확인

- [ ] 운영 소유자·일반 구성원·비회원 계정으로 문서·이미지·검색·구성원 관리·감사 로그 접근을 각각 확인했다.
- [ ] OTP 계정의 1차 로그인만으로 보호 API에 접근할 수 없고 올바른 추가 인증 후에만 접근했다.
- [ ] 관리 권한 제거 후 새 문서를 받지 못했고, 오류/복구 안내가 나온다.
- [ ] production CSP 오류가 없고 문서 편집·이미지·CAPTCHA·OAuth/이메일 콜백이 동작한다.
- [ ] 실제 공개 직전 `npm run security:audit`와 위 DB·환경 검사를 다시 실행했다.

환경 검사 통과는 외부 설정이 실제로 끝났다는 자동 판정이 아니다. 이 체크리스트의 확인란은 네가 운영 대상에서 직접 확인한 뒤 채우면 된다. [로컬에서 검증한 것](SECURITY-REVIEW.md)과 섞어 기록하지 않는다.
