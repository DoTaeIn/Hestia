// node --test engine/client.test.ts
//
// Owns a fluent recording fake of SupabaseClient so these tests exercise
// exactly what engine/client.ts sends over the wire (table/rpc name, the
// chained filter/select calls, and the payload) without a real database.
// Public API: engine/client.ts and docs/developers/integration.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHestiaEngine } from "./client.ts";

type BackendError = { message: string; code?: string };
type ChainEntry = { method: string; args: unknown[] };
type RecordedCall = { table?: string; rpc?: string; rpcArgs?: unknown; chain: ChainEntry[] };
type Outcome = { data: unknown; error: BackendError | null } | { fail: unknown };

/** One `.from()`/`.rpc()` invocation: records every chained call, then resolves to a queued outcome when awaited. */
class FakeQueryBuilder {
  private readonly client: FakeSupabaseClient;
  private readonly call: RecordedCall;
  constructor(client: FakeSupabaseClient, call: RecordedCall) {
    this.client = client;
    this.call = call;
  }

  private push(method: string, args: unknown[]) {
    this.call.chain.push({ method, args });
    return this;
  }

  select(...args: unknown[]) { return this.push("select", args); }
  insert(...args: unknown[]) { return this.push("insert", args); }
  update(...args: unknown[]) { return this.push("update", args); }
  eq(...args: unknown[]) { return this.push("eq", args); }
  is(...args: unknown[]) { return this.push("is", args); }
  not(...args: unknown[]) { return this.push("not", args); }
  order(...args: unknown[]) { return this.push("order", args); }
  limit(...args: unknown[]) { return this.push("limit", args); }
  single() { return this.push("single", []); }
  maybeSingle() { return this.push("maybeSingle", []); }

  then<A, B>(
    onFulfilled?: ((value: { data: unknown; error: BackendError | null }) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    this.client.recordCall(this.call);
    const outcome = this.client.consumeOutcome(this.call);
    if ("fail" in outcome) return Promise.reject(outcome.fail).then(onFulfilled as never, onRejected);
    return Promise.resolve(outcome).then(onFulfilled, onRejected);
  }
}

/** Records every request engine/client.ts issues; each distinct engine call gets its own instance (no shared session). */
class FakeSupabaseClient {
  readonly calls: RecordedCall[] = [];
  authCallCount = 0;
  private readonly outcomes = new Map<string, Outcome[]>();
  private readonly authUser: { id: string } | null;
  private readonly authError: BackendError | null;

  constructor(options: { user?: { id: string } | null; authError?: BackendError } = {}) {
    this.authUser = options.user ?? null;
    this.authError = options.authError ?? null;
  }

  queue(key: string, outcome: { data: unknown; error: BackendError | null }) {
    const list = this.outcomes.get(key) ?? [];
    list.push(outcome);
    this.outcomes.set(key, list);
  }

  queueFailure(key: string, reason: unknown) {
    const list = this.outcomes.get(key) ?? [];
    list.push({ fail: reason });
    this.outcomes.set(key, list);
  }

  recordCall(call: RecordedCall) { this.calls.push(call); }

  consumeOutcome(call: RecordedCall): Outcome {
    const key = call.table ?? call.rpc ?? "";
    const list = this.outcomes.get(key);
    if (!list || list.length === 0) {
      throw new Error(`FakeSupabaseClient: no queued outcome for "${key}" (recorded calls so far: ${this.calls.length})`);
    }
    return list.shift()!;
  }

  readonly auth = {
    getUser: async () => {
      this.authCallCount += 1;
      if (this.authError) return { data: { user: null }, error: this.authError };
      return { data: { user: this.authUser }, error: null };
    },
  };

