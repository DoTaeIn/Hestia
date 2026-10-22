import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { getSchema, type JSONContent } from "@tiptap/core";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { clearRecoveryGeneration, clearRecoverySnapshot, exportRecoveryData, recoverPendingText, saveRecoverySnapshot } from "./collaboration-recovery.ts";

export function toBase64(value: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 0x8000) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

/** Our current state vector, to ask a peer for whatever we are missing. */
export function encodeOwnStateVector(doc: Y.Doc) {
  return toBase64(Y.encodeStateVector(doc));
}

/** The update a peer needs, given the state vector they reported as missing. */
export function diffUpdate(doc: Y.Doc, remoteStateVectorBase64: string) {
  return toBase64(Y.encodeStateAsUpdate(doc, fromBase64(remoteStateVectorBase64)));
}

/** Builds standalone Yjs update bytes for a seed document without touching a live/shared doc. */
export function buildSeedUpdate(schema: ReturnType<typeof getSchema>, content: JSONContent) {
  const scratch = prosemirrorJSONToYDoc(schema, content, "default");
  const update = Y.encodeStateAsUpdate(scratch);
  scratch.destroy();
  return toBase64(update);
}

export type CollaborationStatus = "connecting" | "live" | "saving" | "offline" | "stale" | "forbidden" | "error";

export type CollaborationStatusDetail = {
  status: CollaborationStatus;
  message?: string;
  /** true if the failure is worth retrying automatically; false for a dead end (restore / lost membership). */
  retryable?: boolean;
};

export type StaleRecoveryDetail = {
  /** the generation these edits were made against — always older than the provider's current generation */
  generation: number;
  /** best-effort plain-text-ish rendering of the stranded edits, for the user to copy */
  text: string;
  operationCount: number;
  exportData?: () => string;
  /** call once the user has copied the content elsewhere, to drop these keys from storage */
  clear: () => void;
};

/** `load_page_collaboration`/`append_page_collaboration_update` raise plain-text exceptions; this is the only signal we get back. */
export function classifyCollaborationError(message: string): "stale-generation" | "forbidden" | "permanent" | "transient" {
  const lower = message.toLowerCase();
  if (lower.includes("restored")) return "stale-generation";
  if (lower.includes("not allowed") || lower.includes("not a member") || lower.includes("membership") || lower.includes("authentication required")) return "forbidden";
  if (/invalid collaboration (state|update) encoding|different update|payload.*too large|exceeds.*limit/i.test(message)) return "permanent";
  return "transient";
}

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];

/** Capped exponential backoff; `null` once we should stop retrying automatically. */
export function nextRetryDelayMs(attempt: number): number | null {
  return attempt < RETRY_DELAYS_MS.length ? RETRY_DELAYS_MS[attempt] : null;
}

// ---------------------------------------------------------------------------
// Operation storage: one immutable key per (user, page, generation, operationId)
// instead of a shared read-modify-write array, so independent tabs for the same
// user never race each other clearing/overwriting the same key.
// ---------------------------------------------------------------------------

export type OperationStore = {
  keys(): string[];
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** false when the underlying storage is missing/blocked/full — callers must not promise retention when this is false. */
  readonly available: boolean;
};

export function createMemoryOperationStore(available = true): OperationStore {
  const map = new Map<string, string>();
  return {
    keys: () => [...map.keys()],
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
    available,
  };
}

const OP_PREFIX = "hestia:collab-op";

export function operationKey(userId: string, pageId: string, generation: number, operationId: string) {
  return `${OP_PREFIX}:${userId}:${pageId}:${generation}:${operationId}`;
}

export function parseOperationKey(key: string): { userId: string; pageId: string; generation: number; operationId: string } | null {
  if (!key.startsWith(`${OP_PREFIX}:`)) return null;
  const parts = key.slice(OP_PREFIX.length + 1).split(":");
  if (parts.length !== 4) return null;
  const [userId, pageId, generationRaw, operationId] = parts;
  const generation = Number(generationRaw);
  if (!userId || !pageId || !operationId || !Number.isFinite(generation)) return null;
  return { userId, pageId, generation, operationId };
}

export type PendingOperation = { operationId: string; pageId: string; generation: number; payload: string };

