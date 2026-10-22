"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type Editor, type NodeViewProps } from "@tiptap/react";
import { getSchema, Mark, mergeAttributes, type JSONContent } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { Image } from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Collaboration } from "@tiptap/extension-collaboration";
import * as Y from "yjs";
import Comments from "./Comments";
import Modal from "../Modal";
import type { CommentThread } from "@/lib/comments";
import { createClient } from "@/lib/supabase/browser";
import { createBrowserEngine } from "@/lib/engine/browser";
import {
  applyLoadedCollaboration,
  buildSeedUpdate,
  loadCollaboration,
  seedIfNeeded,
  SupabaseYjsProvider,
  type CollaborationStatusDetail,
  type StaleRecoveryDetail,
} from "@/lib/collaboration";
import {
  Bold,
  Code,
  Comment as CommentIcon,
  Copy,
  Heading,
  ImageIcon,
  Italic,
  ListIcon,
  Quote,
  Table as TableIcon,
  Undo,
  Upload,
} from "../icons";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_BUCKET = "page-images";

// Private images use authenticated downloads and per-viewer blob URLs.
// The shared document stores only the Storage path, never a bearer URL.
function HestiaImageNodeView({ node }: NodeViewProps) {
  const storagePath = (node.attrs.storagePath as string | null) ?? null;
  const [src, setSrc] = useState<string>((node.attrs.src as string) || "");

  useEffect(() => {
    if (!storagePath) return;
    let active = true;
    let objectUrl: string | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    setSrc("");
    const load = async () => {
      try {
        // Authenticated download avoids embedding a reusable signed capability in the DOM.
        const { data, error } = await createClient().storage.from(IMAGE_BUCKET).download(storagePath);
        if (!active) return;
        if (error || !data) throw new Error("Image download unavailable");
        objectUrl = URL.createObjectURL(data);
        setSrc(objectUrl);
      } catch {
        if (active && ++failures < 4) retryTimer = setTimeout(() => { void load(); }, 15_000);
      }
    };
    void load();
    return () => { active = false; clearTimeout(retryTimer); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [storagePath]);

  return (
    <NodeViewWrapper>
      <img src={src || undefined} alt={(node.attrs.alt as string) || ""} draggable={false} referrerPolicy="no-referrer" />
    </NodeViewWrapper>
  );
}

const HestiaImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      storagePath: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-storage-path"),
        renderHTML: (attributes: { storagePath?: string | null }) => attributes.storagePath ? { "data-storage-path": attributes.storagePath } : {},
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(HestiaImageNodeView);
  },
});

function persistentContent(content: JSONContent): JSONContent {
  return {
    ...content,
    ...(content.attrs?.storagePath ? { attrs: { ...content.attrs, src: "" } } : {}),
    ...(content.content ? { content: content.content.map(persistentContent) } : {}),
  };
}

// a comment thread is a mark on a text range, keyed by data-comment-id — so
// it round-trips through getHTML()/setContent() like bold or a link would.
const CommentMark = Mark.create({
  name: "comment",
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-comment-id"),
        renderHTML: (attrs: { id: string }) => ({ "data-comment-id": attrs.id }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-comment-id]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "comment-mark" }), 0];
  },
});

type Props = {
  content: JSONContent;
  editable: boolean;
  onEdit: (content: JSONContent) => void;
  /** threads anchored in this document, as authored */
  seedComments: CommentThread[];
  pageId: string;
  workspaceId: string;
  currentUser: { id: string; name: string };
  /** banner, title and stamp — they share the sheet with the editable body */
  header: React.ReactNode;
  /** truthful collaboration connectivity, surfaced further up for e.g. gating version save */
  onCollaborationStatus?: (detail: CollaborationStatusDetail) => void;
};

function Tool({
  editor,
  label,
  on,
  run,
  children,
}: {
  editor: Editor;
  label: string;
  on?: boolean;
  run: () => boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="ctl"
      title={label}
      aria-label={label}
      aria-pressed={on ?? undefined}
      disabled={!editor.isEditable}
      onClick={() => run()}
    >
      {children}
    </button>
  );
}

