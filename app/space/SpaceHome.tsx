"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Tree, { type TreeNode } from "../Tree";
import BrandMark from "../BrandMark";
import AccountMenu from "../AccountMenu";
import NotificationBell from "../NotificationBell";
import Modal from "../Modal";
import { useTheme } from "../useTheme";
import { useSearchShortcut } from "../useSearchShortcut";
import { createBrowserEngine } from "@/lib/engine/browser";
import { emptyDocument, type PageRecord } from "@/lib/pages";
import { workspaceHref } from "@/lib/workspace-context";
import { Grip, Moon, Page, Pencil, Ring, Search, Sun, Trash } from "../icons";

type Props = { workspaceId: string; workspaceName: string; pages: PageRecord[]; tree: TreeNode[]; canEdit: boolean };

export default function SpaceHome({ workspaceId, workspaceName, pages, tree, canEdit }: Props) {
  const { dark, toggle: toggleDark } = useTheme();
  const [treeOpen, setTreeOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const router = useRouter();
  useSearchShortcut(workspaceId);

  async function createDoc() {
    if (!canEdit) return;
    setError(null);
    setCreating(true);
    const pageId = crypto.randomUUID();
    const { error } = await createBrowserEngine().pages.create({ id: pageId, workspaceId, title: newTitle, content: emptyDocument() });
    setCreating(false);
    if (error) {
      setError("새 문서를 만들지 못했습니다. 권한과 연결 상태를 확인해주세요.");
      return;
    }
    setCreateOpen(false);
    setNewTitle("");
    router.push(`/editor/${pageId}`);
  }

  async function dropBefore(event: React.DragEvent<HTMLDivElement>, target: PageRecord) {
    if (!canEdit) return;
    const movedId = event.dataTransfer.getData("text/plain") || draggedId;
    setDraggedId(null);
    setDropTargetId(null);
    if (!movedId || movedId === target.id) return;
    const { error } = await createBrowserEngine().pages.moveBefore(movedId, target.id);
    if (error) setError("문서를 옮기지 못했습니다. 하위 문서 아래로는 이동할 수 없습니다.");
    else router.refresh();
  }

  return (
    <div className="workbench surface">
      <header className="bar">
        <Link className="bar-mark" href={workspaceHref("/space", workspaceId)}><BrandMark size={28} /></Link>
        <nav className="crumb" aria-label="현재 워크스페이스"><b>{workspaceName}</b></nav>
        <div className="bar-right">
          <button type="button" className="ctl panel-toggle panel-toggle-history" aria-pressed={histOpen} onClick={() => setHistOpen((open) => !open)}>최근 활동</button>
          <button type="button" className="ctl panel-toggle panel-toggle-tree" aria-pressed={treeOpen} onClick={() => setTreeOpen((open) => !open)}>문서 목록</button>
          <Link href={workspaceHref("/space/trash", workspaceId)} className="ctl" aria-label="휴지통" title="휴지통"><Trash size={16} /></Link>
          <Link href={workspaceHref("/search", workspaceId)} className="ctl" aria-label="검색" title="검색 (Ctrl/⌘ K)"><Search size={16} /></Link>
          <button type="button" className="ctl" aria-label={dark ? "밝은 화면으로" : "어두운 화면으로"} title={dark ? "밝은 화면으로" : "어두운 화면으로"} onClick={toggleDark}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
          <Link href={workspaceHref("/space/members", workspaceId)} className="ctl">구성원·역할</Link>
          <NotificationBell />
          <AccountMenu />
        </div>
      </header>

      <aside className="panel panel-history" data-open={histOpen} aria-label="최근 활동"><div className="panel-head">최근 활동</div><div className="panel-body"><p className="empty"><b>활동 기록이 아직 없습니다</b>문서 이력이 저장되면 이곳에 표시됩니다.</p></div></aside>
      <main className="doc"><div className="doc-scroll"><div className="doc-sheet space-sheet">
        <header className="space-header"><span className="space-icon" aria-hidden="true"><Ring size={26} /></span><div><h1 className="doc-title">{workspaceName}</h1><p className="doc-meta">{canEdit ? "편집 가능" : "읽기 전용"} · 페이지 {pages.length}개</p></div>{canEdit && <button type="button" className="ctl ctl-solid" onClick={() => setCreateOpen(true)} disabled={creating}><Pencil size={15} />{creating ? "만드는 중…" : "새 문서"}</button>}</header>
        {error && <p className="space-error" role="alert">{error}</p>}
        <h2>페이지</h2>
        {pages.length ? <>{canEdit && <p className="page-order-note">카드 왼쪽의 점을 끌어 같은 위치의 문서 순서를 바꿀 수 있습니다.</p>}<ul className="page-grid">{pages.map((page) => <li key={page.id}><div draggable={canEdit} className={`page-card page-card-draggable${draggedId === page.id ? " is-dragging" : ""}${dropTargetId === page.id ? " is-drop-target" : ""}`} onDragStart={(event) => { if (!canEdit) return; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", page.id); setDraggedId(page.id); }} onDragEnd={() => { setDraggedId(null); setDropTargetId(null); }} onDragOver={(event) => { if (!canEdit) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDragEnter={() => canEdit && setDropTargetId(page.id)} onDrop={(event) => { event.preventDefault(); void dropBefore(event, page); }}>{canEdit && <span className="drag-handle" aria-hidden="true"><Grip size={16} /></span>}<Link href={`/editor/${page.id}`} className="page-card-link"><Page size={16} /><span>{page.title}</span></Link></div></li>)}</ul></> : <p className="empty"><b>{canEdit ? "첫 문서를 만들어보세요" : "아직 문서가 없습니다"}</b>팀의 결정과 맥락을 남길 공간입니다.</p>}
      </div></div></main>
      {createOpen && <Modal className="trash-confirm" labelledBy="new-page-title" onClose={() => setCreateOpen(false)}><div className="modal-head"><h2 id="new-page-title">새 문서 만들기</h2></div><form onSubmit={(event) => { event.preventDefault(); createDoc(); }}><div className="modal-body"><label className="field-label" htmlFor="new-page-name">문서 제목</label><input id="new-page-name" className="modal-input" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="예: 제품 기획" autoFocus /></div><div className="modal-foot"><button type="button" className="ctl" onClick={() => setCreateOpen(false)}>취소</button><button type="submit" className="ctl ctl-solid" disabled={creating}>{creating ? "만드는 중…" : "만들기"}</button></div></form></Modal>}
      <aside className="panel panel-tree" data-open={treeOpen} aria-label="스페이스와 페이지"><div className="panel-head">문서 목록</div><div className="panel-body"><Tree nodes={tree} /></div></aside>
    </div>
  );
}
