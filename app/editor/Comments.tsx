"use client";

import { useState } from "react";
import type { CommentThread } from "@/lib/comments";

export default function Comments({
  open,
  threads,
  activeThread,
  onSelect,
  onReply,
  onDelete,
  onClose,
  message,
  editable,
}: {
  open: boolean;
  threads: CommentThread[];
  activeThread: string | null;
  onSelect: (id: string) => void;
  onReply: (id: string, text: string) => void;
  onDelete: (id: string, commentId: string) => void;
  onClose: () => void;
  message?: string | null;
  editable: boolean;
}) {
  return (
    <aside className="panel comments-panel" data-open={open} aria-label="댓글">
      <div className="panel-head">
        댓글
        <span className="count">{threads.length}개</span>
        <button type="button" className="ctl comments-close" onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </div>
      {message && <p className="comment-status" role="status">{message}</p>}
      <div className="panel-body">
        {threads.length === 0 ? (
          <p className="empty">
            <b>댓글이 없습니다</b>
            문장이나 문단을 선택하고 댓글 버튼을 누르면 그 자리에 댓글을 달 수 있습니다.
          </p>
        ) : (
          threads.map((t) => (
            <Thread
              key={t.id}
              thread={t}
              active={t.id === activeThread}
              onSelect={() => onSelect(t.id)}
              onReply={(text) => onReply(t.id, text)}
              onDelete={(commentId) => onDelete(t.id, commentId)}
              editable={editable}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function Thread({
  thread,
  active,
  onSelect,
  onReply,
  onDelete,
  editable,
}: {
  thread: CommentThread;
  active: boolean;
  onSelect: () => void;
  onReply: (text: string) => void;
  onDelete: (commentId: string) => void;
  editable: boolean;
}) {
  const [draft, setDraft] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onReply(text);
    setDraft("");
  }

  return (
    /*
     * Not a button: it holds a textarea and its own buttons, so nesting
     * interactives would break it. Grouped and labelled instead, and
     * activated by focus so tabbing in selects the thread the same way a
     * click does.
     */
    <div
      className={`comment-thread${active ? " is-active" : ""}`}
      role="group"
      aria-label={`“${thread.quote}”에 달린 댓글`}
      onClick={onSelect}
      onFocusCapture={onSelect}
    >
      <p className="comment-quote">{thread.quote}</p>
      {thread.comments.map((c) =>
        c.deletedBy ? (
          <div className="comment-item is-deleted" key={c.id}>
            <p className="comment-meta">
              <span className="comment-author">{c.deletedBy}</span>님이 {c.deletedAt} 지움
            </p>
            <p className="comment-text comment-tombstone">삭제된 댓글입니다</p>
          </div>
        ) : (
          <div className="comment-item" key={c.id}>
            <p className="comment-meta">
              <span className="comment-author">{c.author}</span> {c.at}
              <button
                type="button"
                className="comment-delete"
                aria-label={`${c.author}님의 댓글 삭제`}
                title="댓글 삭제"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(c.id);
                }}
              >
                ✕
              </button>
            </p>
            <p className="comment-text">{c.text}</p>
          </div>
        ),
      )}
      <form className="comment-reply" onSubmit={submit}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="답글 달기…"
          rows={2}
          disabled={!editable}
        />
        <button type="submit" className="ctl ctl-solid" disabled={!editable || !draft.trim()}>
          남기기
        </button>
      </form>
    </div>
  );
}
