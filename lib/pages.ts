import type { JSONContent } from "@tiptap/core";
import type { TreeNode } from "@/app/Tree";

export type PageRecord = {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title: string;
  content: JSONContent;
  position: number;
  created_at: string;
  updated_at: string;
  document_owner_id: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
};

export type PageRevision = {
  id: string;
  page_id: string;
  version: number;
  title: string;
  content: JSONContent;
  // 왜 이 판을 만들었는가. 비어 있어도 된다 — docs/WHY.md §4
  reason: string | null;
  created_at: string;
};

export const emptyDocument = (): JSONContent => ({ type: "doc", content: [{ type: "paragraph" }] });

export const EMPTY_DOCUMENT_TEXT = "(내용 없음)";

export function documentText(content: JSONContent) {
  const lines: string[] = [];
  const visit = (node: JSONContent) => {
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
const bodyLength = (content: JSONContent) => {
  const text = documentText(content);
  return text === EMPTY_DOCUMENT_TEXT ? 0 : text.length;
};

/** 이유를 물을지 판정한다 — 되돌리기 어려운 변경에서만. docs/WHY.md §4·P1 */
// ponytail: 평문 길이 비교뿐이라 같은 분량을 통째로 갈아끼운 편집은 못 잡는다.
// 매번 묻는 것보다 놓치는 편이 낫다고 보고 여기서 멈춤. 오탐이 늘면 문단 수 비교로.
export const REASON_SHRINK_CHARS = 40;

export function needsReason(before: { title: string; content: JSONContent }, after: { title: string; content: JSONContent }) {
  if (before.title !== after.title) return true;
  return bodyLength(before.content) - bodyLength(after.content) >= REASON_SHRINK_CHARS;
}

export function pagesToTree(workspaceName: string, pages: PageRecord[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  for (const page of pages) nodes.set(page.id, { id: page.id, name: page.title, kind: "page", children: [] });
  for (const page of pages) {
    const node = nodes.get(page.id)!;
    const parent = page.parent_id ? nodes.get(page.parent_id) : undefined;
    if (parent) parent.children!.push(node);
    else roots.push(node);
  }
  return [{ name: workspaceName, kind: "space", role: "편집", children: roots }];
}
