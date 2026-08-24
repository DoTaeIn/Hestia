import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Workbench from "../Workbench";
import "../../tool.css";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "@/lib/supabase/query";
import { pagesToTree, type PageRecord, type PageRevision } from "@/lib/pages";
import type { CommentThread } from "@/lib/comments";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("pages").select("title").eq("id", id).maybeSingle();
  return { title: data?.title ? `${data.title} — Hestia` : "Hestia" };
}

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const pageData = unwrap(
    await supabase.from("pages").select("id, workspace_id, parent_id, title, content, position, created_at, updated_at, document_owner_id").eq("id", id).is("deleted_at", null).maybeSingle(),
    "문서",
  );
  // absent is not the same as failed: row-level security also lands here, and
  // both of those genuinely mean "not found" to this reader
  const page = pageData as unknown as PageRecord | null;
  if (!page) notFound();

  const [workspaceRes, pageListRes, revisionRes, memberRes, threadRes, authRes] = await Promise.all([
    supabase.from("workspaces").select("name").eq("id", page.workspace_id).maybeSingle(),
    supabase.from("pages").select("id, workspace_id, parent_id, title, content, position, created_at, updated_at, document_owner_id").eq("workspace_id", page.workspace_id).is("deleted_at", null).order("position").order("created_at"),
    supabase.from("page_revisions").select("id, page_id, version, title, content, reason, created_at").eq("page_id", page.id).order("version", { ascending: false }),
    supabase.from("workspace_members").select("user_id, role").eq("workspace_id", page.workspace_id),
    supabase.from("comment_threads").select("id, quote, anchor_from, anchor_to, created_by, created_at").eq("page_id", page.id).order("created_at"),
    supabase.auth.getUser(),
  ]);
  const workspaceData = unwrap(workspaceRes, "워크스페이스");
  const pageList = unwrap(pageListRes, "문서 목록");
  const revisionList = unwrap(revisionRes, "버전 이력");
  const memberList = unwrap(memberRes, "워크스페이스 구성원");
  const threadList = unwrap(threadRes, "댓글 스레드");
  const authData = unwrap(authRes, "로그인 정보");
  const workspaceName = workspaceData?.name ?? "워크스페이스";
  const pages = (pageList ?? []) as unknown as PageRecord[];
  const revisions = (revisionList ?? []) as unknown as PageRevision[];
  const members = (memberList ?? []) as unknown as Array<{ user_id: string; role: "owner" | "admin" | "editor" | "viewer" }>;
  const threadRows = (threadList ?? []) as Array<{ id: string; quote: string; anchor_from: number; anchor_to: number; created_by: string; created_at: string }>;
  const commentList = threadRows.length
    ? unwrap(await supabase.from("comments").select("id, thread_id, body, created_by, created_at, deleted_by, deleted_at").in("thread_id", threadRows.map((thread) => thread.id)).order("created_at"), "댓글")
    : [];
  const commentRows = (commentList ?? []) as Array<{ id: string; thread_id: string; body: string; created_by: string; created_at: string; deleted_by: string | null; deleted_at: string | null }>;
  const profileIds = [...new Set([page.document_owner_id, ...members.map((member) => member.user_id), ...commentRows.flatMap((comment) => [comment.created_by, comment.deleted_by].filter(Boolean) as string[])])];
  const profileList = profileIds.length
    ? unwrap(await supabase.from("profiles").select("id, display_name").in("id", profileIds), "구성원 프로필")
    : [];
  const names = new Map((profileList ?? []).map((profile) => [profile.id, profile.display_name]));
  const currentUserId = authData.user?.id ?? "";
  const ownRole = members.find((member) => member.user_id === currentUserId)?.role;
  const workspaceMembers = members.map((member) => ({ userId: member.user_id, name: names.get(member.user_id) || "이름 없음", role: member.role }));
  const commentThreads: CommentThread[] = threadRows.map((thread) => ({ id: thread.id, quote: thread.quote, anchorFrom: thread.anchor_from, anchorTo: thread.anchor_to, comments: commentRows.filter((comment) => comment.thread_id === thread.id).map((comment) => ({ id: comment.id, author: names.get(comment.created_by) || "이름 없음", at: new Date(comment.created_at).toLocaleString("ko-KR"), text: comment.body, ...(comment.deleted_by && comment.deleted_at ? { deletedBy: names.get(comment.deleted_by) || "이름 없음", deletedAt: new Date(comment.deleted_at).toLocaleString("ko-KR") } : {}) })) }));
  return <Workbench page={page} pages={pages} revisions={revisions} workspaceName={workspaceName} tree={pagesToTree(workspaceName, pages)} workspaceMembers={workspaceMembers} currentUserId={currentUserId} currentUserName={names.get(currentUserId) || "이름 없음"} documentOwnerName={names.get(page.document_owner_id) || "이름 없음"} canManageSharing={ownRole === "owner" || ownRole === "admin"} canGrantAdmin={ownRole === "owner"} canEdit={ownRole === "owner" || ownRole === "admin" || ownRole === "editor"} canSaveVersion={page.document_owner_id === currentUserId} commentThreads={commentThreads} />;
}
