export const WORKSPACE_PARAM = "workspace";

export type { WorkspaceMembership } from "../engine/domain.ts";

export { selectWorkspace, type WorkspaceSelection } from "../engine/workspaces.ts";

/** Sets (or overwrites) the `workspace` query param on a relative path, preserving other params and any #hash. */
export function workspaceHref(path: string, workspaceId: string | null | undefined): string {
  if (!workspaceId) return path;
  const hashIndex = path.indexOf("#");
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const queryIndex = withoutHash.indexOf("?");
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const query = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "";
  const params = new URLSearchParams(query);
  params.set(WORKSPACE_PARAM, workspaceId);
  return `${pathname}?${params.toString()}${hash}`;
}
