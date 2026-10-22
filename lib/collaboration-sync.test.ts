// node --test lib/collaboration-sync.test.ts
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { getSchema } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { saveRecoverySnapshot } from "./collaboration-recovery.ts";
import {
  buildSeedUpdate,
  classifyCollaborationError,
  CollaborationProviderCore,
  createMemoryOperationStore,
  decodePendingOperationsText,
  diffUpdate,
  encodeOwnStateVector,
  fromBase64,
  listPendingOperations,
  nextRetryDelayMs,
  operationKey,
  parseOperationKey,
  seedPageCollaboration,
  seedCollaborationDocument,
  toBase64,
  writePendingOperation,
  type BroadcastMessage,
  type CollaborationStatusDetail,
  type RealtimeChannelLike,
  type RealtimeClientLike,
  type Scheduler,
  type StaleRecoveryDetail,
  type SupabaseRpcClient,
} from "./collaboration-sync.ts";

const documents = new Set<Y.Doc>();
const providers = new Set<CollaborationProviderCore>();
function createDoc() { const doc = new Y.Doc(); documents.add(doc); return doc; }
class TestProvider extends CollaborationProviderCore {
  constructor(...args: ConstructorParameters<typeof CollaborationProviderCore>) { super(...args); providers.add(this); }
  destroy() { super.destroy(); providers.delete(this); }
}
afterEach(() => {
  for (const provider of providers) provider.destroy();
  for (const doc of documents) doc.destroy();
  providers.clear(); documents.clear();
});

const schema = getSchema([StarterKit.configure({ undoRedo: false })]);

// ---------------------------------------------------------------------------
// pure helpers
// ---------------------------------------------------------------------------

test("base64 round-trips arbitrary bytes, including a size crossing the chunk boundary", () => {
  const bytes = new Uint8Array(0x8000 + 17).map((_, i) => i % 256);
  assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
});

test("state-vector diff carries exactly the updates the peer is missing", () => {
  const a = createDoc();
  a.getText("body").insert(0, "hello");
  const b = createDoc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  a.getText("body").insert(5, " world");

  const diff = diffUpdate(a, encodeOwnStateVector(b));
  Y.applyUpdate(b, fromBase64(diff));

  assert.equal(b.getText("body").toString(), "hello world");
});

test("classifies restore, membership loss, and everything else distinctly", () => {
  assert.equal(classifyCollaborationError("This document was restored. Refresh to continue editing."), "stale-generation");
  assert.equal(classifyCollaborationError("Not allowed to collaborate on this page"), "forbidden");
  assert.equal(classifyCollaborationError("Authentication required"), "forbidden");
  assert.equal(classifyCollaborationError("fetch failed"), "transient");
});

test("retry backoff grows then stops", () => {
  const delays: (number | null)[] = [];
  for (let attempt = 0; attempt < 7; attempt++) delays.push(nextRetryDelayMs(attempt));
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000, null, null]);
});

test("buildSeedUpdate encodes a standalone update that reproduces the document text elsewhere, without touching a live doc passed in", () => {
  const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "씨앗" }] }] };
  const update = buildSeedUpdate(schema, content);
  const target = createDoc();
  Y.applyUpdate(target, fromBase64(update));
  assert.ok(target.getXmlFragment("default").toString().includes("씨앗"));

  const live = createDoc();
  live.getText("untouched").insert(0, "원본");
  buildSeedUpdate(schema, { type: "doc", content: [{ type: "paragraph" }] });
  assert.equal(live.getText("untouched").toString(), "원본");
});

// ---------------------------------------------------------------------------
// operation storage: one immutable key per operation
// ---------------------------------------------------------------------------

test("operation keys round-trip through parseOperationKey and list only the requested user/page/generation", () => {
  const store = createMemoryOperationStore();
  writePendingOperation(store, "user-1", "page-1", 3, "op-a", "AAA");
  writePendingOperation(store, "user-1", "page-1", 4, "op-b", "BBB");
  writePendingOperation(store, "user-2", "page-1", 3, "op-c", "CCC");

  const parsed = parseOperationKey(operationKey("user-1", "page-1", 3, "op-a"));
  assert.deepEqual(parsed, { userId: "user-1", pageId: "page-1", generation: 3, operationId: "op-a" });

  const genThree = listPendingOperations(store, "user-1", "page-1", 3);
  assert.deepEqual(genThree.map((op) => op.operationId), ["op-a"]);
  assert.equal(listPendingOperations(store, "user-2", "page-1", 3).length, 1);
});

test("decodePendingOperationsText renders stranded edits without throwing on a corrupt entry", () => {
  const scratch = createDoc();
  const update = toBase64(Y.encodeStateAsUpdate(prosemirrorSeed()));
  scratch.destroy();
  const text = decodePendingOperationsText([update, "not-base64-!!"]);
  assert.equal(typeof text, "string");
});

function prosemirrorSeed() {
  return buildSeedDoc();
}
function buildSeedDoc() {
  const doc = createDoc();
  doc.getText("plain").insert(0, "stranded");
  return doc;
}

// ---------------------------------------------------------------------------
// seed race: the CAS the server performs under its row lock
// ---------------------------------------------------------------------------