  from(table: string) { return new FakeQueryBuilder(this, { table, chain: [] }); }
  rpc(name: string, args?: unknown) { return new FakeQueryBuilder(this, { rpc: name, rpcArgs: args, chain: [] }); }
}

function asClient(fake: FakeSupabaseClient) {
  return fake as unknown as SupabaseClient;
}

function insertArgs(call: RecordedCall): Record<string, unknown> {
  const entry = call.chain.find(c => c.method === "insert");
  return entry!.args[0] as Record<string, unknown>;
}

const USER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_USER_ID = "22222222-2222-2222-2222-222222222222";
const WORKSPACE_ID = "33333333-3333-3333-3333-333333333333";
const PAGE_ID = "44444444-4444-4444-4444-444444444444";
const REVISION_ID = "55555555-5555-5555-5555-555555555555";
const INVALID_UUID = "not-a-uuid";
const DOC = { type: "doc", content: [{ type: "paragraph" }] };

// ---------------------------------------------------------------------------
// workspaces
// ---------------------------------------------------------------------------

test("workspaces.create pins owner_id from auth.getUser, never from caller input", async () => {
  const client = new FakeSupabaseClient({ user: { id: USER_ID } });
  client.queue("workspaces", { data: { id: WORKSPACE_ID, name: "Team", slug: `team-${WORKSPACE_ID.slice(0, 8)}`, owner_id: USER_ID }, error: null });
  const engine = createHestiaEngine(asClient(client));

  const malicious = { name: "Team", owner_id: OTHER_USER_ID, id: OTHER_USER_ID } as Parameters<typeof engine.workspaces.create>[0];
  const result = await engine.workspaces.create(malicious);

  assert.equal(result.error, null);
  assert.equal(client.authCallCount, 1);
  const payload = insertArgs(client.calls[0]);
  assert.equal(payload.owner_id, USER_ID);
  assert.notEqual(payload.owner_id, OTHER_USER_ID);
  assert.ok(typeof payload.id === "string" && (payload.slug as string).endsWith((payload.id as string).slice(0, 8)));
  assert.deepEqual(result.data, payload);
  assert.ok(!client.calls[0].chain.some(call => call.method === "select"), "first-workspace INSERT must not request RETURNING before membership exists");
});

test("workspaces.create: anonymous caller is rejected before any insert is attempted", async () => {
  const client = new FakeSupabaseClient({ user: null });
  const engine = createHestiaEngine(asClient(client));

  const result = await engine.workspaces.create({ name: "Team" });

  assert.equal(result.data, null);
  assert.equal(result.error?.code, "unauthenticated");
  assert.equal(client.authCallCount, 1);
  assert.equal(client.calls.length, 0, "no transport should occur for an anonymous caller");
});

test("workspaces.create: invalid name length never reaches auth or transport", async () => {
  const client = new FakeSupabaseClient({ user: { id: USER_ID } });
  const engine = createHestiaEngine(asClient(client));

  const result = await engine.workspaces.create({ name: "x" });

  assert.equal(result.error?.code, "validation");
  assert.equal(client.authCallCount, 0);
  assert.equal(client.calls.length, 0);
});

test("workspaces.listMemberships scopes by the given userId and normalizes an invalid id without transport", async () => {
  const client = new FakeSupabaseClient();
  client.queue("workspace_members", { data: [], error: null });
  const engine = createHestiaEngine(asClient(client));

  const ok = await engine.workspaces.listMemberships(USER_ID);
  assert.equal(ok.error, null);
  assert.deepEqual(client.calls[0].chain.find(c => c.method === "eq")?.args, ["user_id", USER_ID]);

  const bad = await engine.workspaces.listMemberships(INVALID_UUID);
  assert.equal(bad.error?.code, "validation");
  assert.equal(client.calls.length, 1, "the invalid call must not add a second transport entry");
});

test("workspaces.invite rejects an unassignable role before any RPC call", async () => {
  const client = new FakeSupabaseClient();
  const engine = createHestiaEngine(asClient(client));

  const result = await engine.workspaces.invite({ workspaceId: WORKSPACE_ID, email: "a@b.com", role: "owner" as never });

  assert.equal(result.error?.code, "validation");
  assert.equal(client.calls.length, 0);
});

test("workspaces.invite sends the normalized email and role to the RPC", async () => {
  const client = new FakeSupabaseClient();
  client.queue("invite_workspace_member", { data: [{ user_id: OTHER_USER_ID, display_name: "Bob", role: "editor" }], error: null });
  const engine = createHestiaEngine(asClient(client));

  const result = await engine.workspaces.invite({ workspaceId: WORKSPACE_ID, email: "  a@b.com  ", role: "editor" });

  assert.equal(result.error, null);
  assert.deepEqual(client.calls[0].rpcArgs, { target_workspace_id: WORKSPACE_ID, member_email: "a@b.com", next_role: "editor" });
});

// ---------------------------------------------------------------------------
// pages: list / get
// ---------------------------------------------------------------------------

test("pages.list filters explicitly by workspace, and active vs. trash are distinct scopes", async () => {
  const client = new FakeSupabaseClient();
  client.queue("pages", { data: [{ id: PAGE_ID }], error: null });
  client.queue("pages", { data: [{ id: PAGE_ID }], error: null });
  const engine = createHestiaEngine(asClient(client));

  const active = await engine.pages.list(WORKSPACE_ID);
  const trashed = await engine.pages.list(WORKSPACE_ID, { trashed: true });

  assert.equal(active.error, null);
  assert.equal(trashed.error, null);
  const [activeCall, trashCall] = client.calls;
  assert.deepEqual(activeCall.chain.find(c => c.method === "eq")?.args, ["workspace_id", WORKSPACE_ID]);
  assert.ok(activeCall.chain.some(c => c.method === "is" && c.args[0] === "deleted_at" && c.args[1] === null));
  assert.ok(!activeCall.chain.some(c => c.method === "not"));
  assert.deepEqual(trashCall.chain.find(c => c.method === "eq")?.args, ["workspace_id", WORKSPACE_ID]);
  assert.ok(trashCall.chain.some(c => c.method === "not" && c.args[0] === "deleted_at" && c.args[1] === "is" && c.args[2] === null));
  assert.ok(!trashCall.chain.some(c => c.method === "is"));
});

test("pages.list rejects an invalid workspace id without any transport", async () => {
  const client = new FakeSupabaseClient();
  const engine = createHestiaEngine(asClient(client));

  const result = await engine.pages.list(INVALID_UUID);

  assert.equal(result.error?.code, "validation");
  assert.equal(client.calls.length, 0);
});

test("pages.get: a missing row is null data with no error, not a thrown not_found", async () => {
  const client = new FakeSupabaseClient();
  client.queue("pages", { data: null, error: null });
  const engine = createHestiaEngine(asClient(client));

  const result = await engine.pages.get(PAGE_ID);

  assert.deepEqual(result, { data: null, error: null });
  assert.ok(client.calls[0].chain.some(c => c.method === "maybeSingle"));
});

test("pages.get rejects an invalid id without any transport", async () => {
  const client = new FakeSupabaseClient();
  const engine = createHestiaEngine(asClient(client));

  const result = await engine.pages.get(INVALID_UUID);

  assert.equal(result.error?.code, "validation");
  assert.equal(client.calls.length, 0);
});

// ---------------------------------------------------------------------------
// pages: create
// ---------------------------------------------------------------------------

test("pages.create never forwards caller-supplied owner/ownership fields, and defaults the title", async () => {
  const client = new FakeSupabaseClient();
  client.queue("pages", { data: { id: PAGE_ID, title: "제목 없는 문서" }, error: null });
  const engine = createHestiaEngine(asClient(client));

  const malicious = {
    workspaceId: WORKSPACE_ID,
    document_owner_id: OTHER_USER_ID,
    deleted_at: "2020-01-01",
    deleted_by: OTHER_USER_ID,
    created_at: "2020-01-01",
  } as Parameters<typeof engine.pages.create>[0];
  const result = await engine.pages.create(malicious);

  assert.equal(result.error, null);
  const payload = insertArgs(client.calls[0]);
  assert.deepEqual(Object.keys(payload).sort(), ["content", "id", "parent_id", "title", "workspace_id"]);
  assert.equal(payload.title, "제목 없는 문서");
});

test("pages.create rejects a malformed document without any transport", async () => {
  const client = new FakeSupabaseClient();
  const engine = createHestiaEngine(asClient(client));

  const result = await engine.pages.create({ workspaceId: WORKSPACE_ID, content: { type: "paragraph" } });

  assert.equal(result.error?.code, "validation");
  assert.equal(client.calls.length, 0);
});

// ---------------------------------------------------------------------------
// pages: move / setReason — zero affected rows become not_found
// ---------------------------------------------------------------------------

test("pages.move: zero affected rows normalizes to not_found", async () => {
  const client = new FakeSupabaseClient();
  client.queue("pages", { data: null, error: null });
  const engine = createHestiaEngine(asClient(client));

  const result = await engine.pages.move({ pageId: PAGE_ID, parentId: null, position: 1 });

  assert.equal(result.data, null);
  assert.equal(result.error?.code, "not_found");
});

test("pages.move rejects a non-finite position without any transport", async () => {
  const client = new FakeSupabaseClient();
  const engine = createHestiaEngine(asClient(client));

  const result = await engine.pages.move({ pageId: PAGE_ID, parentId: null, position: Number.POSITIVE_INFINITY });

  assert.equal(result.error?.code, "validation");
  assert.equal(client.calls.length, 0);
});

test("revisions.setReason: zero affected rows normalizes to not_found, and reasons are trimmed to null", async () => {
  const client = new FakeSupabaseClient();
  client.queue("page_revisions", { data: null, error: null });
  const engine = createHestiaEngine(asClient(client));

  const result = await engine.revisions.setReason(REVISION_ID, "   ");

  assert.equal(result.error?.code, "not_found");
  const payload = client.calls[0].chain.find(c => c.method === "update")?.args[0] as Record<string, unknown>;
  assert.equal(payload.reason, null);
});

// ---------------------------------------------------------------------------
// revisions.save
// ---------------------------------------------------------------------------

test("revisions.save trims the reason, maps blank to null, and defaults the title", async () => {
  const client = new FakeSupabaseClient();
  client.queue("save_page_version", { data: { id: REVISION_ID, version: 2 }, error: null });
  const engine = createHestiaEngine(asClient(client));

  const result = await engine.revisions.save({ pageId: PAGE_ID, title: "  ", content: DOC, reason: "  because  " });

  assert.equal(result.error, null);
  assert.deepEqual(client.calls[0].rpcArgs, {
    target_page_id: PAGE_ID,
    next_title: "제목 없는 문서",
    next_content: DOC,
    change_reason: "because",
  });
});

test("revisions.save maps a blank or absent reason to null", async () => {
  const client = new FakeSupabaseClient();
  client.queue("save_page_version", { data: { id: REVISION_ID, version: 2 }, error: null });
  client.queue("save_page_version", { data: { id: REVISION_ID, version: 3 }, error: null });
  const engine = createHestiaEngine(asClient(client));

  await engine.revisions.save({ pageId: PAGE_ID, title: "Doc", content: DOC, reason: "   " });
  await engine.revisions.save({ pageId: PAGE_ID, title: "Doc", content: DOC });

  assert.equal((client.calls[0].rpcArgs as { change_reason: unknown }).change_reason, null);
  assert.equal((client.calls[1].rpcArgs as { change_reason: unknown }).change_reason, null);
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

test("search issues a two-argument RPC scoped to the workspace and chains the limit", async () => {
  const client = new FakeSupabaseClient();
  client.queue("search_workspace", { data: [], error: null });
  const engine = createHestiaEngine(asClient(client));

  const result = await engine.search(WORKSPACE_ID, "roadmap", 10);

  assert.equal(result.error, null);
  const call = client.calls[0];
  assert.deepEqual(call.rpcArgs, { target_workspace_id: WORKSPACE_ID, term: "roadmap" });
  assert.ok(call.chain.some(c => c.method === "limit" && c.args[0] === 10));
});

test("search defaults the limit to 60", async () => {
  const client = new FakeSupabaseClient();
  client.queue("search_workspace", { data: [], error: null });
  const engine = createHestiaEngine(asClient(client));

  await engine.search(WORKSPACE_ID, "roadmap");

  assert.ok(client.calls[0].chain.some(c => c.method === "limit" && c.args[0] === 60));
});

test("search short-circuits on a blank term without issuing any RPC call", async () => {
  const client = new FakeSupabaseClient();
  const engine = createHestiaEngine(asClient(client));

  const result = await engine.search(WORKSPACE_ID, "   ");

  assert.deepEqual(result, { data: [], error: null });
  assert.equal(client.calls.length, 0);
});

test("search rejects an invalid workspace id or an out-of-range limit without any transport", async () => {
  const client = new FakeSupabaseClient();
  const engine = createHestiaEngine(asClient(client));

  const badWorkspace = await engine.search(INVALID_UUID, "roadmap");
  assert.equal(badWorkspace.error?.code, "validation");

  const badLimit = await engine.search(WORKSPACE_ID, "roadmap", 0);
  assert.equal(badLimit.error?.code, "validation");

  const tooBig = await engine.search(WORKSPACE_ID, "roadmap", 101);
  assert.equal(tooBig.error?.code, "validation");

  assert.equal(client.calls.length, 0);
});

// ---------------------------------------------------------------------------
// comments
// ---------------------------------------------------------------------------

test("comments.createThread rejects an invalid anchor range without any transport", async () => {
  const client = new FakeSupabaseClient();
  const engine = createHestiaEngine(asClient(client));

  const equalRange = await engine.comments.createThread({ workspaceId: WORKSPACE_ID, pageId: PAGE_ID, quote: "x", from: 5, to: 5 });
  const negative = await engine.comments.createThread({ workspaceId: WORKSPACE_ID, pageId: PAGE_ID, quote: "x", from: -1, to: 3 });

  assert.equal(equalRange.error?.code, "validation");
  assert.equal(negative.error?.code, "validation");
  assert.equal(client.calls.length, 0);
});

test("comments.createThread inserts a valid anchor range scoped to the workspace and page", async () => {
  const client = new FakeSupabaseClient();
  client.queue("comment_threads", { data: { id: "66666666-6666-6666-6666-666666666666" }, error: null });
  const engine = createHestiaEngine(asClient(client));

  const result = await engine.comments.createThread({ workspaceId: WORKSPACE_ID, pageId: PAGE_ID, quote: "hi", from: 0, to: 2 });

  assert.equal(result.error, null);
  const payload = insertArgs(client.calls[0]);
  assert.equal(payload.workspace_id, WORKSPACE_ID);
  assert.equal(payload.page_id, PAGE_ID);
  assert.equal(payload.anchor_from, 0);
  assert.equal(payload.anchor_to, 2);
});

// ---------------------------------------------------------------------------
// notifications
// ---------------------------------------------------------------------------

test("notifications.list defaults to a limit of 20 and accepts a smaller explicit limit", async () => {
  const client = new FakeSupabaseClient();
  client.queue("notifications", { data: [], error: null });
  client.queue("notifications", { data: [], error: null });
  const engine = createHestiaEngine(asClient(client));

  await engine.notifications.list();
  await engine.notifications.list(5);

  assert.ok(client.calls[0].chain.some(c => c.method === "limit" && c.args[0] === 20));
  assert.ok(client.calls[1].chain.some(c => c.method === "limit" && c.args[0] === 5));
});

test("notifications.list rejects an out-of-range limit without any transport", async () => {
  const client = new FakeSupabaseClient();
  const engine = createHestiaEngine(asClient(client));

  const zero = await engine.notifications.list(0);
  const tooBig = await engine.notifications.list(101);

  assert.equal(zero.error?.code, "validation");
  assert.equal(tooBig.error?.code, "validation");
  assert.equal(client.calls.length, 0);
});

test("notifications.markRead validates every id and passes null for an absent list", async () => {
  const client = new FakeSupabaseClient();
  client.queue("mark_notifications_read", { data: null, error: null });
  const engine = createHestiaEngine(asClient(client));

  const invalid = await engine.notifications.markRead([INVALID_UUID]);
  assert.equal(invalid.error?.code, "validation");
  assert.equal(client.calls.length, 0, "an invalid id must not reach the RPC");

  await engine.notifications.markRead();
  assert.deepEqual(client.calls[0].rpcArgs, { target_ids: null });
});

// ---------------------------------------------------------------------------
// DB error normalization and transport-exception safety
// ---------------------------------------------------------------------------

test("a unique-violation from the database normalizes to a conflict, not a thrown error", async () => {
  const client = new FakeSupabaseClient({ user: { id: USER_ID } });
  client.queue("workspaces", { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "workspaces_slug_key"' } });
  const engine = createHestiaEngine(asClient(client));

  const result = await engine.workspaces.create({ name: "Team" });

  assert.equal(result.data, null);
  assert.equal(result.error?.code, "conflict");
  assert.equal(result.error?.databaseCode, "23505");
});

test("a server-side ownership rejection on move normalizes to forbidden", async () => {
  const client = new FakeSupabaseClient();
  client.queue("pages", { data: null, error: { code: "42501", message: "not allowed: only the document owner may move this page" } });
  const engine = createHestiaEngine(asClient(client));

  const result = await engine.pages.move({ pageId: PAGE_ID, parentId: null, position: 1 });

  assert.equal(result.error?.code, "forbidden");
});

test("a thrown network failure is returned as an EngineResult, never thrown to the caller", async () => {
  const client = new FakeSupabaseClient();
  client.queueFailure("pages", new TypeError("fetch failed"));
  const engine = createHestiaEngine(asClient(client));

  const result = await engine.pages.list(WORKSPACE_ID);

  assert.equal(result.data, null);
  assert.equal(result.error?.code, "unavailable");
});

// ---------------------------------------------------------------------------
// session isolation
// ---------------------------------------------------------------------------

test("two engines over two fake clients never share calls or auth state", async () => {
  const clientA = new FakeSupabaseClient({ user: { id: USER_ID } });
  const clientB = new FakeSupabaseClient({ user: { id: OTHER_USER_ID } });
  clientA.queue("workspaces", { data: { id: WORKSPACE_ID, name: "A", slug: "a", owner_id: USER_ID }, error: null });
  clientB.queue("pages", { data: null, error: null });

  const engineA = createHestiaEngine(asClient(clientA));
  const engineB = createHestiaEngine(asClient(clientB));

  const created = await engineA.workspaces.create({ name: "Team A" });
  assert.equal(created.error, null);
  await engineB.pages.get(PAGE_ID);

  assert.equal(clientA.calls.length, 1);
  assert.equal(clientA.calls[0].table, "workspaces");
  assert.equal(clientB.calls.length, 1);
  assert.equal(clientB.calls[0].table, "pages");
  assert.equal(clientA.authCallCount, 1);
  assert.equal(clientB.authCallCount, 0, "pages.get never touches auth.getUser");
});