export function listPendingOperations(store: OperationStore, userId: string, pageId: string, generation?: number): PendingOperation[] {
  const results: PendingOperation[] = [];
  for (const key of store.keys()) {
    const parsed = parseOperationKey(key);
    if (!parsed || parsed.userId !== userId || parsed.pageId !== pageId) continue;
    if (generation !== undefined && parsed.generation !== generation) continue;
    const payload = store.getItem(key);
    if (payload === null) continue;
    results.push({ operationId: parsed.operationId, pageId: parsed.pageId, generation: parsed.generation, payload });
  }
  return results.sort((a, b) => (a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0));
}

export function writePendingOperation(store: OperationStore, userId: string, pageId: string, generation: number, operationId: string, payload: string) {
  store.setItem(operationKey(userId, pageId, generation, operationId), payload);
}

export function removePendingOperation(store: OperationStore, userId: string, pageId: string, generation: number, operationId: string) {
  store.removeItem(operationKey(userId, pageId, generation, operationId));
}

export function groupPendingOperationsByGeneration(ops: PendingOperation[]): Map<number, PendingOperation[]> {
  const map = new Map<number, PendingOperation[]>();
  for (const op of ops) {
    const list = map.get(op.generation) ?? [];
    list.push(op);
    map.set(op.generation, list);
  }
  return map;
}

/**
 * Best-effort readable rendering of edits that can no longer be replayed into the live
 * document (their generation was superseded by a restore). Never meant to be re-applied —
 * only to give the user something to copy out before the keys are dropped.
 */
export function decodePendingOperationsText(payloads: string[]): string {
  const scratch = new Y.Doc();
  try {
    for (const payload of payloads) {
      try {
        Y.applyUpdate(scratch, fromBase64(payload));
      } catch {
        // a corrupt/partial stored update must not block decoding the rest
      }
    }
    return scratch.getXmlFragment("default").toString();
  } finally {
    scratch.destroy();
  }
}

// ---------------------------------------------------------------------------
// RPC contract (migration 0019): canonical seed + append-only updates log.
// Never call checkpoint_page_collaboration or the legacy save/initialize RPCs.
// ---------------------------------------------------------------------------

export type SupabaseRpcClient = {
  rpc(fn: string, args: Record<string, unknown>): { single(): Promise<{ data: unknown; error: { message: string } | null }> };
};

export type LoadCollaborationResult = {
  state: string | null;
  generation: number;
  shouldSeed: boolean;
  updates: { seq: number; operationId: string; payload: string }[];
};

/**
 * Known tradeoff: this returns the canonical seed plus the ENTIRE update log every time —
 * there is no incremental "give me everything after seq N" RPC, and no log compaction yet.
 * Since the database is now the only path document bytes can travel (see the wire-format
 * note below), every notice-triggered and polled catch-up re-downloads the whole log, so
 * bandwidth grows with the number of appends on a page until it is reloaded/seeded again.
 * That is accepted deliberately: correctness and authorization-on-every-read first. The
 * loads are coalesced and debounced in the provider to keep the cost bounded per tab.
 */
export async function loadPageCollaboration(client: SupabaseRpcClient, pageId: string): Promise<LoadCollaborationResult> {
  const { data, error } = await client.rpc("load_page_collaboration", { target_page_id: pageId }).single();
  if (error || !data) throw new Error(error?.message ?? "공동 편집 문서를 불러오지 못했습니다.");
  const row = data as {
    collaboration_state: string | null;
    collaboration_generation: number;
    should_seed: boolean;
    updates: { seq: number; operation_id: string; payload: string }[] | null;
  };
  return {
    state: row.collaboration_state,
    generation: row.collaboration_generation,
    shouldSeed: Boolean(row.should_seed),
    updates: (row.updates ?? []).map((update) => ({ seq: update.seq, operationId: update.operation_id, payload: update.payload })),
  };
}

/** Applies a canonical state plus its ordered update log — Yjs updates are idempotent, so this is always safe to re-run. */
export function applyLoadedCollaboration(doc: Y.Doc, loaded: LoadCollaborationResult, origin: unknown) {
  if (loaded.state) Y.applyUpdate(doc, fromBase64(loaded.state), origin);
  for (const update of loaded.updates) Y.applyUpdate(doc, fromBase64(update.payload), origin);
}