function fakeRpc(handlers: Record<string, (args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>>): SupabaseRpcClient {
  return {
    rpc(fn, args) {
      return {
        single: () => {
          const handler = handlers[fn];
          if (!handler) return Promise.reject(new Error(`no fake handler for ${fn}`));
          return handler(args);
        },
      };
    },
  };
}

test("seed race: the loser applies the winner's state and never merges its own seed in", async () => {
  let winningState: string | null = null;
  const client = fakeRpc({
    seed_page_collaboration: async (args) => {
      if (winningState === null) {
        winningState = args.seed_state as string;
        return { data: { collaboration_state: winningState, collaboration_generation: 1, seeded: true }, error: null };
      }
      return { data: { collaboration_state: winningState, collaboration_generation: 1, seeded: false }, error: null };
    },
  });

  const winnerDoc = createDoc();
  winnerDoc.getText("body").insert(0, "winner");
  const loserDoc = createDoc();
  loserDoc.getText("body").insert(0, "loser");

  const winnerResult = await seedPageCollaboration(client, "page-1", 1, toBase64(Y.encodeStateAsUpdate(winnerDoc)));
  const loserResult = await seedPageCollaboration(client, "page-1", 1, toBase64(Y.encodeStateAsUpdate(loserDoc)));

  assert.equal(winnerResult.seeded, true);
  assert.equal(loserResult.seeded, false);
  assert.equal(loserResult.state, winnerResult.state);

  const converged = createDoc();
  Y.applyUpdate(converged, fromBase64(loserResult.state!));
  assert.equal(converged.getText("body").toString(), "winner");
  winningState = null;
  const firstLiveDoc = createDoc();
  const secondLiveDoc = createDoc();
  await seedCollaborationDocument(client, "page-1", 1, toBase64(Y.encodeStateAsUpdate(winnerDoc)), firstLiveDoc, "seed");
  await seedCollaborationDocument(client, "page-1", 1, toBase64(Y.encodeStateAsUpdate(loserDoc)), secondLiveDoc, "seed");
  assert.equal(firstLiveDoc.getText("body").toString(), "winner", "the winning client's editor must not stay blank");
  assert.equal(secondLiveDoc.getText("body").toString(), "winner", "the loser must not merge its independent seed");
});

// ---------------------------------------------------------------------------
// provider core: deterministic fakes for client/realtime/scheduler, no real network/timers
// ---------------------------------------------------------------------------

function createFakeScheduler(): Scheduler & { advance(ms: number): Promise<void> } {
  let now = 0;
  let nextId = 0;
  const tasks = new Map<number, { due: number; fn: () => void }>();
  return {
    setTimeout(fn, ms) {
      const id = nextId++;
      tasks.set(id, { due: now + ms, fn });
      return id;
    },
    clearTimeout(handle) {
      tasks.delete(handle as number);
    },
    async advance(ms) {
      now += ms;
      const due = [...tasks.entries()].filter(([, t]) => t.due <= now).sort((a, b) => a[1].due - b[1].due);
      for (const [id, t] of due) {
        tasks.delete(id);
        t.fn();
        await Promise.resolve();
        await Promise.resolve();
      }
    },
  };
}

async function settle(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

type HubEntry = { listeners: { event: string; cb: (msg: BroadcastMessage) => void }[]; status: ((status: string) => void) | null };
type FakeChannel = RealtimeChannelLike & { simulateDrop(): void; simulateRestore(): void };

function createFakeRealtimeHub() {
  const topics = new Map<string, Set<HubEntry>>();
  const client: RealtimeClientLike = {
    channel(topic) {
      const entry: HubEntry = { listeners: [], status: null };
      let set = topics.get(topic);
      if (!set) {
        set = new Set();
        topics.set(topic, set);
      }
      const activeSet = set;
      const channel: FakeChannel = {
        on(_type, filter, cb) {
          entry.listeners.push({ event: filter.event, cb });
          return channel;
        },
        subscribe(cb) {
          entry.status = cb;
          activeSet.add(entry);
          queueMicrotask(() => cb("SUBSCRIBED"));
          return channel;
        },
        send(msg) {
          for (const other of activeSet) {
            if (other === entry) continue;
            for (const listener of other.listeners) if (listener.event === msg.event) listener.cb({ payload: msg.payload });
          }
          return Promise.resolve();
        },
        unsubscribe() {
          activeSet.delete(entry);
          return Promise.resolve();
        },
        simulateDrop() {
          activeSet.delete(entry);
          entry.status?.("CHANNEL_ERROR");
        },
        simulateRestore() {
          activeSet.add(entry);
          entry.status?.("SUBSCRIBED");
        },
      };
      return channel;
    },
  };
  return client;
}

type SentMessage = { event: string; payload: Record<string, unknown> };

/** Records every byte this provider puts on the wire, so tests can assert on the whole wire format. */
function capturingRealtime(hub: RealtimeClientLike) {
  const channels: FakeChannel[] = [];
  const sent: SentMessage[] = [];
  const configs: Record<string, unknown>[] = [];
  const realtime: RealtimeClientLike = {
    channel(topic, config) {
      const inner = hub.channel(topic, config) as FakeChannel;
      configs.push(config);
      const channel: FakeChannel = {
        ...inner,
        on: (type, filter, cb) => inner.on(type, filter, cb),
        subscribe: (cb) => inner.subscribe(cb),
        send(msg) {
          sent.push({ event: msg.event, payload: msg.payload });
          return inner.send(msg);
        },
        unsubscribe: () => inner.unsubscribe(),
        simulateDrop: () => inner.simulateDrop(),
        simulateRestore: () => inner.simulateRestore(),
      };
      channels.push(channel);
      return channel;
    },
  };
  return { realtime, channels, sent, configs };
}

/**
 * A shared in-memory stand-in for migration 0019's seed + append-only log, including the
 * row-level access check. Every client handed out reads/writes the same log, so two
 * providers can only ever converge through the database — which is the point of the
 * DB-authoritative protocol.
 */
function createFakeCollaborationDatabase(initialGeneration = 1) {
  const log: { seq: number; operation_id: string; payload: string }[] = [];
  let generation = initialGeneration;
  let state: string | null = null;
  const loads: string[] = [];
  const appends: string[] = [];

  function client(label: string, access: { allowed: boolean } = { allowed: true }): SupabaseRpcClient {
    return fakeRpc({
      load_page_collaboration: async () => {
        loads.push(label);
        if (!access.allowed) return { data: null, error: { message: "Not allowed to collaborate on this page" } };
        return {
          data: { collaboration_state: state, collaboration_generation: generation, should_seed: false, updates: log.map((entry) => ({ ...entry })) },
          error: null,
        };
      },
      append_page_collaboration_update: async (args) => {
        appends.push(label);
        const expectedGeneration = args.expected_generation as number;
        const operationId = args.operation_id as string;
        if (!access.allowed) return { data: null, error: { message: "Not allowed to collaborate on this page" } };
        if (expectedGeneration !== generation) return { data: { status: "stale_generation", collaboration_generation: generation }, error: null };
        if (log.some((entry) => entry.operation_id === operationId)) {
          return { data: { status: "duplicate", collaboration_generation: generation }, error: null };
        }
        log.push({ seq: log.length + 1, operation_id: operationId, payload: args.update_payload as string });
        return { data: { status: "appended", collaboration_generation: generation }, error: null };
      },
    });
  }

  return {
    client,
    loads,
    appends,
    get log() { return log; },
    get generation() { return generation; },
    /** what a restore does server-side: new generation, log and canonical state replaced */
    restoreTo(nextGeneration: number, nextState: string | null = null) {
      generation = nextGeneration;
      state = nextState;
      log.length = 0;
    },
    /** an edit landing in the log from somewhere this provider never heard about */
    appendExternally(payload: string, operationId = `external-${log.length + 1}`) {
      log.push({ seq: log.length + 1, operation_id: operationId, payload });
    },
  };
}

function makeStateWithText(text: string): string {
  const doc = createDoc();
  doc.getText("body").insert(0, text);
  const state = toBase64(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return state;
}

test("local edit is appended with a stable operation id and cleared from storage once the server confirms", async () => {
  const scheduler = createFakeScheduler();
  const store = createMemoryOperationStore();
  const hub = createFakeRealtimeHub();
  const appendCalls: Record<string, unknown>[] = [];
  const client = fakeRpc({
    load_page_collaboration: async () => ({ data: { collaboration_state: null, collaboration_generation: 1, should_seed: false, updates: [] }, error: null }),
    append_page_collaboration_update: async (args) => {
      appendCalls.push(args);
      return { data: { status: "appended", collaboration_generation: 1 }, error: null };
    },
  });
  const statuses: CollaborationStatusDetail[] = [];
  const doc = createDoc();
  const provider = new TestProvider(doc, "page-1", 1, { id: "user-1", name: "A" }, {
    client,
    realtime: hub,
    store,
    scheduler,
    onStatus: (detail) => statuses.push(detail),
  });
  await settle();

  doc.getText("body").insert(0, "hi");
  assert.equal(listPendingOperations(store, "user-1", "page-1", 1).length, 1);

  await scheduler.advance(300);
  await settle();

  assert.equal(appendCalls.length, 1);
  assert.equal(listPendingOperations(store, "user-1", "page-1", 1).length, 0);
  assert.ok(statuses.some((s) => s.status === "live"));

  provider.destroy();
});

test("a second local edit made while the first append is still awaiting its ack is queued and flushed in order, not dropped", async () => {
  const scheduler = createFakeScheduler();
  const store = createMemoryOperationStore();
  const hub = createFakeRealtimeHub();
  const releases: Array<(v: { data: unknown; error: null }) => void> = [];
  const appendCalls: Record<string, unknown>[] = [];
  const client = fakeRpc({
    append_page_collaboration_update: (args) => {
      appendCalls.push(args);
      return new Promise((resolve) => releases.push((v) => resolve(v)));
    },
  });
  const doc = createDoc();
  const provider = new TestProvider(doc, "page-1", 1, { id: "user-1", name: "A" }, { client, realtime: hub, store, scheduler });
  await settle();

  doc.getText("body").insert(0, "first");
  await scheduler.advance(300);
  await settle();
  assert.equal(appendCalls.length, 1); // first append in flight, not yet acked

  doc.getText("body").insert(5, "-second"); // new edit arrives before the ack
  assert.equal(listPendingOperations(store, "user-1", "page-1", 1).length, 2);

  releases[0]({ data: { status: "appended", collaboration_generation: 1 }, error: null });
  await settle();
  // the older ack must not clear the newer, still-in-flight edit's storage entry
  assert.equal(listPendingOperations(store, "user-1", "page-1", 1).length, 1);
  assert.equal(appendCalls.length, 2);

  releases[1]({ data: { status: "appended", collaboration_generation: 1 }, error: null });
  await settle();
  assert.equal(listPendingOperations(store, "user-1", "page-1", 1).length, 0);

  provider.destroy();
});

test("a transient failure retries the same operation id with the same payload until it succeeds", async () => {
  const scheduler = createFakeScheduler();
  const store = createMemoryOperationStore();
  const hub = createFakeRealtimeHub();
  const seenOperationIds: unknown[] = [];
  let attempt = 0;
  const client = fakeRpc({
    append_page_collaboration_update: async (args) => {
      seenOperationIds.push(args.operation_id);
      attempt += 1;
      if (attempt === 1) return { data: null, error: { message: "fetch failed" } };
      return { data: { status: "appended", collaboration_generation: 1 }, error: null };
    },
  });
  const doc = createDoc();
  const provider = new TestProvider(doc, "page-1", 1, { id: "user-1", name: "A" }, { client, realtime: hub, store, scheduler });
  await settle();

  doc.getText("body").insert(0, "retry me");
  await scheduler.advance(300);
  await settle();
  assert.equal(attempt, 1);
  assert.equal(listPendingOperations(store, "user-1", "page-1", 1).length, 1); // kept after the failed attempt

  await scheduler.advance(1000); // first backoff delay
  await settle();
  assert.equal(attempt, 2);
  assert.equal(seenOperationIds[0], seenOperationIds[1]); // same idempotency key reused
  assert.equal(listPendingOperations(store, "user-1", "page-1", 1).length, 0);

  provider.destroy();
});

test("duplicate status is treated as success and clears the pending operation", async () => {
  const scheduler = createFakeScheduler();
  const store = createMemoryOperationStore();
  const hub = createFakeRealtimeHub();
  const client = fakeRpc({
    append_page_collaboration_update: async () => ({ data: { status: "duplicate", collaboration_generation: 1 }, error: null }),
  });
  const doc = createDoc();
  const provider = new TestProvider(doc, "page-1", 1, { id: "user-1", name: "A" }, { client, realtime: hub, store, scheduler });
  await settle();

  doc.getText("body").insert(0, "already there");
  await scheduler.advance(300);
  await settle();

  assert.equal(listPendingOperations(store, "user-1", "page-1", 1).length, 0);
  provider.destroy();
});

test("stale_generation stops appending and sending, but preserves the edit for recovery", async () => {
  const scheduler = createFakeScheduler();
  const store = createMemoryOperationStore();
  const hub = createFakeRealtimeHub();
  let appendCount = 0;
  const client = fakeRpc({
    append_page_collaboration_update: async () => {
      appendCount += 1;
      return { data: { status: "stale_generation", collaboration_generation: 2 }, error: null };
    },
  });
  const statuses: CollaborationStatusDetail[] = [];
  const doc = createDoc();
  const { realtime, sent } = capturingRealtime(hub);
  const provider = new TestProvider(doc, "page-1", 1, { id: "user-1", name: "A" }, { client, realtime, store, scheduler, onStatus: (d) => statuses.push(d) });
  await settle();

  doc.getText("body").insert(0, "frozen");
  await scheduler.advance(300);
  await settle();

  assert.equal(appendCount, 1);
  assert.equal(listPendingOperations(store, "user-1", "page-1", 1).length, 1); // not cleared — stale, not persisted
  const staleStatus = statuses.find((s) => s.status === "stale");
  assert.ok(staleStatus);
  assert.equal(staleStatus?.retryable, false);

  // further local edits must neither call append again nor put anything on the wire
  doc.getText("body").insert(0, "more ");
  await scheduler.advance(10000);
  await settle();
  assert.equal(appendCount, 1);
  assert.deepEqual(sent, [], "a frozen session must emit no notices, not even for the stale_generation attempt");

  provider.destroy();
});

test("revoked membership is classified distinctly from a transient failure and also freezes the session", async () => {
  const scheduler = createFakeScheduler();
  const store = createMemoryOperationStore();
  const hub = createFakeRealtimeHub();
  const client = fakeRpc({
    append_page_collaboration_update: async () => ({ data: null, error: { message: "Not allowed to collaborate on this page" } }),
  });
  const statuses: CollaborationStatusDetail[] = [];
  const doc = createDoc();
  const provider = new TestProvider(doc, "page-1", 1, { id: "user-1", name: "A" }, { client, realtime: hub, store, scheduler, onStatus: (d) => statuses.push(d) });
  await settle();

  doc.getText("body").insert(0, "no longer a member");
  await scheduler.advance(300);
  await settle();

  const forbidden = statuses.find((s) => s.status === "forbidden");
  assert.ok(forbidden);
  assert.equal(forbidden?.retryable, false);

  // A frozen client must leave the channel and ignore anything a peer still sends it,
  // whether that is a legacy raw-data event or the new invalidation notice.
  const peer = hub.channel("page-v2:page-1", { config: { private: true } });
  peer.subscribe(() => {});
  await settle();
  await peer.send({ type: "broadcast", event: "yjs-update", payload: { generation: 1, update: makeStateWithText("must not arrive") } });
  await peer.send({ type: "broadcast", event: "yjs-persisted", payload: { generation: 1 } });
  await scheduler.advance(50);
  await settle();
  assert.equal(doc.getText("body").toString(), "no longer a member");
  await peer.unsubscribe();

  assert.equal(listPendingOperations(store, "user-1", "page-1", 1).length, 1); // edit preserved, not replayed anywhere

  provider.destroy();
});

test("destroy then reopen replays the still-pending operation exactly once and flushes it without a new edit", async () => {
  const scheduler = createFakeScheduler();
  const store = createMemoryOperationStore();
  const hub = createFakeRealtimeHub();
  const client = fakeRpc({
    append_page_collaboration_update: async () => new Promise(() => {}), // never resolves — simulates "offline" for the whole first session
  });
  const docA = createDoc();
  const providerA = new TestProvider(docA, "page-1", 1, { id: "user-1", name: "A" }, { client, realtime: hub, store, scheduler });
  await settle();
  docA.getText("body").insert(0, "typed before reload");
  await scheduler.advance(300);
  await settle();
  assert.equal(listPendingOperations(store, "user-1", "page-1", 1).length, 1);
  providerA.destroy();

  let appended = false;
  const resumedClient = fakeRpc({
    append_page_collaboration_update: async () => {
      appended = true;
      return { data: { status: "appended", collaboration_generation: 1 }, error: null };
    },
  });
  const docB = createDoc();
  const providerB = new TestProvider(docB, "page-1", 1, { id: "user-1", name: "A" }, { client: resumedClient, realtime: hub, store, scheduler });
  await settle();
  assert.equal(docB.getText("body").toString(), "typed before reload"); // recovered into the doc before any new edit

  await scheduler.advance(300); // flush was triggered on construction, with no new edit needed
  await settle();
  assert.ok(appended);
  assert.equal(listPendingOperations(store, "user-1", "page-1", 1).length, 0);

  providerB.destroy();
});

test("reconnect loads DB deltas so a peer that already left is still recovered, not just missed", async () => {
  const scheduler = createFakeScheduler();
  const store = createMemoryOperationStore();
  const hub = createFakeRealtimeHub();
  const peerState = makeStateWithText("peer wrote this while we were disconnected");
  const client = fakeRpc({
    load_page_collaboration: async () => ({
      data: { collaboration_state: peerState, collaboration_generation: 1, should_seed: false, updates: [] },
      error: null,
    }),
  });
  const doc = createDoc();
  const { realtime, channels } = capturingRealtime(hub);
  const provider = new TestProvider(doc, "page-1", 1, { id: "user-1", name: "A" }, { client, realtime, store, scheduler });
  await settle();

  channels[0].simulateDrop();
  await settle();
  channels[0].simulateRestore();
  await settle();

  assert.equal(doc.getText("body").toString(), "peer wrote this while we were disconnected");
  provider.destroy();
});

test("a generation bump discovered during DB catch-up freezes the session (restore while disconnected)", async () => {
  const scheduler = createFakeScheduler();
  const store = createMemoryOperationStore();
  const hub = createFakeRealtimeHub();
  const client = fakeRpc({
    load_page_collaboration: async () => ({
      data: { collaboration_state: null, collaboration_generation: 2, should_seed: true, updates: [] },
      error: null,
    }),
  });
  const statuses: CollaborationStatusDetail[] = [];
  const doc = createDoc();
  const { realtime, channels } = capturingRealtime(hub);
  const provider = new TestProvider(doc, "page-1", 1, { id: "user-1", name: "A" }, { client, realtime, store, scheduler, onStatus: (d) => statuses.push(d) });
  await settle();

  channels[0].simulateDrop();
  await settle();
  channels[0].simulateRestore();
  await settle();

  assert.ok(statuses.some((s) => s.status === "stale"));
  provider.destroy();
});

// ---------------------------------------------------------------------------
// wire format: the channel carries invalidation notices only, never document data
// ---------------------------------------------------------------------------

test("nothing but a {generation} notice ever goes on the wire, and only after the database acked the append", async () => {
  const scheduler = createFakeScheduler();
  const db = createFakeCollaborationDatabase();
  const hub = createFakeRealtimeHub();
  const { realtime, sent, configs } = capturingRealtime(hub);
  const doc = createDoc();
  const provider = new TestProvider(doc, "page-1", 1, { id: "user-1", name: "A" }, {
    client: db.client("a"), realtime, store: createMemoryOperationStore(), scheduler,
  });
  await settle();

  // no presence tracking: joining a page must not publish who is here
  assert.equal((configs[0].config as { presence?: unknown }).presence, undefined);
  assert.equal((configs[0].config as { private?: boolean }).private, true);

  doc.getText("body").insert(0, "secret body text");
  await settle();
  assert.equal(sent.length, 0, "a local edit must not put anything on the wire before it is persisted");

  await scheduler.advance(300);
  await settle();

  assert.equal(db.log.length, 1);
  assert.equal(sent.length, 1, "exactly one notice, emitted after the ack");
  assert.equal(sent[0].event, "yjs-persisted");
  assert.deepEqual(Object.keys(sent[0].payload), ["generation"]);
  assert.equal(sent[0].payload.generation, 1);
  // no document bytes, state vector, user name or awareness data anywhere on the wire
  const wire = JSON.stringify(sent);
  assert.ok(!wire.includes(db.log[0].payload));
  assert.ok(!wire.includes("user-1") && !wire.includes("\"A\""));

  provider.destroy();
});

test("awareness stays local: no awareness/presence traffic is produced by local state changes", async () => {
  const scheduler = createFakeScheduler();
  const db = createFakeCollaborationDatabase();
  const hub = createFakeRealtimeHub();
  const { realtime, sent } = capturingRealtime(hub);
  const doc = createDoc();
  const provider = new TestProvider(doc, "page-1", 1, { id: "user-1", name: "A" }, {
    client: db.client("a"), realtime, store: createMemoryOperationStore(), scheduler,
  });
  await settle();

  provider.awareness.setLocalStateField("user", { name: "A", color: "#f00" });
  provider.awareness.setLocalStateField("cursor", { anchor: 3, head: 7 });
  await settle();
  await scheduler.advance(5000);
  await settle();

  assert.deepEqual(sent, [], "awareness and cursor changes must produce no traffic at all");
  // kept for TipTap's collaboration extension, just never connected to the network
  assert.ok(provider.awareness.getLocalState());

  provider.destroy();
});

test("two clients converge only through the database: persisted append plus a notice", async () => {
  const scheduler = createFakeScheduler();
  const db = createFakeCollaborationDatabase();
  const hub = createFakeRealtimeHub();

  const docA = createDoc();
  const providerA = new TestProvider(docA, "page-1", 1, { id: "user-1", name: "A" }, {
    client: db.client("a"), realtime: hub, store: createMemoryOperationStore(), scheduler,
  });
  const docB = createDoc();
  const statusesB: CollaborationStatusDetail[] = [];
  const providerB = new TestProvider(docB, "page-1", 1, { id: "user-2", name: "B" }, {
    client: db.client("b"), realtime: hub, store: createMemoryOperationStore(), scheduler, onStatus: (d) => statusesB.push(d),
  });
  await settle();

  docA.getText("body").insert(0, "written by A");
  await settle();
  assert.equal(docB.getText("body").toString(), "", "B must not see the edit before it is in the database");

  await scheduler.advance(300); // A's append + its post-ack notice
  await settle();
  await scheduler.advance(50); // B's debounced, notice-triggered database load
  await settle();

  assert.equal(docB.getText("body").toString(), "written by A");
  assert.equal(statusesB.at(-1)?.status, "live");

  // and back the other way, through the same path
  docB.getText("body").insert(12, " and B");
  await scheduler.advance(300);
  await settle();
  await scheduler.advance(50);
  await settle();
  assert.equal(docA.getText("body").toString(), "written by A and B");

  providerA.destroy();
  providerB.destroy();
});

test("a receiver whose access was revoked cannot read new document data through its still-open channel", async () => {
  const scheduler = createFakeScheduler();
  const db = createFakeCollaborationDatabase();
  const hub = createFakeRealtimeHub();

  const docA = createDoc();
  const providerA = new TestProvider(docA, "page-1", 1, { id: "user-1", name: "A" }, {
    client: db.client("a"), realtime: hub, store: createMemoryOperationStore(), scheduler,
  });
  const revokedAccess = { allowed: true };
  const docB = createDoc();
  const storeB = createMemoryOperationStore();
  const statusesB: CollaborationStatusDetail[] = [];
  const providerB = new TestProvider(docB, "page-1", 1, { id: "user-2", name: "B" }, {
    client: db.client("b", revokedAccess), realtime: hub, store: storeB, scheduler, onStatus: (d) => statusesB.push(d),
  });
  await settle();

  // B typed something before losing access, and keeps a subscribed channel afterwards
  docB.getText("body").insert(0, "B's own draft");
  revokedAccess.allowed = false;

  docA.getText("body").insert(0, "post-revocation secret");
  await scheduler.advance(300); // A persists and notices; B's load is the only way in
  await settle();
  await scheduler.advance(50);
  await settle();

  assert.ok(!docB.getText("body").toString().includes("post-revocation secret"), "RLS-rejected load must leak nothing");
  assert.equal(statusesB.at(-1)?.status, "forbidden");
  assert.equal(statusesB.at(-1)?.retryable, false);
  // B's own stranded edit is still preserved locally for recovery
  assert.equal(listPendingOperations(storeB, "user-2", "page-1", 1).length, 1);

  // further notices change nothing: a frozen session performs no more loads
  const loadsAfterFreeze = db.loads.filter((label) => label === "b").length;
  docA.getText("body").insert(0, "more secrets ");
  await scheduler.advance(10000);
  await settle();
  assert.equal(db.loads.filter((label) => label === "b").length, loadsAfterFreeze);
  assert.ok(!docB.getText("body").toString().includes("more secrets"));

  providerA.destroy();
  providerB.destroy();
});

test("a revoked writer's raw legacy injection is ignored: unpersisted data never reaches another document", async () => {
  const scheduler = createFakeScheduler();
  const db = createFakeCollaborationDatabase();
  const hub = createFakeRealtimeHub();
  const doc = createDoc();
  const provider = new TestProvider(doc, "page-1", 1, { id: "user-1", name: "A" }, {
    client: db.client("a"), realtime: hub, store: createMemoryOperationStore(), scheduler,
  });
  await settle();

  // an old client (or an attacker whose channel authorization is still cached) replays the
  // entire pre-break protocol: raw updates, a sync response, and awareness
  const attacker = hub.channel("page-v2:page-1", { config: { private: true } });
  attacker.subscribe(() => {});
  await settle();
  await attacker.send({ type: "broadcast", event: "yjs-update", payload: { generation: 1, update: makeStateWithText("injected"), operation_id: "x" } });
  await attacker.send({ type: "broadcast", event: "yjs-sync-response", payload: { generation: 1, update: makeStateWithText("injected"), to: "anyone" } });
  await attacker.send({ type: "broadcast", event: "yjs-awareness", payload: { generation: 1, update: makeStateWithText("injected") } });
  await scheduler.advance(5000);
  await settle();

  assert.equal(doc.getText("body").toString(), "", "no legacy event may apply data");
  assert.equal(db.log.length, 0, "and nothing unpersisted was created server-side either");

  await attacker.unsubscribe();
  provider.destroy();
});

test("a malicious sync request provokes no document response", async () => {
  const scheduler = createFakeScheduler();
  const db = createFakeCollaborationDatabase();
  const hub = createFakeRealtimeHub();
  const { realtime, sent } = capturingRealtime(hub);
  const doc = createDoc();
  const provider = new TestProvider(doc, "page-1", 1, { id: "user-1", name: "A" }, {
    client: db.client("a"), realtime, store: createMemoryOperationStore(), scheduler,
  });
  await settle();
  doc.getText("body").insert(0, "confidential");
  await scheduler.advance(300);
  await settle();
  sent.length = 0;

  const attacker = hub.channel("page-v2:page-1", { config: { private: true } });
  const received: SentMessage[] = [];
  attacker.on("broadcast", { event: "yjs-sync-response" }, (msg) => received.push({ event: "yjs-sync-response", payload: msg.payload }));
  attacker.on("broadcast", { event: "yjs-update" }, (msg) => received.push({ event: "yjs-update", payload: msg.payload }));
  attacker.subscribe(() => {});
  await settle();
  await attacker.send({ type: "broadcast", event: "yjs-sync-request", payload: { generation: 1, vector: encodeOwnStateVector(createDoc()), from: "attacker" } });
  await scheduler.advance(5000);
  await settle();

  assert.deepEqual(received, [], "the provider must never answer a state-vector request with document bytes");
  assert.deepEqual(sent.filter((msg) => msg.event !== "yjs-persisted"), []);

  await attacker.unsubscribe();
  provider.destroy();
});

// ---------------------------------------------------------------------------
// notices are hints, the database is the authority
// ---------------------------------------------------------------------------

test("a flood of forged/malformed notices collapses into one debounced load and applies nothing", async () => {
  const scheduler = createFakeScheduler();
  const db = createFakeCollaborationDatabase();
  const hub = createFakeRealtimeHub();
  const doc = createDoc();
  const provider = new TestProvider(doc, "page-1", 1, { id: "user-1", name: "A" }, {
    client: db.client("a"), realtime: hub, store: createMemoryOperationStore(), scheduler,
  });
  await settle();
  const loadsAfterSubscribe = db.loads.length;
  assert.equal(loadsAfterSubscribe, 1);

  const attacker = hub.channel("page-v2:page-1", { config: { private: true } });
  attacker.subscribe(() => {});
  await settle();
  for (let i = 0; i < 50; i++) {
    await attacker.send({ type: "broadcast", event: "yjs-persisted", payload: { generation: 1 } });
    await attacker.send({ type: "broadcast", event: "yjs-persisted", payload: {} });
    await attacker.send({ type: "broadcast", event: "yjs-persisted", payload: { generation: "nonsense", update: makeStateWithText("injected") } });
  }
  await settle();
  assert.equal(db.loads.length, loadsAfterSubscribe, "notices are debounced, never handled inline");

  await scheduler.advance(50);
  await settle();
  assert.equal(db.loads.length, loadsAfterSubscribe + 1, "150 notices cost exactly one load");
  assert.equal(doc.getText("body").toString(), "", "a notice can never carry data, however it is shaped");

  await attacker.unsubscribe();
  provider.destroy();
});

test("the database's generation wins over the notice's: a forged newer generation does not freeze a healthy session", async () => {
  const scheduler = createFakeScheduler();
  const db = createFakeCollaborationDatabase();
  const hub = createFakeRealtimeHub();
  const statuses: CollaborationStatusDetail[] = [];
  const doc = createDoc();
  const provider = new TestProvider(doc, "page-1", 1, { id: "user-1", name: "A" }, {
    client: db.client("a"), realtime: hub, store: createMemoryOperationStore(), scheduler, onStatus: (d) => statuses.push(d),
  });
  await settle();

  const attacker = hub.channel("page-v2:page-1", { config: { private: true } });
  attacker.subscribe(() => {});
  await settle();
  await attacker.send({ type: "broadcast", event: "yjs-persisted", payload: { generation: 9999 } });
  await scheduler.advance(50);
  await settle();

  assert.ok(!statuses.some((s) => s.status === "stale"), "the hint must not be trusted to freeze the session");
  assert.equal(statuses.at(-1)?.status, "live");

  // the reverse direction too: a notice claiming our own generation cannot hide a real restore
  db.restoreTo(2);
  await attacker.send({ type: "broadcast", event: "yjs-persisted", payload: { generation: 1 } });
  await scheduler.advance(50);
  await settle();
  assert.ok(statuses.some((s) => s.status === "stale"));

  await attacker.unsubscribe();
  provider.destroy();
});

test("a notice arriving while a load is in flight causes exactly one follow-up load, not one per notice", async () => {
  const scheduler = createFakeScheduler();
  const hub = createFakeRealtimeHub();
  let loads = 0;
  const releases: Array<() => void> = [];
  const client = fakeRpc({
    load_page_collaboration: () => {
      loads++;
      return new Promise((resolve) => releases.push(() => resolve({ data: { collaboration_state: null, collaboration_generation: 1, should_seed: false, updates: [] }, error: null })));
    },
  });
  const doc = createDoc();
  const provider = new TestProvider(doc, "page-1", 1, { id: "user-1", name: "A" }, {
    client, realtime: hub, store: createMemoryOperationStore(), scheduler,
  });
  await settle();
  assert.equal(loads, 1); // the subscribe catch-up, still in flight

  const attacker = hub.channel("page-v2:page-1", { config: { private: true } });
  attacker.subscribe(() => {});
  await settle();
  for (let i = 0; i < 10; i++) await attacker.send({ type: "broadcast", event: "yjs-persisted", payload: { generation: 1 } });
  await scheduler.advance(50);
  await settle();
  assert.equal(loads, 1, "no overlapping loads while one is in flight");

  releases[0]();
  await settle();
  await scheduler.advance(50);
  await settle();
  assert.equal(loads, 2, "exactly one coalesced follow-up");

  await attacker.unsubscribe();
  provider.destroy();
});

// ---------------------------------------------------------------------------
// polling: lost notices, revocation and restores that produced no local edit
// ---------------------------------------------------------------------------

test("polling every 5s picks up a database edit whose notice never arrived, without overlapping or spinning", async () => {
  const scheduler = createFakeScheduler();
  const db = createFakeCollaborationDatabase();
  const hub = createFakeRealtimeHub();
  const doc = createDoc();
  const provider = new TestProvider(doc, "page-1", 1, { id: "user-1", name: "A" }, {
    client: db.client("a"), realtime: hub, store: createMemoryOperationStore(), scheduler,
  });
  await settle();
  assert.equal(db.loads.length, 1);

  db.appendExternally(makeStateWithText("landed with no notice"));
  await scheduler.advance(5000); // one poll interval
  await settle();

  assert.equal(doc.getText("body").toString(), "landed with no notice");
  assert.equal(db.loads.length, 2, "one poll per interval — a recursive timer must not spin when time advances");

  await scheduler.advance(5000); // one poll interval
  await settle();
  assert.equal(db.loads.length, 3);

  provider.destroy();
  await scheduler.advance(5000 *4);
  await settle();
  assert.equal(db.loads.length, 3, "a destroyed provider stops polling");
});

test("polling discovers revoked access while the session sits idle, and then stops", async () => {
  const scheduler = createFakeScheduler();
  const db = createFakeCollaborationDatabase();
  const access = { allowed: true };
  const hub = createFakeRealtimeHub();
  const statuses: CollaborationStatusDetail[] = [];
  const store = createMemoryOperationStore();
  const doc = createDoc();
  const provider = new TestProvider(doc, "page-1", 1, { id: "user-1", name: "A" }, {
    client: db.client("a", access), realtime: hub, store, scheduler, onStatus: (d) => statuses.push(d),
  });
  await settle();
  doc.getText("body").insert(0, "my own work");
  await scheduler.advance(300);
  await settle();

  access.allowed = false;
  await scheduler.advance(5000); // one poll interval
  await settle();

  assert.equal(statuses.at(-1)?.status, "forbidden");
  const loadsAtFreeze = db.loads.length;
  await scheduler.advance(5000 *3);
  await settle();
  assert.equal(db.loads.length, loadsAtFreeze, "a forbidden session must not keep polling");

  provider.destroy();
});

test("polling discovers a restore that happened with no local edit to reveal it", async () => {
  const scheduler = createFakeScheduler();
  const db = createFakeCollaborationDatabase();
  const hub = createFakeRealtimeHub();
  const statuses: CollaborationStatusDetail[] = [];
  const doc = createDoc();
  const provider = new TestProvider(doc, "page-1", 1, { id: "user-1", name: "A" }, {
    client: db.client("a"), realtime: hub, store: createMemoryOperationStore(), scheduler, onStatus: (d) => statuses.push(d),
  });
  await settle();

  db.restoreTo(2, makeStateWithText("restored content"));
  await scheduler.advance(5000); // one poll interval
  await settle();

  assert.ok(statuses.some((s) => s.status === "stale"));
  assert.equal(doc.getText("body").toString(), "", "a superseded session must not adopt the restored state");

  provider.destroy();
});

test("a disconnected client neither claims to be live nor keeps calling the database until it reconnects", async () => {
  const scheduler = createFakeScheduler();
  const db = createFakeCollaborationDatabase();
  const hub = createFakeRealtimeHub();
  const { realtime, channels } = capturingRealtime(hub);
  const statuses: CollaborationStatusDetail[] = [];
  const doc = createDoc();
  const provider = new TestProvider(doc, "page-1", 1, { id: "user-1", name: "A" }, {
    client: db.client("a"), realtime, store: createMemoryOperationStore(), scheduler, onStatus: (d) => statuses.push(d),
  });
  await settle();

  channels[0].simulateDrop();
  await settle();
  assert.equal(statuses.at(-1)?.status, "offline");

  const loadsWhileDown = db.loads.length;
  await scheduler.advance(5000 *3);
  await settle();
  assert.equal(db.loads.length, loadsWhileDown, "no polling while offline");
  assert.notEqual(statuses.at(-1)?.status, "live");

  db.appendExternally(makeStateWithText("missed while offline"));
  channels[0].simulateRestore();
  await settle();
  assert.equal(doc.getText("body").toString(), "missed while offline");
  assert.equal(statuses.at(-1)?.status, "live");

  await scheduler.advance(5000); // one poll interval
  await settle();
  assert.equal(db.loads.length, loadsWhileDown + 2, "polling resumes once reconnected");

  provider.destroy();
});

test("stale pending operations from a superseded generation are surfaced for export, never replayed into the live doc", async () => {
  const scheduler = createFakeScheduler();
  const store = createMemoryOperationStore();
  const hub = createFakeRealtimeHub();
  const client = fakeRpc({});

  const strandedDoc = createDoc();
  Y.applyUpdate(strandedDoc, fromBase64(buildSeedUpdate(schema, { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "seed" }] }] })));
  const vector = Y.encodeStateVector(strandedDoc);
  const paragraph = strandedDoc.getXmlFragment("default").get(0) as Y.XmlElement;
  (paragraph.get(0) as Y.XmlText).insert(4, " edited before a restore landed");
  saveRecoverySnapshot(store, "user-1", "page-1", 1, "old-tab", strandedDoc);
  writePendingOperation(store, "user-1", "page-1", 1, "stale-op", toBase64(Y.encodeStateAsUpdate(strandedDoc, vector)));

  const recovered: StaleRecoveryDetail[] = [];
  const doc = createDoc(); // the restored document, generation 2 — must stay empty
  const provider = new TestProvider(doc, "page-1", 2, { id: "user-1", name: "A" }, {
    client,
    realtime: hub,
    store,
    scheduler,
    onStaleRecovery: (detail) => recovered.push(detail),
  });
  await settle();

  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].generation, 1);
  assert.ok(recovered[0].text.includes("edited before a restore landed"));
  assert.equal(doc.getText("plain").toString(), ""); // never replayed into the restored doc

  recovered[0].clear();
  assert.equal(listPendingOperations(store, "user-1", "page-1", 1).length, 0);

  provider.destroy();
});