export default function Doc({ content, editable, onEdit, seedComments, pageId, workspaceId, currentUser, header, onCollaborationStatus }: Props) {
  const [threads, setThreads] = useState<CommentThread[]>(seedComments);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; from: number; to: number } | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [commentMessage, setCommentMessage] = useState<string | null>(null);
  const [collaborationReady, setCollaborationReady] = useState(!editable);
  const [collaborationStatus, setCollaborationStatus] = useState<CollaborationStatusDetail | null>(null);
  const [staleRecoveries, setStaleRecoveries] = useState<StaleRecoveryDetail[]>([]);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const collaborationDoc = useRef<Y.Doc | null>(null);
  const collaborationProvider = useRef<SupabaseYjsProvider | null>(null);
  const seedContent = useRef(content);
  const onStatusRef = useRef(onCollaborationStatus);
  onStatusRef.current = onCollaborationStatus;
  if (!collaborationDoc.current) collaborationDoc.current = new Y.Doc();
  const stale = collaborationStatus?.status === "stale" || collaborationStatus?.status === "forbidden" || (collaborationStatus?.status === "error" && collaborationStatus.retryable === false);

  useEffect(() => {
    if (!editable) return;
    let active = true;
    const reportStatus = (detail: CollaborationStatusDetail) => {
      if (!active) return;
      setCollaborationStatus(detail);
      onStatusRef.current?.(detail);
    };
    void loadCollaboration(pageId).then(async (session) => {
      if (!active) return;
      applyLoadedCollaboration(collaborationDoc.current!, session, "initial-load");
      if (session.shouldSeed) {
        const schema = getSchema([StarterKit.configure({ undoRedo: false }), TableKit.configure({ table: { resizable: true } }), HestiaImage, Placeholder, CommentMark]);
        const seedUpdate = buildSeedUpdate(schema, seedContent.current);
        await seedIfNeeded(pageId, session.generation, seedUpdate, collaborationDoc.current!, "initial-load");
      }
      if (!active) return;
      const provider = new SupabaseYjsProvider(collaborationDoc.current!, pageId, session.generation, currentUser, {
        onStatus: reportStatus,
        onStaleRecovery: (detail) => { if (active) setStaleRecoveries((previous) => [...previous.filter((entry) => entry.generation !== detail.generation), detail]); },
      });
      collaborationProvider.current = provider;
      setCollaborationReady(true);
    }).catch(() => { reportStatus({ status: "error", message: "공동 편집을 연결하지 못했습니다. 새로고침 후 다시 시도하세요.", retryable: true }); });
    return () => { active = false; collaborationProvider.current?.destroy(); collaborationProvider.current = null; };
  }, [editable, pageId, currentUser.id, currentUser.name]);

  async function insertImage(view: Editor["view"], file: File, pos = view.state.selection.from) {
    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(file.type)) {
      setUploadError("JPG, PNG, GIF, WebP 이미지만 추가할 수 있습니다.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setUploadError("이미지는 파일당 20MB까지 업로드할 수 있습니다.");
      return;
    }
    const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLowerCase() || "image";
    const storagePath = `${workspaceId}/${pageId}/${crypto.randomUUID()}.${extension}`;
    setUploadError(null);
    const { error } = await createClient().storage.from(IMAGE_BUCKET).upload(storagePath, file, { contentType: file.type, upsert: false });
    if (error) {
      setUploadError(error.message);
      return;
    }
    const node = view.state.schema.nodes.image.create({ src: "", storagePath, alt: file.name });
    view.dispatch(view.state.tr.insert(pos, node));
    setUploadOpen(false);
  }

  const editor = useEditor({
    immediatelyRender: false, // the shell renders on the server; the editor does not
    editable: editable && collaborationReady && !stale,
    extensions: [
      StarterKit.configure({ undoRedo: editable ? false : undefined }),
      TableKit.configure({ table: { resizable: true } }),
      HestiaImage,
      Placeholder.configure({ placeholder: "여기에 문서를 쓰세요…" }),
      CommentMark,
      ...(editable ? [Collaboration.configure({ document: collaborationDoc.current })] : []),
    ],
    content: editable ? undefined : content,
    editorProps: {
      attributes: { class: "prose" },
      handleDrop(view, event) {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!files.length) return false;
        event.preventDefault();
        const pos =
          view.posAtCoords({ left: event.clientX, top: event.clientY })
            ?.pos ?? view.state.selection.from;
        files.forEach((file) => { void insertImage(view, file, pos); });
        return true;
      },
      handleClick(_view, _pos, event) {
        const target = (event.target as HTMLElement).closest("[data-comment-id]");
        if (!target) return false;
        setActiveThread(target.getAttribute("data-comment-id"));
        setCommentsOpen(true);
        return false;
      },
    },
    onUpdate: ({ editor, transaction }) => { if ((!editable || collaborationReady) && !transaction.getMeta("commentAnchor")) onEdit(persistentContent(editor.getJSON())); },
    // the live Yjs doc may already hold edits beyond `content` (collaboration_state loaded
    // above) — publish it immediately so a version save before any keystroke never records
    // the stale server snapshot instead of the actual current document.
    onCreate: ({ editor }) => { if (editable && collaborationReady) onEdit(persistentContent(editor.getJSON())); },
  }, [collaborationReady]);

  // switching revisions replaces the body without pushing an undo step
  useEffect(() => {
    if (!editable && editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(content)) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [editor, content, editable]);

  // Thread anchors stay outside the document payload so a comment never
  // publishes an unrelated local draft.
  useEffect(() => {
    setThreads(seedComments);
  }, [seedComments]);

  useEffect(() => {
    if (!editor) return;
    const existing = new Set<string>();
    editor.state.doc.descendants((node) => node.marks.forEach((mark) => { if (mark.type.name === "comment") existing.add(mark.attrs.id as string); }));
    const tr = editor.state.tr;
    for (const thread of seedComments) {
      if (!existing.has(thread.id) && thread.anchorFrom < thread.anchorTo && thread.anchorTo <= editor.state.doc.content.size) tr.addMark(thread.anchorFrom, thread.anchorTo, editor.state.schema.marks.comment.create({ id: thread.id }));
    }
    if (tr.docChanged) editor.view.dispatch(tr.setMeta("commentAnchor", true));
  }, [editor, seedComments]);

  useEffect(() => {
    editor?.setEditable(editable && collaborationReady && !stale);
  }, [editor, editable, collaborationReady, stale]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  /*
   * The menu takes focus when it opens, so every close path has to hand it
   * back. This runs after the commit that unmounts the menu — focusing during
   * the close handler gets undone when React removes the focused button.
   */
  const menuWasOpen = useRef(false);
  useEffect(() => {
    if (menu) {
      menuWasOpen.current = true;
      return;
    }
    if (menuWasOpen.current) {
      menuWasOpen.current = false;
      editor?.view.focus();
    }
  }, [menu, editor]);

  const collaborationBanner =
    collaborationStatus && collaborationStatus.message && (collaborationStatus.status === "stale" || collaborationStatus.status === "forbidden" || collaborationStatus.status === "error" || collaborationStatus.status === "offline") ? (
      <p className="space-error" role="alert">
        {collaborationStatus.message}
        {collaborationStatus.retryable === false && <a className="ctl" href="/account/security" target="_blank" rel="noopener noreferrer">복구 자료 관리</a>}
        {(collaborationStatus.status === "stale" || collaborationStatus.status === "forbidden") && (
          <button type="button" className="ctl" onClick={() => window.location.reload()}>새로고침</button>
        )}
      </p>
    ) : null;

  const copyStaleRecovery = async (recovery: StaleRecoveryDetail) => {
    try {
      await navigator.clipboard.writeText(recovery.text);
      setRecoveryMessage("복구 내용을 복사했습니다.");
    } catch {
      setRecoveryMessage("복사하지 못했습니다. 복구 파일 저장을 이용해 주세요.");
    }
  };

  const downloadRecovery = (recovery: StaleRecoveryDetail) => {
    const data = recovery.exportData?.() ?? recovery.text;
    const href = URL.createObjectURL(new Blob([data], { type: recovery.exportData ? "application/json" : "text/plain" }));
    const link = document.createElement("a");
    link.href = href;
    link.download = `hestia-recovery-${pageId}-${recovery.generation}.${recovery.exportData ? "json" : "txt"}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
  };

  const staleRecoveryBanner = staleRecoveries.length ? (
    <div>
      {staleRecoveries.map((recovery) => <p className="space-error" role="alert" key={recovery.generation}>
        복원 전에 저장하지 못한 편집 내용이 남아 있습니다. 복사하거나 파일로 저장할 수 있습니다. 현재 문서에는 자동으로 반영되지 않습니다.
        <button type="button" className="ctl" onClick={() => { void copyStaleRecovery(recovery); }}>내용 복사</button>
        <button type="button" className="ctl" onClick={() => downloadRecovery(recovery)}>복구 파일 저장</button>
        <button type="button" className="ctl" onClick={() => {
          if (!window.confirm("복구 내용을 다른 곳에 저장했나요? 이 브라우저의 복구 데이터를 삭제합니다.")) return;
          recovery.clear();
          setStaleRecoveries((previous) => previous.filter((entry) => entry.generation !== recovery.generation));
        }}>복구 데이터 삭제</button>
      </p>)}
      {recoveryMessage && <p role="status">{recoveryMessage}</p>}
    </div>
  ) : null;

  if (!editor || (editable && !collaborationReady)) {
    return (
      <div className="doc-scroll">
        {collaborationBanner}
        {staleRecoveryBanner}
        <div className="skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  const addImage = () => {
    setUploadError(null);
    setUploadOpen(true);
    return true;
  };

  const chooseImage = (file?: File) => {
    if (file) void insertImage(editor.view, file);
  };

  // a selection that already carries a comment mark joins that thread
  // instead of stacking a second one on the same spot
  const addCommentOnSelection = async () => {
    const { from, to } = editor.state.selection;
    let existingId: string | null = null;
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (existingId) return false;
      const mark = node.marks.find((m) => m.type.name === "comment");
      if (mark) existingId = mark.attrs.id as string;
    });
    if (existingId) {
      setActiveThread(existingId);
      setCommentsOpen(true);
      return;
    }
    const id = crypto.randomUUID();
    const quote = editor.state.doc.textBetween(from, to, " ");
    setCommentMessage(null);
    const { error } = await createBrowserEngine().comments.createThread({ id, pageId, workspaceId, quote, from, to });
    if (error) {
      setCommentMessage(error.message);
      setCommentsOpen(true);
      return;
    }
    editor.view.dispatch(editor.state.tr.addMark(from, to, editor.state.schema.marks.comment.create({ id })).setMeta("commentAnchor", true));
    setThreads((ts) => [...ts, { id, quote, anchorFrom: from, anchorTo: to, comments: [] }]);
    setActiveThread(id);
    setCommentsOpen(true);
  };

  // a selection starts a new thread anchored to that text; no selection just
  // opens the panel to browse what's already there
  const toggleComment = () => {
    if (editor.state.selection.empty || !editable) {
      setCommentsOpen((o) => !o);
      return true;
    }
    void addCommentOnSelection();
    return true;
  };

  // right-click on a selection offers the same shortcut the toolbar button
  // does; a locked past revision or an empty selection falls back to the
  // browser's own menu
  const handleContextMenu = (e: React.MouseEvent) => {
    const { from, to } = editor.state.selection;
    if (!editable || from === to || !window.getSelection()?.toString().trim()) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, from, to });
  };

  const restoreMenuSelection = () => {
    if (menu) editor.chain().focus().setTextSelection({ from: menu.from, to: menu.to }).run();
  };

  const copySelection = async (from: number, to: number) => {
    const text = editor.state.doc.textBetween(from, to, " ");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      document.execCommand("copy");
    }
  };

  const closeMenu = () => setMenu(null);

  const moveMenuFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  async function reply(threadId: string, text: string) {
    setCommentMessage(null);
    const { data, error } = await createBrowserEngine().comments.reply(threadId, text);
    if (error || !data) {
      setCommentMessage(error?.message ?? "댓글을 저장하지 못했습니다.");
      return;
    }
    setThreads((ts) => ts.map((t) => t.id === threadId ? { ...t, comments: [...t.comments, { id: data.id, author: "나", at: new Date(data.created_at).toLocaleString("ko-KR"), text }] } : t));
  }

  // soft delete: the text is gone, but the record that someone removed it
  // stays — deleting your own trail doesn't erase that it happened
  async function deleteComment(threadId: string, commentId: string) {
    setCommentMessage(null);
    const { error } = await createBrowserEngine().comments.delete(commentId);
    if (error) {
      setCommentMessage(error.message);
      return;
    }
    setThreads((ts) => ts.map((t) => t.id === threadId ? { ...t, comments: t.comments.map((comment) => comment.id === commentId ? { ...comment, deletedBy: "나", deletedAt: "방금" } : comment) } : t));
  }

  return (
    <>
      <div className="toolbar" role="toolbar" aria-label="서식">
        <Tool
          editor={editor}
          label="실행 취소"
          run={() => editor.chain().focus().undo().run()}
        >
          <Undo size={16} />
        </Tool>
        <span className="toolbar-sep" />
        <Tool
          editor={editor}
          label="제목"
          on={editor.isActive("heading", { level: 2 })}
          run={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading size={16} />
        </Tool>
        <Tool
          editor={editor}
          label="굵게"
          on={editor.isActive("bold")}
          run={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold size={16} />
        </Tool>
        <Tool
          editor={editor}
          label="기울임"
          on={editor.isActive("italic")}
          run={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic size={16} />
        </Tool>
        <span className="toolbar-sep" />
        <Tool
          editor={editor}
          label="목록"
          on={editor.isActive("bulletList")}
          run={() => editor.chain().focus().toggleBulletList().run()}
        >
          <ListIcon size={16} />
        </Tool>
        <Tool
          editor={editor}
          label="인용"
          on={editor.isActive("blockquote")}
          run={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote size={16} />
        </Tool>
        <Tool
          editor={editor}
          label="코드 블록"
          on={editor.isActive("codeBlock")}
          run={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          <Code size={16} />
        </Tool>
        <span className="toolbar-sep" />
        <Tool
          editor={editor}
          label="표 넣기"
          on={editor.isActive("table")}
          run={() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
        >
          <TableIcon size={16} />
        </Tool>
        <Tool editor={editor} label="이미지 넣기" run={addImage}>
          <ImageIcon size={16} />
        </Tool>
        <span className="toolbar-sep" />
        <button
          type="button"
          className="ctl"
          title="댓글 — 문장을 선택하고 누르면 그 자리에 답니다"
          aria-label="댓글"
          aria-pressed={commentsOpen}
          onClick={toggleComment}
        >
          <CommentIcon size={16} />
          {threads.length > 0 && <span className="comment-count">{threads.length}</span>}
        </button>
      </div>

      <div className="doc-scroll">
        {collaborationBanner}
        {staleRecoveryBanner}
        <div className="doc-sheet" onContextMenu={handleContextMenu}>
          {header}
          <EditorContent editor={editor} />
        </div>
      </div>

      {uploadOpen && (
        <Modal className="upload-modal" labelledBy="upload-title" onClose={() => setUploadOpen(false)}>
            <div className="modal-head">
              <div>
                <h2 id="upload-title">이미지 업로드</h2>
                <p className="upload-note">문서의 현재 커서 위치에 추가됩니다.</p>
              </div>
              <button type="button" className="ctl" onClick={() => setUploadOpen(false)} aria-label="닫기">
                ×
              </button>
            </div>
            <div
              className="upload-dropzone"
              tabIndex={0}
              role="button"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click();
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                chooseImage(event.dataTransfer.files[0]);
              }}
            >
              <span className="upload-icon"><Upload size={24} /></span>
              <strong>여기에 이미지를 드롭하세요</strong>
              <span>또는 클릭해서 파일 선택</span>
              <small>JPG, PNG, GIF, WebP · 파일당 최대 20MB</small>
            </div>
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              onChange={(event) => {
                chooseImage(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            {uploadError && <p className="upload-error" role="alert">{uploadError}</p>}
        </Modal>
      )}

      {menu && (
        <>
          <div className="ctx-veil" onClick={() => setMenu(null)} />
          <div
            className="ctx-menu"
            role="menu"
            onKeyDown={moveMenuFocus}
            style={{ left: menu.x, top: menu.y }}
            /*
             * Measured on commit, before paint: right-clicking near the right
             * or bottom edge would otherwise push the menu off screen. A ref
             * rather than a layout effect so nothing runs during SSR.
             */
            ref={(el) => {
              if (!el) return;
              const { width, height } = el.getBoundingClientRect();
              const pad = 8;
              const x = Math.min(menu.x, window.innerWidth - width - pad);
              const y = Math.min(menu.y, window.innerHeight - height - pad);
              el.style.left = `${Math.max(pad, x)}px`;
              el.style.top = `${Math.max(pad, y)}px`;
            }}
          >
            <button
              type="button"
              role="menuitem"
              autoFocus
              onClick={() => {
                void copySelection(menu.from, menu.to);
                closeMenu();
              }}
            >
              <Copy size={14} />
              복사
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                restoreMenuSelection();
                editor.chain().focus().toggleBold().run();
                closeMenu();
              }}
            >
              <Bold size={14} />
              굵게
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                restoreMenuSelection();
                editor.chain().focus().toggleItalic().run();
                closeMenu();
              }}
            >
              <Italic size={14} />
              기울임
            </button>
            <span className="ctx-menu-sep" role="separator" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                restoreMenuSelection();
                void addCommentOnSelection();
                closeMenu();
              }}
            >
              <CommentIcon size={14} />
              댓글 달기
            </button>
          </div>
        </>
      )}

      <Comments
        open={commentsOpen}
        threads={threads}
        activeThread={activeThread}
        onSelect={setActiveThread}
        onReply={reply}
        onDelete={deleteComment}
        onClose={() => setCommentsOpen(false)}
        message={commentMessage}
        editable={editable}
      />
    </>
  );
}