export type SeedCollaborationResult = { state: string | null; generation: number; seeded: boolean };

/**
 * Atomic under the server's row lock: writes `seed_state` only if nobody has seeded yet.
 * The loser gets the winner's state back and must apply it — never pre-merge its own
 * seed into the live doc.
 */
export async function seedPageCollaboration(client: SupabaseRpcClient, pageId: string, expectedGeneration: number, seedStateBase64: string): Promise<SeedCollaborationResult> {
  const { data, error } = await client.rpc("seed_page_collaboration", {
    target_page_id: pageId,
    seed_state: seedStateBase64,
    expected_generation: expectedGeneration,
  }).single();
  if (error || !data) throw new Error(error?.message ?? "공동 편집 문서를 초기화하지 못했습니다.");
  const row = data as { collaboration_state: string; collaboration_generation: number; seeded: boolean };
  return { state: row.collaboration_state, generation: row.collaboration_generation, seeded: Boolean(row.seeded) };
}

/** Both the winning and losing initializer adopt exactly the server's state. */
export async function seedCollaborationDocument(client: SupabaseRpcClient, pageId: string, generation: number, seedState: string, doc: Y.Doc, origin: unknown) {
  const result = await seedPageCollaboration(client, pageId, generation, seedState);
  if (result.generation !== generation) throw new Error("This document was restored. Refresh to continue editing.");
  if (!result.state) throw new Error("The server returned no canonical collaboration state.");
  Y.applyUpdate(doc, fromBase64(result.state), origin);
}

export type AppendStatus = "appended" | "duplicate" | "stale_generation";
export type AppendCollaborationResult = { status: AppendStatus; generation: number };

/** Retrying with the same `operationId` is the intended retry strategy — `duplicate` is success. */
export async function appendPageCollaborationUpdate(client: SupabaseRpcClient, pageId: string, expectedGeneration: number, operationId: string, payload: string): Promise<AppendCollaborationResult> {
  const { data, error } = await client.rpc("append_page_collaboration_update", {
    target_page_id: pageId,
    expected_generation: expectedGeneration,
    operation_id: operationId,
    update_payload: payload,
  }).single();
  if (error || !data) throw new Error(error?.message ?? "변경 내용을 저장하지 못했습니다.");
  const row = data as { status: AppendStatus; collaboration_generation: number };
  return { status: row.status, generation: row.collaboration_generation };
}

// ---------------------------------------------------------------------------
// Realtime channel + scheduler abstractions, so the provider core can be driven
// by fakes in tests with no real network/timers.
//
// Wire format (BREAKING, intentional — pre-existing clients must reload):
// the channel carries exactly ONE event, `yjs-persisted`, whose payload is only
// `{ generation: number }`. It is an invalidation notice, never data: no Yjs
// updates, no state vectors, no document body, no user names, no awareness or
// cursor state ever leave this process through the channel.
//
// Rationale: Realtime authorizes a private channel once, at subscribe time, and
// caches that decision. A member whose access is revoked mid-session keeps a
// live socket, so anything broadcast over it is readable by a principal the
// database would now reject, and anything accepted from it is data no row-level
// policy ever approved. Making the database authoritative for every byte that
// reaches a document means revocation takes effect on the very next read/write:
// a notice can only ever cause an authenticated `load_page_collaboration`, and
// a rejected load freezes the session instead of applying anything.
// ---------------------------------------------------------------------------

/** The only event on the wire. Payload is an invalidation hint, never document data. */
export const PERSISTED_EVENT = "yjs-persisted";

/** Debounce for notice-triggered database reads, so a forged notice flood cannot amplify into load pressure. */
export const CATCH_UP_DEBOUNCE_MS = 50;

/** Covers notices lost in transit, access revoked mid-session, and restores that produced no local edit. */
export const POLL_INTERVAL_MS = 5000;

export type BroadcastMessage = { payload: Record<string, unknown> };

export type RealtimeChannelLike = {
  on(type: "broadcast", filter: { event: string }, cb: (msg: BroadcastMessage) => void): unknown;
  subscribe(cb: (status: string) => void): unknown;
  send(msg: { type: "broadcast"; event: string; payload: Record<string, unknown> }): unknown;
  unsubscribe(): unknown;
};