test("blocked/unavailable storage is reported truthfully instead of promising retention", async () => {
  const scheduler = createFakeScheduler();
  const store = createMemoryOperationStore(false); // simulates a full/blocked localStorage
  const hub = createFakeRealtimeHub();
  const client = fakeRpc({
    append_page_collaboration_update: async () => ({ data: { status: "stale_generation", collaboration_generation: 2 }, error: null }),
  });
  const statuses: CollaborationStatusDetail[] = [];
  const doc = createDoc();
  const provider = new TestProvider(doc, "page-1", 1, { id: "user-1", name: "A" }, { client, realtime: hub, store, scheduler, onStatus: (d) => statuses.push(d) });
  await settle();

  doc.getText("body").insert(0, "x");
  await scheduler.advance(300);
  await settle();

  const stale = statuses.find((s) => s.status === "stale");
  assert.ok(stale?.message?.includes("저장 공간을 사용할 수 없어"));

  provider.destroy();
});

test("garbage on the channel, legacy or new, is ignored instead of crashing the session", async () => {
  const scheduler = createFakeScheduler();
  const store = createMemoryOperationStore();
  const hub = createFakeRealtimeHub();
  const db = createFakeCollaborationDatabase();

  const doc = createDoc();
  const provider = new TestProvider(doc, "page-1", 1, { id: "user-1", name: "A" }, { client: db.client("a"), realtime: hub, store, scheduler });
  await settle();

  const intruder = hub.channel("page-v2:page-1", {});
  intruder.subscribe(() => {});
  await settle();
  // legacy events with missing/corrupt/mismatched fields, plus a notice with no payload at all
  intruder.send({ type: "broadcast", event: "yjs-update", payload: { generation: 1 } });
  intruder.send({ type: "broadcast", event: "yjs-update", payload: { generation: 999, update: toBase64(new Uint8Array([1, 2, 3])) } });
  intruder.send({ type: "broadcast", event: "yjs-sync-request", payload: {} });
  intruder.send({ type: "broadcast", event: "yjs-persisted", payload: { generation: null, update: toBase64(new Uint8Array([1, 2, 3])) } });
  await scheduler.advance(50);
  await settle();

  assert.equal(doc.getText("body").toString(), "");
  provider.destroy();
});

