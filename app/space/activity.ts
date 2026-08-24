/** Recent edits across the space, newest first. Same demonstration fiction as the editor. */
export type Activity = {
  doc: string;
  summary: string;
  author: string;
  at: string;
};

export const ACTIVITY: Activity[] = [
  {
    doc: "반출 문서 보안 정책",
    summary: "v2의 보관 기간 문장을 되살림",
    author: "정하윤",
    at: "2026-06-24 16:30",
  },
  {
    doc: "장애 기록",
    summary: "6월 배포 지연 건 추가",
    author: "김도현",
    at: "2026-06-20 10:15",
  },
  {
    doc: "반출 문서 보안 정책",
    summary: "긴급 반출 절차 삭제",
    author: "서민재",
    at: "2026-05-19 11:02",
  },
  {
    doc: "개발 환경 세팅",
    summary: "컨테이너 기동 순서 정리",
    author: "이서연",
    at: "2026-05-06 09:30",
  },
  {
    doc: "반출 문서 보안 정책",
    summary: "검토자 지정 방식 변경, 구분표 추가",
    author: "서민재",
    at: "2026-04-08 17:55",
  },
  {
    doc: "첫 주에 읽을 것",
    summary: "온보딩 체크리스트 순서 조정",
    author: "정하윤",
    at: "2026-03-14 13:05",
  },
];

export const MEMBERS = [
  { name: "정하윤", role: "관리자" },
  { name: "서민재", role: "편집" },
  { name: "김도현", role: "편집" },
  { name: "이서연", role: "읽기" },
];