export type RealtimeClientLike = {
  channel(topic: string, config: Record<string, unknown>): RealtimeChannelLike;
};

export type Scheduler = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export const realScheduler: Scheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function defaultOperationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (letter) => {
    const value = Math.floor(Math.random() * 16);
    return (letter === "x" ? value : (value & 3) | 8).toString(16);
  });
}

export type CollaborationProviderOptions = {
  client: SupabaseRpcClient;
  realtime: RealtimeClientLike;
  store: OperationStore;
  scheduler?: Scheduler;
  createOperationId?: () => string;
  onStatus?: (detail: CollaborationStatusDetail) => void;
  onStaleRecovery?: (detail: StaleRecoveryDetail) => void;
};

const OFFLINE_MESSAGE = "연결이 끊겼습니다. 입력한 내용은 이 브라우저에 보관되며, 다시 연결되면 저장됩니다.";
const RETRYING_MESSAGE = "저장을 다시 시도합니다…";
const GIVE_UP_MESSAGE = "공동 편집 내용을 저장하지 못했습니다. 입력한 내용은 이 브라우저에 남아 있습니다.";
const STALE_MESSAGE_WITH_STORAGE = "이 문서는 다른 편집자가 과거 버전으로 복원했습니다. 저장하지 못한 내용은 이 브라우저에 남아 있습니다. 새로고침하면 최신 버전을 불러옵니다.";
const STALE_MESSAGE_NO_STORAGE = "이 문서는 다른 편집자가 과거 버전으로 복원했습니다. 이 브라우저는 저장 공간을 사용할 수 없어 저장하지 못한 내용을 보존하지 못했습니다. 지금 바로 복사해 두세요.";
const FORBIDDEN_MESSAGE = "워크스페이스 접근 권한이 바뀌어 공동 편집을 계속할 수 없습니다. 입력한 내용은 이 브라우저에 남아 있습니다.";

/**
 * Framework-independent Yjs <-> Supabase sync core. Depends only on injectable
 * client/realtime/store/scheduler, so it can run under `node --test` with fakes.
 *
 * Every byte that reaches `doc` from outside this tab comes from an authenticated
 * `load_page_collaboration` call — see the wire-format note above.
 */
export class CollaborationProviderCore {
  readonly doc: Y.Doc;
  private readonly pageId: string;
  private readonly generation: number;
  private readonly user: { id: string; name: string };
  /**
   * Local-only, for TipTap's collaboration extension to have an Awareness instance to
   * hold onto. Deliberately never connected to the network: no presence, no cursors,
   * no names or selections are broadcast or received.
   */
  readonly awareness: Awareness;
  private readonly channel: RealtimeChannelLike;
  private readonly client: SupabaseRpcClient;
  private readonly store: OperationStore;
  private readonly scheduler: Scheduler;
  private readonly createOperationId: () => string;
  private readonly onStatus?: (detail: CollaborationStatusDetail) => void;
  private readonly sessionId: string;
  private connected = false;
  private synchronized = false;
  private destroyed = false;
  private stale = false;
  private flushDebounce: unknown;
  private flushRetryTimer: unknown;
  private flushRetryAttempt = 0;
  private flushing = false;
  private storageHealthy = true;
  private queue: { operationId: string; payload: string }[] = [];
  /** at most one database catch-up in flight, plus at most one coalesced follow-up */
  private catchUpInFlight = false;
  private catchUpPending = false;
  private catchUpTimer: unknown;
  private pollTimer: unknown;

