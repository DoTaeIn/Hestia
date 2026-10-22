# 보안과 권한

Hestia는 Next.js(Node.js)·Supabase(PostgreSQL/Auth/Storage/Realtime)를 사용하며 PHP 런타임을 포함하지 않습니다. 별도로 운영하는 PHP 서비스는 해당 운영자가 독립적으로 업데이트해야 합니다.

실행 중인 앱·DB·의존성을 같은 릴리스로 맞추고 `npm ci`로 lockfile을 사용하세요. 배포 시 개발 서버 대신 `npm run build`·`npm start`를 사용합니다. `npm run security:audit`는 실행 시점의 npm 취약점 정보를 조회합니다. 경고 0은 모든 취약점이 없다는 보증이 아닙니다.

사용자 권한은 DB RLS·RPC가 판정합니다. UI의 버튼 표시나 주입된 identity만으로 권한을 얻지 못합니다. 실제 운영자가 설정할 항목은 [운영 체크리스트](docs/PRODUCTION-SECURITY.md)에 모았습니다. 상세 정책·API·검증은 [역할 문서](docs/developers/authorization.md)와 [보안 작업 기록](docs/SECURITY-REVIEW.md)에 있습니다.

취약점을 발견하면 서비스 운영자에게 비공개로 재현 조건과 영향을 전달하세요. 토큰·키·개인 문서·계정 비밀번호를 공개 이슈에 올리지 마세요. 현재 별도의 보안 제보 이메일이나 대응 SLA는 정해져 있지 않습니다.
