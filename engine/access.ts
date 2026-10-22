import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkspacePermission, WorkspaceRole } from "./domain.ts";
import { EngineError, execute, requireId, requireLimit } from "./result.ts";

export type CustomRole = { id: string; workspace_id: string; name: string; permissions: WorkspacePermission[]; created_at: string };
export type WorkspaceMember = { user_id: string; display_name: string; role: WorkspaceRole; custom_role_id: string | null; role_name: string; permissions: WorkspacePermission[]; created_at: string };
export type SecurityEvent = { id: string; workspace_id: string; actor_id: string | null; subject_user_id: string | null; action: string; detail: Record<string, unknown>; created_at: string };
export type RoleInput = { workspaceId: string; name: string; permissions: WorkspacePermission[] };

function roleValues(input: RoleInput) {
  const name = input.name.trim();
  if (!name || [...name].length > 60 || !Array.isArray(input.permissions) || input.permissions.some(value => !["pages.write", "members.manage"].includes(value))) throw new EngineError("validation", "Invalid role name or permissions", "roles.save");
  return { target_workspace_id: requireId(input.workspaceId, "roles.save"), role_name: name, role_permissions: [...new Set(input.permissions)] };
}

export function createAccessOperations(client: SupabaseClient) {
  return {
    audit: {
      list: (workspaceId: string, limit = 50) => execute<SecurityEvent[]>("audit.list", () => client.from("workspace_security_events").select("id, workspace_id, actor_id, subject_user_id, action, detail, created_at").eq("workspace_id", requireId(workspaceId, "audit.list")).order("created_at", { ascending: false }).limit(requireLimit(limit, "audit.list"))),
    },
    members: {
      list: (workspaceId: string) => execute<WorkspaceMember[]>("members.list", () => client.rpc("list_workspace_members", { target_workspace_id: requireId(workspaceId, "members.list") })),
      assignRole: (workspaceId: string, userId: string, roleId: string) => execute<null>("members.assignRole", () => client.rpc("assign_workspace_role", { target_workspace_id: requireId(workspaceId, "members.assignRole"), target_user_id: requireId(userId, "members.assignRole"), target_role_id: requireId(roleId, "members.assignRole") })),
    },
    roles: {
      list: (workspaceId: string) => execute<CustomRole[]>("roles.list", () => client.from("workspace_roles").select("id, workspace_id, name, permissions, created_at").eq("workspace_id", requireId(workspaceId, "roles.list")).order("name")),
      create: (input: RoleInput) => execute<CustomRole>("roles.create", () => client.rpc("create_workspace_role", roleValues(input))),
      update: (roleId: string, input: RoleInput) => execute<CustomRole>("roles.update", () => client.rpc("update_workspace_role", { ...roleValues(input), target_role_id: requireId(roleId, "roles.update") })),
      delete: (workspaceId: string, roleId: string) => execute<null>("roles.delete", () => client.rpc("delete_workspace_role", { target_workspace_id: requireId(workspaceId, "roles.delete"), target_role_id: requireId(roleId, "roles.delete") })),
    },
  };
}
