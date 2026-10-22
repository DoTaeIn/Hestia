import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHestiaEngine } from "./client.ts";
import { getCapabilities } from "./domain.ts";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const roleId = "33333333-3333-4333-8333-333333333333";

test("custom membership management does not imply document editing or version ownership", () => {
  const cap = getCapabilities({ role: "viewer", permissions: ["members.manage"], userId, documentOwnerId: userId });
  assert.equal(cap.canManageMembers, true); assert.equal(cap.canEdit, false); assert.equal(cap.canRecordVersion, false); assert.equal(cap.canGrantAdmin, false);
});
test("custom edit permission still requires document ownership for version operations", () => {
  assert.equal(getCapabilities({ role: "viewer", permissions: ["pages.write"], userId, documentOwnerId: roleId }).canRecordVersion, false);
  assert.equal(getCapabilities({ role: "viewer", permissions: ["pages.write"], userId, documentOwnerId: userId }).canRecordVersion, true);
  assert.equal(getCapabilities({ role: "viewer", permissions: [] }).canEdit, false);
  assert.equal(getCapabilities({ role: null, permissions: ["members.manage"] }).canManageMembers, false);
});
test("role writes reject unknown permissions and IDs before a database call", async () => {
  let calls = 0;
  const engine = createHestiaEngine({ rpc: () => { calls++; return Promise.resolve({ data: null, error: null }); } } as unknown as SupabaseClient);
  assert.equal((await engine.roles.create({ workspaceId, name: "bad", permissions: ["owner"] as never })).error?.code, "validation");
  assert.equal((await engine.members.assignRole(workspaceId, userId, "bad-id")).error?.code, "validation");
  assert.equal((await engine.roles.create({ workspaceId, name: " ", permissions: [] })).error?.code, "validation");
  assert.equal(calls, 0);
});
test("role assignment preserves workspace boundary and database rejection", async () => {
  const calls: unknown[] = [];
  const engine = createHestiaEngine({ rpc: (name: string, input: unknown) => { calls.push([name,input]); return Promise.resolve({ data: null, error: { code: "42501", message: "Not allowed" } }); } } as unknown as SupabaseClient);
  const result = await engine.members.assignRole(workspaceId,userId,roleId);
  assert.equal(result.error?.code,"forbidden");
  assert.deepEqual(calls,[["assign_workspace_role",{ target_workspace_id:workspaceId,target_user_id:userId,target_role_id:roleId }]]);
});
