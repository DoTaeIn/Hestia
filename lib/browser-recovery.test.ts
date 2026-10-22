import { test } from "node:test";
import assert from "node:assert/strict";
import { ownRecoveryKeys, clearOwnRecovery } from "./browser-recovery.ts";
test("clearing recovery is scoped to owned document data and never auth or another user", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const rows = new Map([[`hestia:collab-op:${id}:page:1:op`, "doc"], [`hestia:title-draft:${id}:page:tab`, "title"], ["hestia:collab-op:22222222-2222-4222-8222-222222222222:page:1:op", "other"], ["sb-auth-token", "session"]]);
  const storage = { get length() { return rows.size; }, key: (n: number) => [...rows.keys()][n] ?? null, getItem: (key: string) => rows.get(key) ?? null, removeItem: (key: string) => { rows.delete(key); } };
  assert.equal(ownRecoveryKeys(storage, "").length, 0); assert.equal(clearOwnRecovery(storage,id),2); assert.equal(rows.get("sb-auth-token"),"session"); assert.equal(rows.size,2);
});