  constructor(
    doc: Y.Doc,
    pageId: string,
    generation: number,
    user: { id: string; name: string },
    options: CollaborationProviderOptions,
  ) {
    this.doc = doc;
    this.pageId = pageId;
    this.generation = generation;
    this.user = user;
    this.client = options.client;
    this.store = options.store;
    this.scheduler = options.scheduler ?? realScheduler;
    this.createOperationId = options.createOperationId ?? defaultOperationId;
    this.onStatus = options.onStatus;
    this.sessionId = this.createOperationId();

    // edits stranded under a generation a restore has since superseded: never replay them
    // into this (newer) live doc, only surface them so the user can copy them out.
    const stalePending = listPendingOperations(this.store, user.id, pageId).filter((op) => op.generation !== generation);
    if (stalePending.length && options.onStaleRecovery) {
      for (const [staleGeneration, ops] of groupPendingOperationsByGeneration(stalePending)) {
        options.onStaleRecovery({
          generation: staleGeneration,
          operationCount: ops.length,
          text: recoverPendingText(this.store, user.id, pageId, staleGeneration, ops.map((op) => op.payload)),
          exportData: () => JSON.stringify(exportRecoveryData(this.store, user.id, pageId, staleGeneration, ops.map((op) => op.payload)), null, 2),
          clear: () => {
            for (const op of ops) removePendingOperation(this.store, user.id, pageId, staleGeneration, op.operationId);
            clearRecoveryGeneration(this.store, user.id, pageId, staleGeneration);
          },
        });
      }
    }

    // our own edits from before a reload/navigation away, for this generation: replay once
    // into the doc and keep them queued for another append attempt.
    for (const op of listPendingOperations(this.store, user.id, pageId, generation)) {
      Y.applyUpdate(doc, fromBase64(op.payload), this);
      this.queue.push({ operationId: op.operationId, payload: op.payload });
    }

    this.awareness = new Awareness(doc);
    this.awareness.setLocalStateField("user", { name: user.name }); // stays in this tab — never encoded onto the wire

    // assign the channel fully (including listeners) before calling subscribe, so a
    // synchronous status callback can never observe `this.channel` unassigned.
    // No presence key: joining/leaving this page must not publish who is here.
    this.channel = options.realtime.channel(`page-v2:${pageId}`, { config: { private: true, broadcast: { self: false } } });
    // The single subscription on the wire. Legacy data events (yjs-update, yjs-sync-request,
    // yjs-sync-response, yjs-awareness) are deliberately not subscribed to at all, so an old
    // or malicious peer can neither inject document data nor provoke a document response.
    this.channel.on("broadcast", { event: PERSISTED_EVENT }, (msg) => this.handlePersistedNotice(msg?.payload));

    this.doc.on("update", this.handleDocUpdate);

    this.channel.subscribe((status) => this.handleChannelStatus(status));

    this.schedulePoll();
    if (this.queue.length) this.scheduleFlush();
  }

