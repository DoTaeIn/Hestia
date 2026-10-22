import type { PageRecord, PageTreeNode } from "../engine/domain.ts";
export type { PageRecord, PageRevision } from "../engine/domain.ts";
export * from "../engine/document.ts";

export function pagesToTree(workspaceName: string, pages: PageRecord[]): PageTreeNode[] {
  const nodes = new Map<string, PageTreeNode>();
  const roots: PageTreeNode[] = [];
  for (const page of pages) nodes.set(page.id, { id: page.id, name: page.title, kind: "page", children: [] });
  for (const page of pages) {
    const node = nodes.get(page.id)!;
    const parent = page.parent_id ? nodes.get(page.parent_id) : undefined;
    if (parent) parent.children!.push(node);
    else roots.push(node);
  }
  return [{ name: workspaceName, kind: "space", role: "편집", children: roots }];
}
