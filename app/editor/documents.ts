/**
 * Every document the editor can open, keyed by its /editor/[id] segment.
 *
 * Authored demonstration data — same fiction as the landing. Each revision
 * carries the full body at that moment. A real Hestia stores a ProseMirror
 * JSON snapshot per revision; HTML is enough to drive the screen and keeps
 * this file readable. Replace wholesale before launch.
 */

export type Revision = {
  no: number;
  author: string;
  at: string;
  summary: string;
  html: string;
};

export type CommentEntry = {
  author: string;
  at: string;
  text: string;
  /** soft-deleted: text is hidden, but the removal itself stays on record */
  deletedBy?: string;
  deletedAt?: string;
};

export type CommentThread = { id: string; quote: string; comments: CommentEntry[] };

export type Doc = {
  id: string;
  title: string;
  space: string;
  /** breadcrumb ancestors, excluding the document itself */
  path: string[];
  editingBy: string;
  revisions: Revision[];
  comments: CommentThread[];
};

const BASE_TABLE = `
<table>
  <tbody>
    <tr><th>구분</th><th>검토자</th><th>보관</th></tr>
    <tr><td>고객 데이터 포함</td><td>보안팀 + 소유 팀</td><td>3년</td></tr>
    <tr><td>내부 참고용</td><td>소유 팀</td><td>1년</td></tr>
  </tbody>
</table>`;

const EXPORT_POLICY_REVISIONS: Revision[] = [
  {
    no: 1,
    author: "정하윤",
    at: "2026-03-02 14:20",
    summary: "초안 작성",
    html: `
<p>외부로 반출하는 문서는 반출 전에 검토를 받는다.</p>
<p>검토자는 팀장이 지정한다.</p>
<p>반출 기록은 6개월간 보관한다.</p>`,
  },
  {
    no: 2,
    author: "정하윤",
    at: "2026-03-11 09:41",
    summary: "보관 기간 상향, 대상 범위 명시",
    html: `
<h2>적용 대상</h2>
<p>외부로 반출하는 모든 문서. <strong>고객 데이터가 포함된 문서는 예외 없이 대상이다.</strong></p>
<h2>절차</h2>
<p>검토자는 팀장이 지정한다.</p>
<p>반출 기록은 3년간 보관한다.</p>`,
  },
  {
    no: 3,
    author: "서민재",
    at: "2026-04-08 17:55",
    summary: "검토자 지정 방식 변경, 구분표 추가",
    html: `
<h2>적용 대상</h2>
<p>외부로 반출하는 모든 문서. <strong>고객 데이터가 포함된 문서는 예외 없이 대상이다.</strong></p>
<h2>절차</h2>
<p>검토는 보안팀과 문서 소유 팀이 각각 한 명씩 맡는다.</p>
${BASE_TABLE}
<p>반출 기록은 3년간 보관한다.</p>`,
  },
  {
    no: 4,
    author: "서민재",
    at: "2026-05-19 11:02",
    summary: "긴급 반출 절차 삭제",
    html: `
<h2>적용 대상</h2>
<p>외부로 반출하는 모든 문서. <strong>고객 데이터가 포함된 문서는 예외 없이 대상이다.</strong></p>
<h2>절차</h2>
<p>검토는 보안팀과 문서 소유 팀이 각각 한 명씩 맡는다.</p>
${BASE_TABLE}
<blockquote><p>긴급 시 사후 검토로 갈음하던 예외는 이 판에서 삭제되었다.</p></blockquote>
<p>반출 기록은 3년간 보관한다.</p>`,
  },
  {
    no: 5,
    author: "정하윤",
    at: "2026-06-24 16:30",
    summary: "v2의 보관 기간 문장을 되살림 — 되돌리기도 새 판으로 기록됨",
    html: `
<h2>적용 대상</h2>
<p>외부로 반출하는 모든 문서. <strong><span data-comment-id="c1">고객 데이터가 포함된 문서는 예외 없이 대상이다.</span></strong></p>
<h2>절차</h2>
<p>검토는 보안팀과 문서 소유 팀이 각각 한 명씩 맡는다.</p>
${BASE_TABLE}
<blockquote><p>긴급 시 사후 검토로 갈음하던 예외는 이 판에서 삭제되었다.</p></blockquote>
<h2>감사 대응</h2>
<p><span data-comment-id="c2">반출 기록은 3년간 보관한다.</span> 감사 대응 시 원본 판을 그대로 제출할 수 있어야 한다.</p>
<h3>제출 형식</h3>
<pre><code>GET /api/pages/:id/revisions?from=2026-01-01&amp;format=json</code></pre>`,
  },
];

