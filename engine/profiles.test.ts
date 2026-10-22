import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHestiaEngine } from "./client.ts";
import { normalizeProfile } from "./profiles.ts";
import type { IdentityProvider } from "./auth.ts";

const userId = "11111111-1111-4111-8111-111111111111";
function fixture(data: unknown = { id: userId, display_name: "팀원", avatar_url: null, created_at: "2026-10-22" }, error: { message: string; code?: string } | null = null) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  let identities = 0;
  const identity: IdentityProvider = { getUser: async () => { identities++; return { data: { id: userId, email: "test@example.test" }, error: null }; } };
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "update", "single", "maybeSingle"]) builder[method] = (...args: unknown[]) => { calls.push({ method, args }); return builder; };
  builder.then = (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve, reject);
  const client = { from: (table: string) => { calls.push({ method: "from", args: [table] }); return builder; }, auth: { getUser: () => { throw new Error("Host identity adapter must be used"); } } } as unknown as SupabaseClient;
  return { engine: createHestiaEngine(client, { identity }), calls, identityCount: () => identities };
}

test("profile normalization trims names, clears avatars, and counts Unicode characters", () => {
  assert.deepEqual(normalizeProfile({ displayName: "  팀원  ", avatarUrl: "" }), { display_name: "팀원", avatar_url: null });
  assert.equal(normalizeProfile({ displayName: "😀".repeat(80) }).display_name.length, 160);
  assert.equal(normalizeProfile({ displayName: "팀원", avatarUrl: " https://example.com " }).avatar_url, "https://example.com/");
});
test("profiles getSelf uses the injected verified identity without invoking a hardcoded login mechanism", async () => {
  const f = fixture(); const result = await f.engine.profiles.getSelf();
  assert.equal(result.error, null);
  assert.ok(f.calls.some(call => call.method === "eq" && call.args[0] === "id" && call.args[1] === userId));
  assert.equal(f.identityCount(), 1);
});
test("profile update has an allowlist and never forwards caller-controlled id, email, role or creation timestamp", async () => {
  const f = fixture();
  const input = { displayName: "새 이름", avatarUrl: null, id: crypto.randomUUID(), role: "owner", email: "spoof@example.test", created_at: "2000-01-01" };
  const result = await f.engine.profiles.updateSelf(input);
  assert.equal(result.error, null);
  assert.deepEqual(f.calls.find(call => call.method === "update")?.args, [{ display_name: "새 이름", avatar_url: null }]);
  assert.ok(f.calls.some(call => call.method === "eq" && call.args[1] === userId));
});
test("invalid profiles are rejected before authentication or database access", async () => {
  const values = [{ displayName: " " }, { displayName: "x".repeat(81) }, { displayName: "팀원", avatarUrl: "javascript:alert(1)" }, { displayName: "팀원", avatarUrl: "data:image/png;base64,AAAA" }, { displayName: "팀원", avatarUrl: "https://name:password@example.com/image" }, { displayName: "팀원", avatarUrl: "not-a-url" }, { displayName: "팀원", avatarUrl: "https://example.com/" + "x".repeat(2048) }];
  for (const input of values) {
    const f = fixture(); const result = await f.engine.profiles.updateSelf(input);
    assert.equal(result.error?.code, "validation");
    assert.equal(f.identityCount(), 0); assert.equal(f.calls.length, 0);
  }
});
test("a missing provisioned profile is not mistaken for an empty success", async () => {
  assert.equal((await fixture(null).engine.profiles.getSelf()).error?.code, "not_found");
});
test("database permission errors remain authoritative with a custom identity adapter", async () => {
  const f = fixture(null, { message: "permission denied", code: "42501" });
  assert.equal((await f.engine.profiles.updateSelf({ displayName: "팀원" })).error?.code, "forbidden");
});
test("anonymous identity cannot edit a profile", async () => {
  const identity: IdentityProvider = { getUser: async () => ({ data: null, error: null }) };
  const client = { from: () => { throw new Error("No database access expected"); } } as unknown as SupabaseClient;
  assert.equal((await createHestiaEngine(client, { identity }).profiles.updateSelf({ displayName: "팀원" })).error?.code, "unauthenticated");
});
