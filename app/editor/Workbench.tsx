"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Doc from "./Doc";
import ShareDialog from "./ShareDialog";
import Modal from "../Modal";
import Tree, { type TreeNode } from "../Tree";
import BrandMark from "../BrandMark";
import AccountMenu from "../AccountMenu";
import NotificationBell from "../NotificationBell";
import { useTheme } from "../useTheme";
import { useSearchShortcut } from "../useSearchShortcut";
import { createClient } from "@/lib/supabase/browser";
import { documentText, needsReason, type PageRecord, type PageRevision } from "@/lib/pages";
import type { CommentThread } from "@/lib/comments";
import { Moon, Restore, Search, Share, Sun, Trash } from "../icons";
import type { JSONContent } from "@tiptap/core";

type Save = "live" | "saving" | "saved" | "error";

const SAVE_WORD: Record<Save, string> = {
  live: "공동 편집 중",
  saving: "버전 저장 중",
  saved: "버전 저장됨",
  error: "저장 실패",
};

type WorkspaceMember = { userId: string; name: string; role: "owner" | "admin" | "editor" | "viewer" };
type Props = { page: PageRecord; pages: PageRecord[]; revisions: PageRevision[]; workspaceName: string; tree: TreeNode[]; workspaceMembers: WorkspaceMember[]; currentUserId: string; currentUserName: string; documentOwnerName: string; canManageSharing: boolean; canGrantAdmin: boolean; canEdit: boolean; canSaveVersion: boolean; commentThreads: CommentThread[] };

function TextDiff({ before, after }: { before: string; after: string }) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) { beforeEnd--; afterEnd--; }
  return <p className="revision-diff-text"><span>{before.slice(0, start)}</span><del>{before.slice(start, beforeEnd)}</del><ins>{after.slice(start, afterEnd)}</ins><span>{before.slice(beforeEnd)}</span></p>;
}

