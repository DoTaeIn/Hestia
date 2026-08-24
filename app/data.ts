/**
 * Demonstration data. Every name, date, and sentence below is authored for this
 * page — there are no real Hestia customers or documents yet, and the page says
 * so where a visitor could mistake it. Replace wholesale before launch.
 */

export type Line = { text: string; state: "kept" | "added" | "cut" };

export type Version = {
  no: number;
  author: string;
  at: string;
  summary: string;
  lines: Line[];
};

export const DOC_TITLE = "반출 문서 보안 정책";
export const DOC_PATH = ["플랫폼실", "보안", "반출 문서 보안 정책"];

export const VERSIONS: Version[] = [
  {
    no: 1,
    author: "정하윤",
    at: "2026-03-02 14:20",
    summary: "초안 작성",
    lines: [
      { text: "외부로 반출하는 문서는 반출 전에 검토를 받는다.", state: "added" },
      { text: "검토자는 팀장이 지정한다.", state: "added" },
      { text: "반출 기록은 6개월간 보관한다.", state: "added" },
    ],
  },
  {
    no: 2,
    author: "정하윤",
    at: "2026-03-11 09:41",
    summary: "보관 기간 상향, 대상 범위 명시",
    lines: [
      { text: "외부로 반출하는 문서는 반출 전에 검토를 받는다.", state: "kept" },
      { text: "고객 데이터가 포함된 문서는 예외 없이 대상이다.", state: "added" },
      { text: "검토자는 팀장이 지정한다.", state: "kept" },
      { text: "반출 기록은 6개월간 보관한다.", state: "cut" },
      { text: "반출 기록은 3년간 보관한다.", state: "added" },
    ],
  },
  {
    no: 3,
    author: "서민재",
    at: "2026-04-08 17:55",
    summary: "검토자 지정 방식 변경",
    lines: [
      { text: "외부로 반출하는 문서는 반출 전에 검토를 받는다.", state: "kept" },
      { text: "고객 데이터가 포함된 문서는 예외 없이 대상이다.", state: "kept" },
      { text: "검토자는 팀장이 지정한다.", state: "cut" },
      { text: "검토는 보안팀과 문서 소유 팀이 각각 한 명씩 맡는다.", state: "added" },
      { text: "반출 기록은 3년간 보관한다.", state: "kept" },
    ],
  },
  {
    no: 4,
    author: "서민재",
    at: "2026-05-19 11:02",
    summary: "긴급 반출 절차 삭제",
    lines: [
      { text: "외부로 반출하는 문서는 반출 전에 검토를 받는다.", state: "kept" },
      { text: "고객 데이터가 포함된 문서는 예외 없이 대상이다.", state: "kept" },
      { text: "검토는 보안팀과 문서 소유 팀이 각각 한 명씩 맡는다.", state: "kept" },
      { text: "긴급 시 사후 검토로 갈음할 수 있다.", state: "cut" },
      { text: "반출 기록은 3년간 보관한다.", state: "kept" },
    ],
  },
  {
    no: 5,
    author: "정하윤",
    at: "2026-06-24 16:30",
    summary: "v2의 보관 기간 문장을 되살림 — 되돌리기도 새 판으로 기록됨",
    lines: [
      { text: "외부로 반출하는 문서는 반출 전에 검토를 받는다.", state: "kept" },
      { text: "고객 데이터가 포함된 문서는 예외 없이 대상이다.", state: "kept" },
      { text: "검토는 보안팀과 문서 소유 팀이 각각 한 명씩 맡는다.", state: "kept" },
      { text: "반출 기록은 3년간 보관한다.", state: "kept" },
      { text: "감사 대응 시 원본 판을 그대로 제출할 수 있어야 한다.", state: "added" },
    ],
  },
];

export type Node = {
  name: string;
  kind: "space" | "page";
  /** document id — the /editor/[id] segment. Spaces have none. */
  id?: string;
  role?: "관리자" | "편집" | "읽기";
  locked?: boolean;
  children?: Node[];
};

export const TREE: Node[] = [
  {
    name: "플랫폼실",
    kind: "space",
    role: "편집",
    children: [
      {
        name: "보안",
        kind: "page",
        id: "security",
        children: [
          { name: "반출 문서 보안 정책", kind: "page", id: "export-policy" },
          { name: "접근 권한 검토 기록", kind: "page", id: "access-review" },
        ],
      },
      {
        name: "온보딩",
        kind: "page",
        id: "onboarding",
        children: [
          { name: "첫 주에 읽을 것", kind: "page", id: "first-week" },
          {
            name: "개발 환경 세팅",
            kind: "page",
            id: "dev-setup",
            children: [
              { name: "로컬 데이터베이스", kind: "page", id: "local-db" },
              { name: "자주 막히는 곳", kind: "page", id: "common-blockers" },
            ],
          },
        ],
      },
      { name: "장애 기록", kind: "page", id: "incidents" },
    ],
  },
  {
    name: "디자인",
    kind: "space",
    role: "읽기",
    children: [
      { name: "컴포넌트 결정 기록", kind: "page", id: "component-decisions" },
      { name: "리서치 노트", kind: "page", id: "research-notes" },
      { name: "접근성 점검 항목", kind: "page", id: "a11y-checklist" },
    ],
  },
  {
    name: "인사·보상",
    kind: "space",
    locked: true,
    children: [],
  },
];

export const CORPUS: { doc: string; space: string; text: string }[] = [
  {
    doc: "반출 문서 보안 정책",
    space: "플랫폼실",
    text: "고객 데이터가 포함된 문서는 예외 없이 반출 검토 대상이다.",
  },
  {
    doc: "접근 권한 검토 기록",
    space: "플랫폼실",
    text: "분기마다 스페이스별 권한 보유자를 다시 확인하고 기록을 남긴다.",
  },
  {
    doc: "첫 주에 읽을 것",
    space: "플랫폼실",
    text: "사내 문서는 검색으로 먼저 찾고, 없을 때만 새로 쓴다.",
  },
  {
    doc: "컴포넌트 결정 기록",
    space: "디자인",
    text: "버튼의 상태는 색이 아니라 테두리 밝기로 구분하기로 했다.",
  },
  {
    doc: "리서치 노트",
    space: "디자인",
    text: "참가자 여섯 명 중 다섯 명이 지난달 문서를 다시 찾지 못했다.",
  },
  {
    doc: "개발 환경 세팅",
    space: "플랫폼실",
    text: "로컬 데이터베이스는 컨테이너로 띄우고 마이그레이션을 먼저 적용한다.",
  },
];
