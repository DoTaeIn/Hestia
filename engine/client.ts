import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssignableRole, DocumentNode, PageRecord, PageRevision, WorkspaceMembership } from "./domain.ts";
import { EngineError, execute, requireId, requireLimit } from "./result.ts";
import { createSupabaseAuthAdapter, type IdentityProvider } from "./auth.ts";
import { createAccessOperations } from "./access.ts";
import { createProfileOperations } from "./profiles.ts";

const PAGE_FIELDS = "id, workspace_id, parent_id, title, content, position, created_at, updated_at, document_owner_id, deleted_at, deleted_by";
const REVISION_FIELDS = "id, page_id, version, title, content, reason, created_at";
export type SearchRecord = { kind: "page" | "reason"; page_id: string; title: string; workspace_name: string; snippet: string | null; version: number | null };
export type WorkspaceRecord = { id: string; name: string; slug: string; owner_id: string };
export type MemberRecord = { user_id: string; display_name: string; role: AssignableRole };
export type NotificationRecord = { id: string; kind: "comment_on_document" | "reply_in_thread"; created_at: string; read_at: string | null; page_id: string | null; actor: { display_name: string | null } | null; page: { title: string } | null };

/** Session-scoped, UI-free application API. Database RLS/RPCs authorize every call. */
export function createHestiaEngine(client: SupabaseClient, options: { identity?: IdentityProvider } = {}) {
  const identity = options.identity ?? createSupabaseAuthAdapter(client);
  const id = requireId;
  function role(value: AssignableRole, operation: string) {
    if (!["admin", "editor", "viewer"].includes(value)) throw new EngineError("validation", "Invalid assignable role", operation);
    return value;
  }
  function document(value: DocumentNode, operation: string) {
    if (!value || value.type !== "doc" || (value.content !== undefined && !Array.isArray(value.content))) throw new EngineError("validation", "A ProseMirror document is required", operation);
    return value;
  }
  function changed(operation: string, query: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>) {
    return Promise.resolve(query).then(result => {
      if (!result.error && result.data === null) throw new EngineError("not_found", "Record not found or inaccessible", operation);
      return result;
    });
  }
  return {
    workspaces: {
      create: (input: { name: string }) => execute<WorkspaceRecord>("workspaces.create", async () => {
        const name = input.name.trim();
        if (name.length < 2 || name.length > 80) throw new EngineError("validation", "Workspace name must contain 2–80 characters", "workspaces.create");
        const auth = await identity.getUser();
        if (auth.error) throw auth.error;
        if (!auth.data) throw new EngineError("unauthenticated", "Authentication required", "workspaces.create");
        const workspaceId = crypto.randomUUID();
        const slug = `${name.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-|-$/g, "") || "workspace"}-${workspaceId.slice(0, 8)}`;
        const workspace = { id: workspaceId, name, slug, owner_id: auth.data.id };
        // RETURNING is evaluated before the AFTER INSERT membership trigger is
        // visible to the SELECT policy. A representation request rejects the
        // very first workspace creation despite a valid INSERT policy.
        const inserted = await client.from("workspaces").insert(workspace);
        return { data: inserted.error ? null : workspace, error: inserted.error };
      }),
      listMemberships: (userId: string) => execute<WorkspaceMembership[]>("workspaces.listMemberships", async () => {
        const result = await client.from("workspace_members").select("workspace_id, role, created_at, custom_role_id, workspace_roles(name, permissions), workspaces(name)").eq("user_id", id(userId, "workspaces.listMemberships")).order("created_at");
        if (result.error) return result;
        const rows = result.data as unknown as Array<{ workspace_id: string; role: WorkspaceMembership["role"]; created_at: string; workspaces: { name: string } | null; custom_role_id?: string | null; workspace_roles?: { name: string; permissions: WorkspaceMembership["permissions"] } | null }>;
        return { data: rows.filter(row => row.workspaces).map(row => ({ workspaceId: row.workspace_id, workspaceName: row.workspaces!.name, role: row.role, createdAt: row.created_at, ...(row.custom_role_id ? { customRoleId: row.custom_role_id, roleName: row.workspace_roles?.name ?? "삭제된 역할", permissions: row.workspace_roles?.permissions ?? [] } : {}) })), error: null };
      }),
      invite: (input: { workspaceId: string; email: string; role: AssignableRole }) => execute<MemberRecord[]>("workspaces.invite", () => {
        const email = input.email.trim();
        if (!email || !email.includes("@")) throw new EngineError("validation", "An email address is required", "workspaces.invite");
        return client.rpc("invite_workspace_member", { target_workspace_id: id(input.workspaceId, "workspaces.invite"), member_email: email, next_role: role(input.role, "workspaces.invite") });
      }),
      removeMember: (workspaceId: string, userId: string) => execute<null>("workspaces.removeMember", () => client.rpc("remove_workspace_member", { target_workspace_id: id(workspaceId, "workspaces.removeMember"), target_user_id: id(userId, "workspaces.removeMember") })),
      setMemberRole: (workspaceId: string, userId: string, nextRole: AssignableRole) => execute<null>("workspaces.setMemberRole", () => client.rpc("set_workspace_member_role", { target_workspace_id: id(workspaceId, "workspaces.setMemberRole"), target_user_id: id(userId, "workspaces.setMemberRole"), next_role: role(nextRole, "workspaces.setMemberRole") })),
    },
    profiles: createProfileOperations(client, identity),
    ...createAccessOperations(client),
    pages: {
      get: (pageId: string) => execute<PageRecord | null>("pages.get", () => client.from("pages").select(PAGE_FIELDS).eq("id", id(pageId, "pages.get")).is("deleted_at", null).maybeSingle()),
      list: (workspaceId: string, options: { trashed?: boolean } = {}) => execute<PageRecord[]>("pages.list", () => {
        let query = client.from("pages").select(PAGE_FIELDS).eq("workspace_id", id(workspaceId, "pages.list"));
        query = options.trashed ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
        return options.trashed ? query.order("deleted_at", { ascending: false }) : query.order("position").order("created_at");
      }),
      create: (input: { id?: string; workspaceId: string; parentId?: string | null; title?: string; content?: DocumentNode }) => execute<PageRecord>("pages.create", () => client.from("pages").insert({
        id: id(input.id ?? crypto.randomUUID(), "pages.create"), workspace_id: id(input.workspaceId, "pages.create"),
        parent_id: input.parentId ? id(input.parentId, "pages.create") : null, title: input.title?.trim() || "제목 없는 문서",
        content: document(input.content ?? { type: "doc", content: [{ type: "paragraph" }] }, "pages.create"),
      }).select(PAGE_FIELDS).single()),
      move: (input: { pageId: string; parentId: string | null; position?: number }) => execute<{ id: string }>("pages.move", () => {
        const position = input.position ?? Date.now();
        if (!Number.isFinite(position)) throw new EngineError("validation", "Position must be finite", "pages.move");
        return changed("pages.move", client.from("pages").update({ parent_id: input.parentId ? id(input.parentId, "pages.move") : null, position }).eq("id", id(input.pageId, "pages.move")).select("id").maybeSingle());
      }),
      moveBefore: (pageId: string, beforePageId: string) => execute<null>("pages.moveBefore", () => client.rpc("move_page_before", { target_page_id: id(pageId, "pages.moveBefore"), before_page_id: id(beforePageId, "pages.moveBefore") })),
      trash: (pageId: string) => execute<null>("pages.trash", () => client.rpc("trash_page", { target_page_id: id(pageId, "pages.trash") })),
      restore: (pageId: string) => execute<null>("pages.restore", () => client.rpc("restore_page", { target_page_id: id(pageId, "pages.restore") })),
      transferOwnership: (pageId: string, userId: string) => execute<null>("pages.transferOwnership", () => client.rpc("transfer_page_ownership", { target_page_id: id(pageId, "pages.transferOwnership"), next_owner_id: id(userId, "pages.transferOwnership") })),
    },
    revisions: {
      list: (pageId: string) => execute<PageRevision[]>("revisions.list", () => client.from("page_revisions").select(REVISION_FIELDS).eq("page_id", id(pageId, "revisions.list")).order("version", { ascending: false })),
      save: (input: { pageId: string; title: string; content: DocumentNode; reason?: string | null }) => execute<PageRevision>("revisions.save", () => client.rpc("save_page_version", { target_page_id: id(input.pageId, "revisions.save"), next_title: input.title.trim() || "제목 없는 문서", next_content: document(input.content, "revisions.save"), change_reason: input.reason?.trim() || null })),
      restore: (input: { pageId: string; revisionId: string; reason?: string | null }) => execute<PageRevision>("revisions.restore", () => client.rpc("restore_page_revision", { target_page_id: id(input.pageId, "revisions.restore"), source_revision_id: id(input.revisionId, "revisions.restore"), change_reason: input.reason?.trim() || null })),
      setReason: (revisionId: string, reason: string) => execute<{ id: string }>("revisions.setReason", () => changed("revisions.setReason", client.from("page_revisions").update({ reason: reason.trim() || null }).eq("id", id(revisionId, "revisions.setReason")).select("id").maybeSingle())),
    },
    search: (workspaceId: string, term: string, limit = 60) => execute<SearchRecord[]>("search", () => {
      id(workspaceId, "search"); requireLimit(limit, "search");
      if (!term.trim()) return Promise.resolve({ data: [], error: null });
      return client.rpc("search_workspace", { target_workspace_id: workspaceId, term: term.trim() }).order("kind").limit(limit);
    }),
    comments: {
      createThread: (input: { id?: string; workspaceId: string; pageId: string; quote: string; from: number; to: number }) => execute<{ id: string }>("comments.createThread", () => {
        if (!Number.isInteger(input.from) || !Number.isInteger(input.to) || input.from < 0 || input.to <= input.from) throw new EngineError("validation", "Invalid comment anchor range", "comments.createThread");
        return client.from("comment_threads").insert({ id: id(input.id ?? crypto.randomUUID(), "comments.createThread"), workspace_id: id(input.workspaceId, "comments.createThread"), page_id: id(input.pageId, "comments.createThread"), quote: input.quote, anchor_from: input.from, anchor_to: input.to }).select("id").single();
      }),
      reply: (threadId: string, body: string) => execute<{ id: string; created_at: string }>("comments.reply", () => {
        if (!body.trim()) throw new EngineError("validation", "Comment body is required", "comments.reply");
        return client.from("comments").insert({ thread_id: id(threadId, "comments.reply"), body }).select("id, created_at").single();
      }),
      delete: (commentId: string) => execute<null>("comments.delete", () => client.rpc("soft_delete_comment", { target_comment_id: id(commentId, "comments.delete") })),
    },
    notifications: {
      list: (limit = 20) => execute<NotificationRecord[]>("notifications.list", () => client.from("notifications").select("id, kind, created_at, read_at, page_id, actor:profiles!actor_id(display_name), page:pages!page_id(title)").order("created_at", { ascending: false }).limit(requireLimit(limit, "notifications.list"))),
      markRead: (ids?: string[]) => execute<null>("notifications.markRead", () => client.rpc("mark_notifications_read", { target_ids: ids?.map(value => id(value, "notifications.markRead")) ?? null })),
    },
  };
}

export type HestiaEngine = ReturnType<typeof createHestiaEngine>;
