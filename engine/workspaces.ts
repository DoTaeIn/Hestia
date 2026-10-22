import type { WorkspaceMembership } from "./domain.ts";

export type WorkspaceSelection =
  | { status: "ok"; membership: WorkspaceMembership }
  // an explicit ?workspace= was requested but does not match any of the
  // caller's own memberships — never silently substitute another workspace here.
  | { status: "forbidden" }
  | { status: "none" };

/**
 * Picks the caller's workspace from their own memberships only.
 *
 * An explicit `requestedWorkspaceId` must match one of `memberships` or the
 * result is "forbidden" — it is never relaxed to "pick anything instead".
 * With no request, the fallback is the oldest membership by `createdAt`
 * (ties broken by `workspaceId`), so the same membership rows always resolve
 * to the same workspace rather than an arbitrary one.
 */
export function selectWorkspace(
  memberships: WorkspaceMembership[],
  requestedWorkspaceId?: string | null,
): WorkspaceSelection {
  if (requestedWorkspaceId) {
    const found = memberships.find((membership) => membership.workspaceId === requestedWorkspaceId);
    return found ? { status: "ok", membership: found } : { status: "forbidden" };
  }
  if (!memberships.length) return { status: "none" };
  const [fallback] = [...memberships].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.workspaceId.localeCompare(b.workspaceId));
  return { status: "ok", membership: fallback };
}