  private handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return; // applied by us already — remote broadcast, DB catch-up, or recovered outbox replay
    const operationId = this.createOperationId();
    const payload = toBase64(update);
    try {
      writePendingOperation(this.store, this.user.id, this.pageId, this.generation, operationId, payload);
    } catch {
      this.storageHealthy = false;
    }
    this.queue.push({ operationId, payload });
    if (!saveRecoverySnapshot(this.store, this.user.id, this.pageId, this.generation, this.sessionId, this.doc)) this.storageHealthy = false;
    if (this.stale) return; // keep the edit archived locally, but a frozen session must not push or persist it
    this.reportStatus({ status: this.connected ? "saving" : "offline" });
    // No optimistic network message: peers learn about this edit only once the database has it.
    this.scheduleFlush();
  };

  /**
   * Announces "the log moved" and nothing else. Only ever called after the database
   * acknowledged an append (`appended` or `duplicate`), never optimistically.
   */
  private sendPersistedNotice() {
    if (this.destroyed || this.stale || !this.connected) return;
    try {
      this.channel.send({ type: "broadcast", event: PERSISTED_EVENT, payload: { generation: this.generation } });
    } catch {
      // a transport exception here must not crash the editor — peers still poll the database
    }
  }

  /**
   * A notice is a hint to go read the database, never a fact to act on. We do not trust the
   * announced generation for anything (a forged "newer generation" must not freeze a healthy
   * session, and a forged "same generation" must not suppress a real restore) — the load
   * itself decides. Malformed payloads carry no data to apply, so the worst they can do is
   * cost one coalesced, debounced, authenticated read.
   */
  private handlePersistedNotice(_payload: unknown) {
    if (this.destroyed || this.stale) return;
    this.scheduleCatchUp(CATCH_UP_DEBOUNCE_MS);
  }

  private handleChannelStatus = (status: string) => {
    if (this.destroyed) return;
    if (status === "SUBSCRIBED") {
      this.connected = true;
      this.synchronized = false;
      this.flushRetryAttempt = 0;
      if (this.stale) return;
      this.reportStatus({ status: "connecting" });
      // the channel carries no document data at all, so the reconnect catch-up is the only
      // way to pick up whatever happened while we were away
      void this.runCatchUp();
      if (this.queue.length) this.scheduleFlush();
    } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      this.connected = false;
      this.synchronized = false;
      if (!this.stale) this.reportStatus({ status: "offline", message: OFFLINE_MESSAGE, retryable: true });
    }
  };

  /** Coalesces every trigger (notice, poll) into at most one timer; the run itself keeps at most one follow-up. */
  private scheduleCatchUp(delayMs: number) {
    if (this.destroyed || this.stale || this.catchUpTimer !== undefined) return;
    this.catchUpTimer = this.scheduler.setTimeout(() => {
      this.catchUpTimer = undefined;
      void this.runCatchUp();
    }, delayMs);
  }

  /** At most one load in flight; concurrent triggers collapse into a single follow-up load. */
  private async runCatchUp(): Promise<void> {
    if (this.destroyed || this.stale) return;
    if (this.catchUpInFlight) {
      this.catchUpPending = true;
      return;
    }
    this.catchUpInFlight = true;
    try {
      await this.catchUpFromDatabase();
    } finally {
      this.catchUpInFlight = false;
    }
    if (this.catchUpPending) {
      this.catchUpPending = false;
      this.scheduleCatchUp(CATCH_UP_DEBOUNCE_MS);
    }
  }

  /**
   * Recursive single-shot timer (never an interval): one poll is scheduled only after the
   * previous one has fired, so advancing fake timers cannot spin, and a frozen or torn-down
   * session stops polling entirely. Covers notices lost in transit, access revoked while we
   * sit idle, and a restore that happened with no local edit to discover it.
   */
  private schedulePoll() {
    if (this.destroyed || this.stale) return;
    this.pollTimer = this.scheduler.setTimeout(() => {
      this.pollTimer = undefined;
      if (this.destroyed || this.stale) return;
      // a disconnected client must not keep calling the database; reconnecting re-triggers a catch-up
      if (this.connected) void this.runCatchUp();
      this.schedulePoll();
    }, POLL_INTERVAL_MS);
  }

  private async catchUpFromDatabase() {
    try {
      const loaded = await loadPageCollaboration(this.client, this.pageId);
      if (this.destroyed || this.stale) return;
      // the database's generation is the only authority on whether this session is still valid
      if (loaded.generation !== this.generation) {
        this.enterStale();
        return;
      }
      applyLoadedCollaboration(this.doc, loaded, this);
      this.synchronized = true;
      this.reportStatus({ status: !this.connected ? "offline" : this.queue.length ? "saving" : "live" });
    } catch (error) {
      if (this.destroyed || this.stale) return;
      // a rejected load is how revocation reaches us: freeze, apply nothing, keep local recovery data
      if (classifyCollaborationError(error instanceof Error ? error.message : "") === "forbidden") this.enterForbidden();
      else this.reportStatus({ status: "error", message: "서버와 동기화 상태를 확인하지 못했습니다. 새로고침 후 다시 시도하세요.", retryable: true });
    }
  }

  private scheduleFlush() {
    this.scheduler.clearTimeout(this.flushDebounce);
    this.flushDebounce = this.scheduler.setTimeout(() => { void this.flush(); }, 300);
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.destroyed || this.stale) return;
    this.flushing = true;
    if (this.queue.length) this.reportStatus({ status: "saving" });
    while (this.queue.length && !this.destroyed && !this.stale) {
      const op = this.queue[0];
      let outcome: "ok" | "retry" | "halted";
      try {
        const result = await appendPageCollaborationUpdate(this.client, this.pageId, this.generation, op.operationId, op.payload);
        if (result.status === "stale_generation") {
          this.enterStale();
          outcome = "halted";
        } else {
          outcome = "ok"; // appended or duplicate — both mean persisted
          // only now is it safe to tell peers something changed: the data they will read exists
          this.sendPersistedNotice();
        }
      } catch (error) {
        if (classifyCollaborationError(error instanceof Error ? error.message : "") === "forbidden") {
          this.enterForbidden();
          outcome = "halted";
        } else if (classifyCollaborationError(error instanceof Error ? error.message : "") === "permanent") {
          this.freeze();
          this.reportStatus({ status: "error", retryable: false, message: "편집 내용의 크기·형식 때문에 서버가 저장을 거부했습니다. 입력한 내용은 이 브라우저에 남아 있습니다. 내용을 복사하거나 계정 보안에서 복구 자료를 내보내주세요." });
          outcome = "halted";
        } else {
          outcome = "retry";
        }
      }
      if (outcome === "halted") {
        this.flushing = false;
        return;
      }
      if (outcome === "retry") break;
      removePendingOperation(this.store, this.user.id, this.pageId, this.generation, op.operationId);
      this.queue.shift();
      this.flushRetryAttempt = 0;
    }
    this.flushing = false;
    if (this.destroyed || this.stale) return;
    if (this.queue.length) {
      this.scheduleRetryFlush();
    } else {
      try { clearRecoverySnapshot(this.store, this.user.id, this.pageId, this.generation, this.sessionId); } catch { /* keep a harmless local copy if cleanup is unavailable */ }
      this.reportStatus({ status: !this.connected ? "offline" : this.synchronized ? "live" : "connecting" });
    }
  }

  private scheduleRetryFlush() {
    const delay = nextRetryDelayMs(this.flushRetryAttempt);
    if (delay === null) {
      this.reportStatus({ status: "error", message: GIVE_UP_MESSAGE, retryable: true });
      return;
    }
    this.flushRetryAttempt += 1;
    this.reportStatus({ status: this.connected ? "error" : "offline", message: RETRYING_MESSAGE, retryable: true });
    this.flushRetryTimer = this.scheduler.setTimeout(() => { void this.flush(); }, delay);
  }

  /** Leaves the channel and cancels every timer, so a frozen session neither loads nor notices again. */
  private freeze() {
    this.stale = true;
    this.connected = false;
    this.synchronized = false;
    this.catchUpPending = false;
    try { Promise.resolve(this.channel.unsubscribe()).catch(() => {}); } catch {}
    this.scheduler.clearTimeout(this.flushDebounce);
    this.scheduler.clearTimeout(this.flushRetryTimer);
    this.scheduler.clearTimeout(this.catchUpTimer);
    this.scheduler.clearTimeout(this.pollTimer);
    this.catchUpTimer = undefined;
    this.pollTimer = undefined;
  }

  private enterStale() {
    if (this.stale) return;
    this.freeze();
    this.reportStatus({ status: "stale", message: this.store.available ? STALE_MESSAGE_WITH_STORAGE : STALE_MESSAGE_NO_STORAGE, retryable: false });
  }

  private enterForbidden() {
    if (this.stale) return;
    this.freeze();
    this.reportStatus({ status: "forbidden", message: FORBIDDEN_MESSAGE, retryable: false });
  }

  private reportStatus(detail: CollaborationStatusDetail) {
    if (this.queue.length && (!this.storageHealthy || !this.store.available)) {
      const message = (detail.message ?? "")
        .replace("입력한 내용은 이 브라우저에 보관되며, 다시 연결되면 저장됩니다.", "다시 연결되면 저장을 시도합니다.")
        .replace("입력한 내용은 이 브라우저에 남아 있습니다.", "")
        .replace("저장하지 못한 내용은 이 브라우저에 남아 있습니다.", "");
      detail = { ...detail, message: `${message} 브라우저 저장소를 사용할 수 없어 탭을 닫기 전에 내용을 복사해 두세요.`.trim() };
    }
    this.onStatus?.(detail);
  }

  destroy() {
    this.destroyed = true;
    this.connected = false; // no notices may leave after teardown
    this.scheduler.clearTimeout(this.flushDebounce);
    this.scheduler.clearTimeout(this.flushRetryTimer);
    this.scheduler.clearTimeout(this.catchUpTimer);
    this.scheduler.clearTimeout(this.pollTimer);
    this.catchUpTimer = undefined;
    this.pollTimer = undefined;
    this.catchUpPending = false;
    this.doc.off("update", this.handleDocUpdate);
    this.awareness.destroy();
    try {
      this.channel.unsubscribe();
    } catch {
      // ignore transport errors on teardown
    }
  }
}