/** one revision is the common case for a young page */
const one = (author: string, at: string, html: string): Revision[] => [
  { no: 1, author, at, summary: "초안 작성", html },
];

export const DOCS: Record<string, Doc> = {
  "export-policy": {
    id: "export-policy",
    title: "반출 문서 보안 정책",
    space: "플랫폼실",
    path: ["플랫폼실", "보안"],
    editingBy: "정하윤",
    revisions: EXPORT_POLICY_REVISIONS,
    comments: [
      {
        id: "c1",
        quote: "고객 데이터가 포함된 문서는 예외 없이 대상이다.",
        comments: [
          {
            author: "김도현",
            at: "2026-06-25 09:12",
            text: "'고객 데이터'에 테스트 계정 데이터도 포함되나요?",
          },
          {
            author: "정하윤",
            at: "2026-06-25 10:40",
            text: "실사용자 데이터만 해당돼요. 테스트 계정은 별도 정책으로 뺄 예정입니다.",
          },
        ],
      },
      {
        id: "c2",
        quote: "반출 기록은 3년간 보관한다.",
        comments: [
          {
            author: "서민재",
            at: "2026-06-26 15:03",
            text: "감사팀 요청 보관 기간(5년)이랑 안 맞는데 확인 필요할 것 같아요.",
          },
        ],
      },
    ],
  },

  security: {
    id: "security",
    title: "보안",
    space: "플랫폼실",
    path: ["플랫폼실"],
    editingBy: "서민재",
    revisions: one(
      "서민재",
      "2026-02-18 10:05",
      `
<p>플랫폼실의 보안 관련 문서를 모아 둔다. 새 문서를 만들면 이 아래에 붙인다.</p>
<h2>하위 문서</h2>
<ul>
  <li>반출 문서 보안 정책 — 외부 반출 시 검토 절차</li>
  <li>접근 권한 검토 기록 — 분기별 권한 재확인 결과</li>
</ul>
<blockquote><p>보안 관련 변경은 반드시 판을 남긴다. 구두 합의로 끝내지 않는다.</p></blockquote>`,
    ),
    comments: [],
  },

  "access-review": {
    id: "access-review",
    title: "접근 권한 검토 기록",
    space: "플랫폼실",
    path: ["플랫폼실", "보안"],
    editingBy: "김도현",
    revisions: [
      {
        no: 1,
        author: "김도현",
        at: "2026-01-15 11:20",
        summary: "1분기 검토 기록",
        html: `
<h2>검토 주기</h2>
<p>분기마다 스페이스별 권한 보유자를 다시 확인하고 기록을 남긴다.</p>
<h2>1분기 결과</h2>
<p>퇴사자 계정 2건에서 스페이스 권한이 남아 있어 회수했다.</p>`,
      },
      {
        no: 2,
        author: "김도현",
        at: "2026-04-14 16:48",
        summary: "2분기 결과 추가, 자동 회수 항목 기록",
        html: `
<h2>검토 주기</h2>
<p>분기마다 스페이스별 권한 보유자를 다시 확인하고 기록을 남긴다.</p>
<table>
  <tbody>
    <tr><th>분기</th><th>확인 대상</th><th>회수</th></tr>
    <tr><td>1분기</td><td>계정 48</td><td>2</td></tr>
    <tr><td>2분기</td><td>계정 51</td><td>0</td></tr>
  </tbody>
</table>
<p>퇴사 처리와 권한 회수를 연동해 2분기부터 수동 회수 건이 사라졌다.</p>`,
      },
    ],
    comments: [],
  },

  onboarding: {
    id: "onboarding",
    title: "온보딩",
    space: "플랫폼실",
    path: ["플랫폼실"],
    editingBy: "정하윤",
    revisions: one(
      "정하윤",
      "2026-02-02 09:30",
      `
<p>새로 합류한 사람이 첫 2주 동안 거쳐야 할 것들을 모아 둔다.</p>
<ul>
  <li>첫 주에 읽을 것 — 팀의 일하는 방식</li>
  <li>개발 환경 세팅 — 로컬 실행까지</li>
</ul>
<p>막히는 곳이 생기면 이 문서를 고치는 것까지가 온보딩이다.</p>`,
    ),
    comments: [],
  },

  "first-week": {
    id: "first-week",
    title: "첫 주에 읽을 것",
    space: "플랫폼실",
    path: ["플랫폼실", "온보딩"],
    editingBy: "정하윤",
    revisions: [
      {
        no: 1,
        author: "정하윤",
        at: "2026-02-03 13:10",
        summary: "초안 작성",
        html: `
<h2>문서를 먼저 찾는다</h2>
<p>사내 문서는 검색으로 먼저 찾고, 없을 때만 새로 쓴다.</p>
<p>같은 내용을 두 곳에 쓰면 둘 다 낡는다.</p>`,
      },
      {
        no: 2,
        author: "이서연",
        at: "2026-03-14 13:05",
        summary: "온보딩 체크리스트 순서 조정",
        html: `
<h2>문서를 먼저 찾는다</h2>
<p>사내 문서는 검색으로 먼저 찾고, 없을 때만 새로 쓴다.</p>
<p>같은 내용을 두 곳에 쓰면 둘 다 낡는다.</p>
<h2>첫 주 체크리스트</h2>
<ol>
  <li>개발 환경 세팅 문서대로 로컬 실행</li>
  <li>스페이스 권한 확인</li>
  <li>장애 기록 최근 3건 읽기</li>
</ol>`,
      },
    ],
    comments: [],
  },

  "dev-setup": {
    id: "dev-setup",
    title: "개발 환경 세팅",
    space: "플랫폼실",
    path: ["플랫폼실", "온보딩"],
    editingBy: "이서연",
    revisions: [
      {
        no: 1,
        author: "김도현",
        at: "2026-02-05 15:00",
        summary: "초안 작성",
        html: `
<h2>필요한 것</h2>
<ul>
  <li>Node.js 22 이상</li>
  <li>Docker</li>
</ul>
<pre><code>npm install
npm run dev</code></pre>`,
      },
      {
        no: 2,
        author: "이서연",
        at: "2026-05-06 09:30",
        summary: "컨테이너 기동 순서 정리",
        html: `
<h2>필요한 것</h2>
<ul>
  <li>Node.js 22 이상</li>
  <li>Docker</li>
</ul>
<h2>순서</h2>
<p>로컬 데이터베이스는 컨테이너로 띄우고 마이그레이션을 먼저 적용한다.</p>
<pre><code>docker compose up -d db
npm run migrate
npm run dev</code></pre>
<blockquote><p>마이그레이션 전에 <code>npm run dev</code>를 먼저 실행하면 스키마 없이 붙어 실패한다.</p></blockquote>`,
      },
    ],
    comments: [],
  },

  "local-db": {
    id: "local-db",
    title: "로컬 데이터베이스",
    space: "플랫폼실",
    path: ["플랫폼실", "온보딩", "개발 환경 세팅"],
    editingBy: "김도현",
    revisions: one(
      "김도현",
      "2026-02-06 10:40",
      `
<p>로컬은 PostgreSQL 16을 컨테이너로 띄운다. 호스트에 직접 설치하지 않는다.</p>
<pre><code>docker compose up -d db</code></pre>
<h2>초기화</h2>
<p>데이터가 꼬이면 볼륨을 지우고 다시 만든다. 로컬 데이터는 언제든 버려도 된다.</p>
<pre><code>docker compose down -v &amp;&amp; docker compose up -d db</code></pre>`,
    ),
    comments: [],
  },

  "common-blockers": {
    id: "common-blockers",
    title: "자주 막히는 곳",
    space: "플랫폼실",
    path: ["플랫폼실", "온보딩", "개발 환경 세팅"],
    editingBy: "이서연",
    revisions: [
      {
        no: 1,
        author: "이서연",
        at: "2026-02-20 14:15",
        summary: "초안 작성",
        html: `
<h2>포트가 이미 쓰이고 있다</h2>
<p>이전 컨테이너가 남아 있는 경우가 대부분이다. <code>docker ps</code>로 확인하고 정리한다.</p>`,
      },
      {
        no: 2,
        author: "이서연",
        at: "2026-04-30 17:22",
        summary: "마이그레이션 실패 항목 추가",
        html: `
<h2>포트가 이미 쓰이고 있다</h2>
<p>이전 컨테이너가 남아 있는 경우가 대부분이다. <code>docker ps</code>로 확인하고 정리한다.</p>
<h2>마이그레이션이 중간에 멈춘다</h2>
<p>스키마가 반쯤 적용된 상태로 남는다. 되돌리지 말고 볼륨을 지운 뒤 처음부터 다시 적용하는 편이 빠르다.</p>
<blockquote><p>운영 환경에서는 절대 같은 방법을 쓰지 않는다.</p></blockquote>`,
      },
    ],
    comments: [],
  },

  incidents: {
    id: "incidents",
    title: "장애 기록",
    space: "플랫폼실",
    path: ["플랫폼실"],
    editingBy: "김도현",
    revisions: [
      {
        no: 1,
        author: "서민재",
        at: "2026-01-08 20:10",
        summary: "초안 작성",
        html: `
<p>장애가 끝나면 24시간 안에 여기 기록한다. 원인을 모른 채로도 먼저 남긴다.</p>`,
      },
      {
        no: 2,
        author: "서민재",
        at: "2026-03-27 09:55",
        summary: "3월 검색 지연 건 기록",
        html: `
<p>장애가 끝나면 24시간 안에 여기 기록한다. 원인을 모른 채로도 먼저 남긴다.</p>
<h2>2026-03-26 검색 응답 지연</h2>
<p>색인 재생성 작업이 피크 시간과 겹쳤다. 작업 시간을 새벽으로 옮겼다.</p>`,
      },
      {
        no: 3,
        author: "김도현",
        at: "2026-06-20 10:15",
        summary: "6월 배포 지연 건 추가",
        html: `
<p>장애가 끝나면 24시간 안에 여기 기록한다. 원인을 모른 채로도 먼저 남긴다.</p>
<h2>2026-03-26 검색 응답 지연</h2>
<p>색인 재생성 작업이 피크 시간과 겹쳤다. 작업 시간을 새벽으로 옮겼다.</p>
<h2>2026-06-19 배포 지연</h2>
<p>이미지 빌드가 캐시를 놓쳐 40분 걸렸다. 배포 자체는 성공했고 사용자 영향은 없었다.</p>
<table>
  <tbody>
    <tr><th>날짜</th><th>영향</th><th>후속</th></tr>
    <tr><td>2026-03-26</td><td>검색 지연 20분</td><td>작업 시간 변경</td></tr>
    <tr><td>2026-06-19</td><td>없음</td><td>캐시 키 수정</td></tr>
  </tbody>
</table>`,
      },
    ],
    comments: [],
  },

  "component-decisions": {
    id: "component-decisions",
    title: "컴포넌트 결정 기록",
    space: "디자인",
    path: ["디자인"],
    editingBy: "이서연",
    revisions: [
      {
        no: 1,
        author: "이서연",
        at: "2026-02-11 11:00",
        summary: "초안 작성",
        html: `
<p>컴포넌트를 두고 갈린 결정을 남긴다. 왜 그렇게 했는지가 결론보다 중요하다.</p>`,
      },
      {
        no: 2,
        author: "이서연",
        at: "2026-04-22 15:35",
        summary: "버튼 상태 표현 결정 기록",
        html: `
<p>컴포넌트를 두고 갈린 결정을 남긴다. 왜 그렇게 했는지가 결론보다 중요하다.</p>
<h2>버튼 상태</h2>
<p>버튼의 상태는 색이 아니라 테두리 밝기로 구분하기로 했다.</p>
<blockquote><p>색만으로 구분하면 색각 이상 사용자에게 상태가 전달되지 않는다.</p></blockquote>`,
      },
    ],
    comments: [],
  },

  "research-notes": {
    id: "research-notes",
    title: "리서치 노트",
    space: "디자인",
    path: ["디자인"],
    editingBy: "이서연",
    revisions: [
      {
        no: 1,
        author: "이서연",
        at: "2026-03-05 10:20",
        summary: "초안 작성",
        html: `
<h2>문서 재발견 인터뷰</h2>
<p>참가자 여섯 명 중 다섯 명이 지난달 문서를 다시 찾지 못했다.</p>`,
      },
      {
        no: 2,
        author: "정하윤",
        at: "2026-05-02 14:05",
        summary: "관찰 정리 추가",
        html: `
<h2>문서 재발견 인터뷰</h2>
<p>참가자 여섯 명 중 다섯 명이 지난달 문서를 다시 찾지 못했다.</p>
<h2>관찰</h2>
<ul>
  <li>제목을 기억하지 못하고 본문 표현으로 찾으려 한다</li>
  <li>트리를 펼쳐 내려가기보다 검색을 먼저 쓴다</li>
</ul>
<p>검색이 본문을 대상으로 해야 하는 근거가 여기 있다.</p>`,
      },
    ],
    comments: [],
  },

  "a11y-checklist": {
    id: "a11y-checklist",
    title: "접근성 점검 항목",
    space: "디자인",
    path: ["디자인"],
    editingBy: "이서연",
    revisions: one(
      "이서연",
      "2026-04-25 16:00",
      `
<p>화면을 내보내기 전에 확인한다. 하나라도 걸리면 내보내지 않는다.</p>
<ol>
  <li>본문 대비 4.5:1 이상</li>
  <li>키보드만으로 모든 조작 가능</li>
  <li>포커스 표시가 눈에 보임</li>
  <li>상태를 색 하나로만 전달하지 않음</li>
</ol>
<blockquote><p>hover에서만 나타나는 버튼은 키보드 사용자에게 없는 버튼이다.</p></blockquote>`,
    ),
    comments: [],
  },
};

export const DOC_IDS = Object.keys(DOCS);

/** undefined for a node that is not a document (a space, or an unknown title) */
export const docHref = (id?: string) => (id ? `/editor/${id}` : undefined);

/** search results carry titles, not ids */
export function idForTitle(title: string): string | undefined {
  return DOC_IDS.find((id) => DOCS[id].title === title);
}

/** a brand new document, before anything has been typed into it */
export function blankDoc(title: string, at: string): Doc {
  return {
    id: "new",
    title,
    space: "플랫폼실",
    path: ["플랫폼실"],
    editingBy: "나",
    revisions: [{ no: 1, author: "나", at, summary: "문서 생성", html: "" }],
    comments: [],
  };
}
