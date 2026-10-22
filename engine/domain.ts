/**
 * Engine domain types and pure authorization hints.
 *
 * No runtime imports of any kind — not React, not Next, not TipTap, not the
 * Supabase client. This module is the one piece of the engine that may be
 * imported from anywhere (server component, browser bundle, a test under
 * `node --test`) without dragging a framework in, so it stays dependency-free
 * and side-effect-free.
 *
 * What lives here: the shapes the engine passes around, and `getCapabilities`
 * / `canManageMember`, which answer "should this control be visible?".
 *
 * What does NOT live here: the authorization decision itself. Per PRODUCT.md
 * ("권한 판정은 항상 서버에서 수행한다") the only boundary is Postgres RLS and
 * the `security definer` RPCs of 0019. Everything below mirrors those server
 * rules so the UI does not offer an action the server will refuse; a mismatch
 * is a UX bug, never a security hole. Nothing here decides billing or feature
 * entitlement — the plan limits in PRODUCT.md are undecided and are not to be
 * invented in code.
 */

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * A ProseMirror/TipTap document node, declared locally rather than imported
 * from `@tiptap/core`.
 *
 * Structurally compatible with TipTap's `JSONContent`, so a value of either
 * type is assignable to the other and `lib/pages.ts` needs no adapter. The
 * index signature is what makes that hold for extension-specific fields.
 */
export type DocumentNode = {
  type?: string;
  attrs?: Record<string, any>;
  content?: DocumentNode[];
  marks?: { type: string; attrs?: Record<string, any>; [key: string]: any }[];
  text?: string;
  [key: string]: any;
};

/** A page row as the API returns it — snake_case, matching `public.pages`. */
export type PageRecord = {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title: string;
  content: DocumentNode;
  position: number;
  created_at: string;
  updated_at: string;
  document_owner_id: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
};

/** A snapshot from `public.page_revisions`. */
export type PageRevision = {
  id: string;
  page_id: string;
  version: number;
  title: string;
  content: DocumentNode;
  // Why this version exists. Nullable on purpose — the server never requires
  // it (0016, docs/WHY.md §4).
  reason: string | null;
  created_at: string;
};

/**
 * A node of the space/page tree, structurally identical to `app/Tree.tsx`'s
 * `TreeNode` but without importing a React module into the engine.
 */
export type PageTreeNode = {
  name: string;
  kind: "space" | "page";
  id?: string;
  role?: string;
  locked?: boolean;
  children?: PageTreeNode[];
};

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/** `workspace_members.role`. Baseline role; custom permission grants are added by migration 0024. */
export type WorkspacePermission = "pages.write" | "members.manage";

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";

/**
 * The roles an RPC will accept as a target role. `owner` is absent because
 * 0019's `invite_workspace_member` / `set_workspace_member_role` both reject
 * `next_role = 'owner'`: ownership moves by workspace creation, not assignment.
 */
export type AssignableRole = Exclude<WorkspaceRole, "owner">;

/** One membership of the caller's own, as `lib/workspace-context.ts` models it. */
export type WorkspaceMembership = {
  customRoleId?: string;
  roleName?: string;
  permissions?: WorkspacePermission[];
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
  // ISO timestamp, used only to order memberships deterministically.
  createdAt: string;
};

/** Roles with workspace write capability — mirrors `can_edit_workspace()`. */
const EDIT_ROLES: readonly string[] = ["owner", "admin", "editor"];

/** Roles that may manage members — mirrors the `('owner','admin')` RPC guards. */
const MANAGE_ROLES: readonly string[] = ["owner", "admin"];

/** Every role the schema defines. Anything else is unknown and denies. */
const KNOWN_ROLES: readonly string[] = ["owner", "admin", "editor", "viewer"];

// ---------------------------------------------------------------------------
// Capability hints
// ---------------------------------------------------------------------------