test("the first subscription catches up from the database even when the editing peer has already left", async () => {
  const scheduler = createFakeScheduler();
  const hub = createFakeRealtimeHub();
  const statuses: CollaborationStatusDetail[] = [];
  let loads = 0;
  let privateChannel = false;
  const client = fakeRpc({
    load_page_collaboration: async () => {
      loads++;
      return { data: { collaboration_state: makeStateWithText("edit made during the join gap"), collaboration_generation: 1, should_seed: false, updates: [] }, error: null };
    },
  });
  const doc = createDoc();
  new TestProvider(doc, "page-1", 1, { id: "user-1", name: "A" }, {
    client, scheduler, store: createMemoryOperationStore(),
    realtime: { channel: (topic, config) => {
      privateChannel = (config.config as { private?: boolean }).private === true;
      return hub.channel(topic, config);
    } },
    onStatus: (status) => statuses.push(status),
  });
  await settle();
  assert.equal(loads, 1);
  assert.equal(privateChannel, true);
  assert.equal(doc.getText("body").toString(), "edit made during the join gap");
  assert.equal(statuses.at(-1)?.status, "live");
});

test("a storage exception does not crash editing or prevent the in-memory operation from reaching the server", async () => {
  const scheduler = createFakeScheduler();
  const statuses: CollaborationStatusDetail[] = [];
  let appends = 0;
  const store = { ...createMemoryOperationStore(), setItem() { throw new Error("quota exceeded"); } };
  const client = fakeRpc({
    load_page_collaboration: async () => ({ data: { collaboration_state: null, collaboration_generation: 1, should_seed: false, updates: [] }, error: null }),
    append_page_collaboration_update: async () => { appends++; return { data: { status: "appended", collaboration_generation: 1 }, error: null }; },
  });
  const doc = createDoc();
  new TestProvider(doc, "page-1", 1, { id: "user-1", name: "A" }, {
    client, scheduler, store, realtime: createFakeRealtimeHub(), onStatus: (status) => statuses.push(status),
  });
  await settle();
  assert.doesNotThrow(() => doc.getText("body").insert(0, "keep this edit"));
  assert.ok(statuses.some((status) => status.message?.includes("탭을 닫기 전에")));
  await scheduler.advance(300);
  await settle();
  assert.equal(appends, 1);
});


test("a permanent payload rejection stops retries and preserves the outbox for export", async () => {
  const scheduler = createFakeScheduler(); const doc = createDoc(); const store = createMemoryOperationStore(); const statuses: CollaborationStatusDetail[] = []; let writes = 0;
  const client = fakeRpc({
    load_page_collaboration: async () => ({ data: { collaboration_state: null, collaboration_generation: 1, should_seed: false, updates: [] }, error: null }),
    append_page_collaboration_update: async () => { writes++; return { data: null, error: { message: "Invalid collaboration update encoding" } }; },
  });
  new TestProvider(doc,"page-1",1,{ id:"user-1",name:"user" },{ client, realtime:createFakeRealtimeHub(),store,scheduler,onStatus:status=>statuses.push(status) });
  await settle(); doc.getText("body").insert(0,"unsaved text"); await scheduler.advance(300); await settle(); await scheduler.advance(100000); await settle();
  assert.equal(writes,1); assert.equal(listPendingOperations(store,"user-1","page-1",1).length,1); assert.equal(statuses.at(-1)?.retryable,false); assert.equal(statuses.at(-1)?.status,"error");
});
