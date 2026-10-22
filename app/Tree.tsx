"use client";

import { useState } from "react";
import Link from "next/link";
import { Caret, Lock, Page, Ring } from "./icons";
const docHref = (id?: string) => id ? `/editor/${id}` : undefined;

import type { PageTreeNode } from "@/engine";
export type TreeNode = PageTreeNode;

/**
 * Shared space/page tree, used by the editor's document panel and the space
 * home. Any node carrying an id links to its own /editor/[id] route.
 */
export default function Tree({
  nodes,
  activeId,
}: {
  nodes: TreeNode[];
  /** document id to mark as "currently open" */
  activeId?: string;
}) {
  return (
    <ul className="tree">
      {nodes.map((n) => (
        <Branch key={n.name} node={n} depth={0} activeId={activeId} />
      ))}
    </ul>
  );
}

/** does this branch hold the open document somewhere below it? */
function contains(node: TreeNode, id?: string): boolean {
  if (!id) return false;
  return (node.children ?? []).some((k) => k.id === id || contains(k, id));
}

function Branch({
  node,
  depth,
  activeId,
}: {
  node: TreeNode;
  depth: number;
  activeId?: string;
}) {
  // shallow branches start open; deeper ones open only to reveal where you are
  const [open, setOpen] = useState(depth < 2 || contains(node, activeId));
  const kids = node.children ?? [];

  if (node.locked) {
    return (
      <li>
        <span className="node is-locked">
          <span className="twirl is-leaf" />
          <Lock size={14} />
          <span className="node-name">{node.name}</span>
          <span className="node-note">권한 없음</span>
        </span>
      </li>
    );
  }

  const isOpenDoc = !!node.id && node.id === activeId;
  const href = docHref(node.id);

  return (
    <li>
      <span className={`node${node.kind === "space" ? " is-space" : ""}${isOpenDoc ? " is-open-doc" : ""}`}>
        <button
          type="button"
          className={`twirl${open ? " is-open" : ""}${kids.length ? "" : " is-leaf"}`}
          aria-expanded={kids.length ? open : undefined}
          aria-label={`${node.name} 펼치기`}
          onClick={() => setOpen((o) => !o)}
          disabled={!kids.length}
        >
          <Caret size={13} />
        </button>
        {node.kind === "space" ? <Ring size={14} /> : <Page size={14} />}
        {href ? (
          <Link
            href={href}
            className="node-name node-link"
            aria-current={isOpenDoc ? "page" : undefined}
          >
            {node.name}
          </Link>
        ) : (
          <span className="node-name">{node.name}</span>
        )}
        {node.role && <span className="node-role">{node.role}</span>}
      </span>
      {kids.length > 0 && open && (
        <ul>
          {kids.map((k) => (
            <Branch key={k.name} node={k} depth={depth + 1} activeId={activeId} />
          ))}
        </ul>
      )}
    </li>
  );
}
