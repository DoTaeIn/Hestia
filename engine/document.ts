import type { DocumentNode } from "./domain.ts";

export const emptyDocument = (): DocumentNode => ({ type: "doc", content: [{ type: "paragraph" }] });

export const EMPTY_DOCUMENT_TEXT = "(내용 없음)";

export function documentText(content: DocumentNode) {
  const lines: string[] = [];
  const visit = (node: DocumentNode) => {
    if (node.type === "text" && node.text) lines.push(node.text);
    if (node.type === "hardBreak") lines.push("\n");
    if (node.type === "image") lines.push(`\n[이미지: ${node.attrs?.alt || "이름 없음"}]\n`);
    node.content?.forEach(visit);
    if (["paragraph", "heading", "listItem", "blockquote", "codeBlock", "tableRow"].includes(node.type || "")) lines.push("\n");
  };
  visit(content);
  return lines.join("").replace(/\n{3,}/g, "\n\n").trim() || EMPTY_DOCUMENT_TEXT;
}

// 빈 문서를 나타내는 자리표시자는 화면용이다. 길이 계산에 끼면 문서를 통째로
// 비운 편집이 "8자짜리 내용으로 바뀐 것" 으로 보여 이유를 묻지 않게 된다.
const bodyLength = (content: DocumentNode) => {
  const text = documentText(content);
  return text === EMPTY_DOCUMENT_TEXT ? 0 : text.length;
};

/** 이유를 물을지 판정한다 — 되돌리기 어려운 변경에서만. docs/WHY.md §4·P1 */
// ponytail: 평문 길이 비교뿐이라 같은 분량을 통째로 갈아끼운 편집은 못 잡는다.
// 매번 묻는 것보다 놓치는 편이 낫다고 보고 여기서 멈춤. 오탐이 늘면 문단 수 비교로.
export const REASON_SHRINK_CHARS = 40;

export function needsReason(before: { title: string; content: DocumentNode }, after: { title: string; content: DocumentNode }) {
  if (before.title !== after.title) return true;
  return bodyLength(before.content) - bodyLength(after.content) >= REASON_SHRINK_CHARS;
}