export type Capabilities = {
  /** Read the workspace's pages at all — any membership, viewers included. */
  canRead: boolean;
  /** Write page content. `can_edit_workspace()`: owner, admin, editor. */
  canEdit: boolean;
  /** Invite, remove, or re-role members. Owner and admin. */
  canManageMembers: boolean;
  /** Grant the admin role. Owner only — `set_workspace_member_role` 0019. */
  canGrantAdmin: boolean;
  /** Save or restore a version: document owner who can still edit. */
  canRecordVersion: boolean;
  /** Hand the document to someone else: same rule as recording a version. */
  canTransferOwnership: boolean;
};

export type CapabilityInput = {
  /** The caller's role in the workspace, or null/undefined when not a member. */
  role: WorkspaceRole | null | undefined;
  /** Explicit custom permissions override baseline hints; DB still authorizes. */
  permissions?: readonly WorkspacePermission[];
  /** The caller's user id, when known. */
  userId?: string;
  /** `pages.document_owner_id` of the document in view, when there is one. */
  documentOwnerId?: string;
};

/** A factory, not a shared constant: callers must never alias one another's result. */
const denyAll = (): Capabilities => ({
  canRead: false,
  canEdit: false,
  canManageMembers: false,
  canGrantAdmin: false,
  canRecordVersion: false,
  canTransferOwnership: false,
});

/**
 * UI-only capability hints for one caller in one workspace, optionally for one
 * document. Pure: same input, same output, no I/O.
 *
 * Fails closed. A missing role (anonymous, not a member) and an unrecognized
 * role string both deny everything, which is the shape of 0019 §1: a NULL role
 * from `workspace_role()` is never allowed to read as "not disallowed".
 *
 * Document-owner powers need all three of: a non-empty owner id, a non-empty
 * caller id equal to it, and current edit capability. The last conjunct is not
 * redundant — an owner demoted to viewer, or removed from the workspace, loses
 * these controls, exactly as `save_page_version` and `transfer_page_ownership`
 * require. Empty strings are treated as "unknown", never as a match, so a page
 * with no owner and a caller with no id do not collide into ownership.
 */
export function getCapabilities({ role, permissions, userId, documentOwnerId }: CapabilityInput): Capabilities {
  if (role == null || !KNOWN_ROLES.includes(role)) return denyAll();

  const canEdit = permissions ? permissions.includes("pages.write") : EDIT_ROLES.includes(role);
  // Any membership reads — `is_workspace_member()` asks only that the role
  // is not NULL, so a viewer sees the page (and follows the live document).
  const canRead = true;

  const ownsDocument = Boolean(documentOwnerId) && Boolean(userId) && documentOwnerId === userId;
  const documentOwnerPowers = ownsDocument && canEdit;

  return {
    canRead,
    canEdit,
    canManageMembers: permissions ? permissions.includes("members.manage") : MANAGE_ROLES.includes(role),
    canGrantAdmin: role === "owner",
    canRecordVersion: documentOwnerPowers,
    canTransferOwnership: documentOwnerPowers,
  };
}

/**
 * May `actorRole` change or remove a member who currently holds `targetRole`?
 *
 * Mirrors the three guards shared by `invite_workspace_member`,
 * `set_workspace_member_role` and `remove_workspace_member` in 0019 §2:
 * the owner row is untouchable by anyone, an admin may not act on another
 * admin, and a non-manager may not act at all. Absent roles deny, and so does
 * an unrecognized one on either side — an unknown target is not treated as
 * "merely not the owner".
 *
 * This is about the *target*; whether a particular new role may be assigned is
 * a separate question — see `canGrantAdmin`.
 */
export function canManageMember(
  actorRole: WorkspaceRole | null | undefined,
  targetRole: WorkspaceRole | null | undefined,
): boolean {
  if (actorRole == null || targetRole == null) return false;
  if (!KNOWN_ROLES.includes(actorRole) || !KNOWN_ROLES.includes(targetRole)) return false;
  if (targetRole === "owner") return false;
  if (actorRole === "owner") return true;
  if (actorRole === "admin") return targetRole === "editor" || targetRole === "viewer";
  return false;
}
