import { createClient } from "@/lib/supabase/browser";

export type Notification = {
  id: string;
  kind: "comment_on_document" | "reply_in_thread";
  createdAt: string;
  readAt: string | null;
  pageId: string | null;
  pageTitle: string;
  actorName: string;
};

type Row = {
  id: string;
  kind: Notification["kind"];
  created_at: string;
  read_at: string | null;
  page_id: string | null;
  actor: { display_name: string | null } | null;
  page: { title: string } | null;
};

/** newest first; the bell shows a window, not the whole history */
export async function fetchNotifications(limit = 20): Promise<Notification[]> {
  const { data, error } = await createClient()
    .from("notifications")
    .select("id, kind, created_at, read_at, page_id, actor:profiles!actor_id(display_name), page:pages!page_id(title)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    kind: row.kind,
    createdAt: row.created_at,
    readAt: row.read_at,
    pageId: row.page_id,
    pageTitle: row.page?.title ?? "삭제된 문서",
    actorName: row.actor?.display_name || "이름 없음",
  }));
}

export async function markRead(ids?: string[]): Promise<void> {
  const { error } = await createClient().rpc("mark_notifications_read", {
    target_ids: ids ?? null,
  });
  if (error) throw new Error(error.message);
}

export function describe(n: Notification): string {
  return n.kind === "comment_on_document"
    ? `${n.actorName}님이 회원님의 문서에 댓글을 남겼습니다`
    : `${n.actorName}님이 함께 보던 글타래에 답글을 남겼습니다`;
}