export default function Workbench({ page, pages, revisions, workspaceName, tree, workspaceMembers, currentUserId, currentUserName, documentOwnerName, canManageSharing, canGrantAdmin, canEdit, canSaveVersion, commentThreads }: Props) {
  const [title, setTitle] = useState(page.title);
  const [content, setContent] = useState<JSONContent>(page.content);
  const [save, setSave] = useState<Save>(canEdit ? "live" : "saved");
  const [treeOpen, setTreeOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [parentId, setParentId] = useState(page.parent_id ?? "");
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [compareRevision, setCompareRevision] = useState<PageRevision | null>(null);
  const [restoreRevision, setRestoreRevision] = useState<PageRevision | null>(null);
  const [restoreReason, setRestoreReason] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [askReason, setAskReason] = useState(false);
  const [saveReason, setSaveReason] = useState("");
  const [reasonDraft, setReasonDraft] = useState<{ id: string; text: string } | null>(null);
  const [savingReason, setSavingReason] = useState(false);
  const [reasonsOnly, setReasonsOnly] = useState(false);
  const shownRevisions = reasonsOnly ? revisions.filter((revision) => revision.reason) : revisions;
  const [transferOpen, setTransferOpen] = useState(false);
  const [nextOwnerId, setNextOwnerId] = useState("");
  const [transferring, setTransferring] = useState(false);
  const latest = useRef<{ title: string; content: JSONContent }>({ title: page.title, content: page.content });
  const { dark, toggle: toggleDark } = useTheme();
  const router = useRouter();
  useSearchShortcut();
  const hasLocalChanges = false;

  const blockedParents = useMemo(() => {
    const blocked = new Set([page.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of pages) {
        if (candidate.parent_id && blocked.has(candidate.parent_id) && !blocked.has(candidate.id)) {
          blocked.add(candidate.id);
          changed = true;
        }
      }
    }
    return blocked;
  }, [page.id, pages]);

  function requestSave() {
    if (!canSaveVersion || save === "saving") return;
    const next = { ...latest.current, title: latest.current.title.trim() || "제목 없는 문서" };
    if (needsReason(page, next)) {
      setAskReason(true);
      return;
    }
    saveVersion();
  }

  async function saveVersion(reason = "") {
    if (!canSaveVersion) return;
    const next = { ...latest.current, title: latest.current.title.trim() || "제목 없는 문서" };
    latest.current = next;
    setSave("saving");
    const { error } = await createClient().rpc("save_page_version", { target_page_id: page.id, next_title: next.title, next_content: next.content, change_reason: reason });
    if (error) {
      setSave("error");
      return;
    }
    setAskReason(false);
    setSaveReason("");
    setSave("saved");
    router.refresh();
  }

  // 지난 판에 이유를 뒤늦게 채운다. RLS 정책 + `reason` 컬럼 grant 만으로 열려 있어 RPC 가 없다.
  async function saveReasonDraft() {
    if (!reasonDraft) return;
    setSavingReason(true);
    const { error } = await createClient().from("page_revisions").update({ reason: reasonDraft.text.trim() || null }).eq("id", reasonDraft.id);
    setSavingReason(false);
    if (error) {
      setSave("error");
      return;
    }
    setReasonDraft(null);
    router.refresh();
  }

  function closeRestore() {
    setRestoreRevision(null);
    setRestoreReason("");
  }

  async function restoreVersion() {
    if (!restoreRevision) return;
    setRestoring(true);
    const { error } = await createClient().rpc("restore_page_revision", { target_page_id: page.id, source_revision_id: restoreRevision.id, change_reason: restoreReason });
    if (error) {
      setSave("error");
      setRestoring(false);
      return;
    }
    window.location.reload();
  }

  function changeTitle(nextTitle: string) {
    setTitle(nextTitle);
    latest.current = { ...latest.current, title: nextTitle.trim() || "제목 없는 문서" };
    setSave("live");
  }

  async function transferOwnership() {
    if (!nextOwnerId) return;
    setTransferring(true);
    const { error } = await createClient().rpc("transfer_page_ownership", { target_page_id: page.id, next_owner_id: nextOwnerId });
    if (error) { setSave("error"); setTransferring(false); return; }
    setTransferOpen(false);
    setTransferring(false);
    router.refresh();
  }

  async function moveTo(nextParentId: string) {
    const previous = parentId;
    setParentId(nextParentId);
    const { error } = await createClient()
      .from("pages")
      .update({ parent_id: nextParentId || null, position: Date.now() })
      .eq("id", page.id);
    if (error) {
      setParentId(previous);
      setSave("error");
      return;
    }
    router.refresh();
  }

  async function trashPage() {
    const { error } = await createClient().rpc("trash_page", { target_page_id: page.id });
    if (error) {
      setSave("error");
      setConfirmTrash(false);
      return;
    }
    router.push("/space");
  }

  return (
    <div className="workbench surface">
      <header className="bar">
        <Link className="bar-mark" href="/space"><BrandMark size={28} /></Link>
        <nav className="crumb" aria-label="문서 위치"><Link href="/space">{workspaceName}</Link><span aria-hidden="true"> /</span><b>{title}</b></nav>
        <div className="bar-right">
          <span className={`save is-${save}`} role="status" aria-live="polite"><span className="save-dot" aria-hidden="true" />{SAVE_WORD[save]}</span>
          <button type="button" className="ctl ctl-key" title={canSaveVersion ? "이 상태를 새 버전으로 기록" : "문서 소유자만 버전을 저장할 수 있습니다"} onClick={requestSave} disabled={save === "saving" || !canSaveVersion}>저장</button>
          <button type="button" className="ctl panel-toggle panel-toggle-history" aria-pressed={histOpen} onClick={() => setHistOpen((open) => !open)}>이력</button>
          <button type="button" className="ctl panel-toggle panel-toggle-tree" aria-pressed={treeOpen} onClick={() => setTreeOpen((open) => !open)}>문서 목록</button>
          <Link href="/search" className="ctl" aria-label="검색" title="검색 (Ctrl/⌘ K)"><Search size={16} /></Link>
          <button type="button" className="ctl" onClick={() => setShareOpen(true)}><Share size={15} />공유</button>
          <button type="button" className="ctl" aria-label={dark ? "밝은 화면으로" : "어두운 화면으로"} title={dark ? "밝은 화면으로" : "어두운 화면으로"} onClick={toggleDark}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
          <NotificationBell />
          <AccountMenu />
        </div>
      </header>

      <aside className="panel panel-history" data-open={histOpen} aria-label="수정 이력">
        <div className="panel-head">이력{reasonsOnly && <span className="panel-head-note">이유가 적힌 판만</span>}</div>
        <div className="panel-body">{revisions.length ? <><p className="revision-intro">모든 편집자는 같은 초안을 함께 봅니다. 버전 저장과 복원은 문서 소유자만 할 수 있습니다.</p><div className="revision-filter"><button type="button" className="ctl" aria-pressed={reasonsOnly} onClick={() => setReasonsOnly((only) => !only)}>{reasonsOnly ? "모든 판 보기" : "이 문서가 지금 모습이 된 이유들"}</button>{reasonsOnly && <span className="revision-optional">본문에서 지워진 문단의 이유도 여기 남습니다</span>}</div>{shownRevisions.length ? <ol className="revision-list">{shownRevisions.map((revision) => <li key={revision.id}><div className="revision-meta"><b>v{revision.version}</b><span>{new Date(revision.created_at).toLocaleString("ko-KR")}</span></div><div className="revision-actions"><button type="button" className="ctl" onClick={() => setCompareRevision(revision)}>비교</button><button type="button" className="ctl" disabled={!canSaveVersion} title={canSaveVersion ? undefined : "문서 소유자만 복원할 수 있습니다"} onClick={() => setRestoreRevision(revision)}>복원</button></div>{reasonDraft?.id === revision.id
              ? <form className="revision-reason-form" onSubmit={(event) => { event.preventDefault(); saveReasonDraft(); }}><input className="modal-input" autoFocus value={reasonDraft.text} aria-label={`v${revision.version} 변경 이유`} placeholder="이 판을 왜 만들었나요?" onChange={(event) => setReasonDraft({ id: revision.id, text: event.target.value })} /><button type="submit" className="ctl ctl-key" disabled={savingReason}>{savingReason ? "기록 중…" : "기록"}</button><button type="button" className="ctl" disabled={savingReason} onClick={() => setReasonDraft(null)}>취소</button></form>
              : revision.reason
                ? <div className="revision-reason"><p>{revision.reason}</p>{canEdit && <button type="button" className="ctl" onClick={() => setReasonDraft({ id: revision.id, text: revision.reason ?? "" })}>고치기</button>}</div>
                : canEdit ? <button type="button" className="revision-reason-add" onClick={() => setReasonDraft({ id: revision.id, text: "" })}>왜 바꿨는지 기록하기</button> : null}</li>)}</ol> : <p className="empty"><b>아직 이유가 적힌 판이 없습니다</b>판마다 왜 바꿨는지를 남기면 여기 모입니다. 본문이 지워져도 이유는 남습니다.</p>}</> :<p className="empty"><b>저장된 버전이 없습니다</b>공동 편집 중인 현재 내용은 소유자가 상단 저장 버튼으로 첫 버전을 기록할 수 있습니다.</p>}</div>
      </aside>

      <main className="doc">
        <Doc
          content={content}
          editable={canEdit}
          onEdit={(nextContent) => {
            setContent(nextContent);
            latest.current = { ...latest.current, content: nextContent };
            setSave("live");
          }}
          seedComments={commentThreads}
          pageId={page.id}
          workspaceId={page.workspace_id}
          currentUser={{ id: currentUserId, name: currentUserName }}
          header={<><input className="doc-title-input" aria-label="문서 제목" value={title} onChange={(event) => changeTitle(event.target.value)} /><div className="doc-meta doc-controls"><span>버전 소유자: {documentOwnerName}</span>{canSaveVersion && <button type="button" className="ctl" onClick={() => setTransferOpen(true)}>소유권 이전</button>}<label>상위 문서<select value={parentId} onChange={(event) => moveTo(event.target.value)}><option value="">최상위</option>{pages.filter((candidate) => !blockedParents.has(candidate.id)).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}</select></label><button type="button" className="ctl ctl-danger" onClick={() => setConfirmTrash(true)}><Trash size={15} />휴지통</button></div></>}
        />
      </main>

      <aside className="panel panel-tree" data-open={treeOpen} aria-label="스페이스와 페이지"><div className="panel-head">문서 목록</div><div className="panel-body"><Tree nodes={tree} activeId={page.id} /></div></aside>
      {shareOpen && <ShareDialog workspaceId={page.workspace_id} members={workspaceMembers} currentUserId={currentUserId} canManage={canManageSharing} canGrantAdmin={canGrantAdmin} onClose={() => setShareOpen(false)} />}
      {transferOpen && <Modal className="trash-confirm" labelledBy="transfer-title" onClose={() => { if (!transferring) setTransferOpen(false); }}><div className="modal-head"><h2 id="transfer-title">문서 소유권 이전</h2></div><div className="modal-body"><p>새 소유자는 버전을 저장하고 과거 버전을 복원할 수 있습니다. 공동 편집 권한은 그대로 유지됩니다.</p><label className="auth-field">새 소유자<select className="modal-input" value={nextOwnerId} onChange={(event) => setNextOwnerId(event.target.value)}><option value="">선택하세요</option>{workspaceMembers.filter((member) => member.userId !== currentUserId && member.role !== "viewer").map((member) => <option key={member.userId} value={member.userId}>{member.name} · {member.role}</option>)}</select></label></div><div className="modal-foot"><button type="button" className="ctl" disabled={transferring} onClick={() => setTransferOpen(false)}>취소</button><button type="button" className="ctl ctl-key" disabled={!nextOwnerId || transferring} onClick={transferOwnership}>{transferring ? "이전 중…" : "소유권 이전"}</button></div></Modal>}
      {compareRevision && <Modal className="revision-modal" labelledBy="revision-diff-title" onClose={() => setCompareRevision(null)}><div className="modal-head"><div><h2 id="revision-diff-title">v{compareRevision.version}과 현재 저장본 비교</h2><p className="revision-note">삭제된 내용은 주황색, 추가된 내용은 파란색으로 표시됩니다.</p></div><button type="button" className="ctl" onClick={() => setCompareRevision(null)} aria-label="닫기">×</button></div><div className="modal-body revision-diff"><div><p className="modal-label">v{compareRevision.version} · {compareRevision.title}</p><pre>{documentText(compareRevision.content)}</pre></div><div><p className="modal-label">현재 저장본 · {page.title}</p><pre>{documentText(page.content)}</pre></div><div className="revision-changes"><p className="modal-label">변경 내용</p><TextDiff before={documentText(compareRevision.content)} after={documentText(page.content)} /></div></div><div className="modal-foot"><button type="button" className="ctl" onClick={() => setCompareRevision(null)}>닫기</button><button type="button" className="ctl ctl-key" disabled={!canSaveVersion} title={canSaveVersion ? undefined : "문서 소유자만 복원할 수 있습니다"} onClick={() => { if (!canSaveVersion) return; setRestoreRevision(compareRevision); setCompareRevision(null); }}><Restore size={15} />이 버전 복원</button></div></Modal>}
      {askReason && <Modal className="trash-confirm" labelledBy="reason-title" onClose={() => { if (save !== "saving") setAskReason(false); }}><div className="modal-head"><h2 id="reason-title">왜 바꿨나요?</h2></div><div className="modal-body"><p>제목이 바뀌었거나 내용이 줄어든 판입니다. 무엇이 바뀌었는지는 어차피 저장되니, 나중에 이 판을 여는 사람이 궁금해할 건 이유 쪽입니다.</p><label className="auth-field">변경 이유 <span className="revision-optional">지금 비워도 이력에서 나중에 채울 수 있습니다</span><input className="modal-input" autoFocus value={saveReason} placeholder="예: 이 절차는 2월 배포부터 쓰지 않아서 지움" onChange={(event) => setSaveReason(event.target.value)} /></label></div><div className="modal-foot"><button type="button" className="ctl" disabled={save === "saving"} onClick={() => saveVersion()}>이유 없이 저장</button><button type="button" className="ctl ctl-key" disabled={save === "saving"} onClick={() => saveVersion(saveReason)}>{save === "saving" ? "저장 중…" : "이유와 함께 저장"}</button></div></Modal>}
      {restoreRevision && <Modal className="trash-confirm" labelledBy="restore-title" onClose={() => { if (!restoring) closeRestore(); }}><div className="modal-head"><h2 id="restore-title">v{restoreRevision.version}으로 복원할까요?</h2></div><div className="modal-body"><p>현재 내용은 삭제되지 않습니다. v{restoreRevision.version}의 내용이 새 버전으로 저장되어 이력에 남습니다.</p><label className="auth-field">왜 되돌리나요? <span className="revision-optional">비워 두어도 복원됩니다</span><input className="modal-input" value={restoreReason} placeholder="예: 삭제된 예외 처리 문단이 여전히 유효해서" onChange={(event) => setRestoreReason(event.target.value)} /></label></div><div className="modal-foot"><button type="button" className="ctl" disabled={restoring} onClick={closeRestore}>취소</button><button type="button" className="ctl ctl-key" autoFocus disabled={restoring} onClick={restoreVersion}><Restore size={15} />{restoring ? "복원 중…" : "새 버전으로 복원"}</button></div></Modal>}
      {confirmTrash && <Modal className="trash-confirm" labelledBy="trash-title" onClose={() => setConfirmTrash(false)}><div className="modal-head"><h2 id="trash-title">휴지통으로 이동할까요?</h2></div><div className="modal-body"><p>이 문서와 하위 문서는 휴지통으로 이동합니다. 필요하면 휴지통에서 다시 복구할 수 있습니다.</p></div><div className="modal-foot"><button type="button" className="ctl" onClick={() => setConfirmTrash(false)}>취소</button><button type="button" className="ctl ctl-danger" autoFocus onClick={trashPage}><Trash size={15} />휴지통으로 이동</button></div></Modal>}
    </div>
  );
}
