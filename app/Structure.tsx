"use client";

import { useState } from "react";
import { TREE, type Node } from "./data";
import { Caret, Lock, Page, Ring } from "./icons";

function Branch({ node, depth }: { node: Node; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const kids = node.children ?? [];
  const isSpace = node.kind === "space";

  if (node.locked) {
    return (
      <li className="branch is-locked">
        <div className="twig">
          <Lock size={15} />
          <span className="twig-name">{node.name}</span>
          <span className="twig-note">권한 없음 · 제목만 보입니다</span>
        </div>
      </li>
    );
  }

  return (
    <li className={`branch${isSpace ? " is-space" : ""}`}>
      <div className="twig">
        {kids.length > 0 ? (
          <button
            type="button"
            className={`twig-toggle${open ? " is-open" : ""}`}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <Caret size={14} />
            <span className="sr-only">{node.name} 하위 문서 펼치기</span>
          </button>
        ) : (
          <span className="twig-toggle is-leaf" aria-hidden="true" />
        )}
        {isSpace ? <Ring size={15} /> : <Page size={15} />}
        <span className="twig-name">{node.name}</span>
        {node.role && <span className="twig-role">{node.role}</span>}
      </div>
      {kids.length > 0 && open && (
        <ul className="twigs">
          {kids.map((k) => (
            <Branch key={k.name} node={k} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function Structure() {
  return (
    <div className="structure">
      <ul className="twigs twigs-root">
        {TREE.map((n) => (
          <Branch key={n.name} node={n} depth={0} />
        ))}
      </ul>
      <p className="structure-note">
        권한은 스페이스에서 아래로 흐르고, 필요한 페이지에서만 따로 지정합니다.
        빛이 닿지 않는 스페이스는 목록에 자리만 남고 내용은 열리지 않습니다 —
        서버가 판정하므로 주소를 직접 입력해도 같습니다.
      </p>
    </div>
  );
}
