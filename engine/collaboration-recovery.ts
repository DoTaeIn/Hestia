import * as Y from "yjs";

// ---------------------------------------------------------------------------
// Durable, generation/tab-scoped full Yjs state snapshots, kept alongside the
// incremental pending-operation deltas in collaboration-sync.ts.
//
// Why this exists: an incremental Yjs update only contains the structs it
// itself introduced. Applying a lone incremental update into a fresh scratch
// Y.Doc (as collaboration-sync's decodePendingOperationsText does) silently
// produces an EMPTY document whenever that update references structs from an
// earlier seed/update it depends on but that were never themselves stored.
// A full state snapshot (Y.encodeStateAsUpdate(doc)) captures every struct
// the document currently holds, so recovery can always reconstruct real
// content even if some deltas in between are missing or corrupt.
//
// This module is pure and only depends on yjs. It never imports
// collaboration-sync.ts and never mutates a live Y.Doc that is passed in.
// Snapshots are for export/inspection only — never replay a recovered
// snapshot or its merged text back into a restored (newer-generation) doc.
// ---------------------------------------------------------------------------

export type RecoveryStore = {
  keys(): string[];
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** false when the underlying storage is missing/blocked/full — callers must not promise retention when this is false. */
  readonly available?: boolean;
};

export function toBase64(value: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 0x8000) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

const SNAPSHOT_PREFIX = "hestia:collab-recovery-snapshot";

function encodePart(value: string): string {
  return encodeURIComponent(value);
}

function decodePart(value: string): string {
  return decodeURIComponent(value);
}

/** Different prefix than collaboration-sync's `hestia:collab-op`, so the two key spaces never collide. */
export function recoverySnapshotKey(userId: string, pageId: string, generation: number, sessionId: string): string {
  return `${SNAPSHOT_PREFIX}:${encodePart(userId)}:${encodePart(pageId)}:${generation}:${encodePart(sessionId)}`;
}

type ParsedRecoveryKey = { userId: string; pageId: string; generation: number; sessionId: string };

function parseRecoverySnapshotKey(key: string): ParsedRecoveryKey | null {
  if (!key.startsWith(`${SNAPSHOT_PREFIX}:`)) return null;
  const parts = key.slice(SNAPSHOT_PREFIX.length + 1).split(":");
  if (parts.length !== 4) return null;
  const [userIdRaw, pageIdRaw, generationRaw, sessionIdRaw] = parts;
  const generation = Number(generationRaw);
  if (!userIdRaw || !pageIdRaw || !sessionIdRaw || !Number.isFinite(generation)) return null;
  try {
    return { userId: decodePart(userIdRaw), pageId: decodePart(pageIdRaw), generation, sessionId: decodePart(sessionIdRaw) };
  } catch {
    return null;
  }
}

function listRecoverySnapshotEntries(store: RecoveryStore, userId: string, pageId: string, generation: number): { key: string; payload: string }[] {
  const results: { key: string; payload: string }[] = [];
  for (const key of store.keys()) {
    const parsed = parseRecoverySnapshotKey(key);
    if (!parsed || parsed.userId !== userId || parsed.pageId !== pageId || parsed.generation !== generation) continue;
    const payload = store.getItem(key);
    if (payload === null) continue;
    results.push({ key, payload });
  }
  return results.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * Captures the full current state of `doc` (not just the latest delta) under this
 * user/page/generation/tab-session. Never mutates `doc` — only reads its state.
 * Returns false (never throws) when storage is unavailable, full, or otherwise fails;
 * callers must treat `false` as "this edit is not durably retained in this tab".
 */
export function saveRecoverySnapshot(
  store: RecoveryStore,
  userId: string,
  pageId: string,
  generation: number,
  sessionId: string,
  doc: Y.Doc,
): boolean {
  const isAvailable = () => store.available !== false;
  if (!isAvailable()) return false;
  try {
    const payload = toBase64(Y.encodeStateAsUpdate(doc));
    store.setItem(recoverySnapshotKey(userId, pageId, generation, sessionId), payload);
    return isAvailable();
  } catch {
    return false;
  }
}

/** Truthful placeholder: distinguishes "nothing was ever recorded" from "data exists but could not be rendered as text". */
export const RECOVERY_EXPORT_REQUIRED_MESSAGE =
  "[자동 복구 실패: 원본 데이터가 남아 있습니다. exportRecoveryData로 내보내 수동으로 확인하세요]";

/**
 * Best-effort readable rendering for copy/export only — never meant to be replayed
 * automatically into a restored (newer-generation) live doc. Merges every full
 * snapshot for this user/page/generation (across all tab sessions) plus the given
 * pending incremental payloads into one scratch doc, tolerating any individually
 * corrupt entry. Always destroys the scratch doc before returning.
 */
export function recoverPendingText(
  store: RecoveryStore,
  userId: string,
  pageId: string,
  generation: number,
  pendingPayloads: string[],
): string {
  const snapshotPayloads = listRecoverySnapshotEntries(store, userId, pageId, generation).map((entry) => entry.payload);
  const allPayloads = [...snapshotPayloads, ...pendingPayloads];
  const scratch = new Y.Doc();
  let appliedBytes = 0;
  try {
    for (const payload of allPayloads) {
      if (!payload) continue;
      try {
        const bytes = fromBase64(payload);
        if (bytes.length === 0) continue;
        Y.applyUpdate(scratch, bytes);
        appliedBytes += bytes.length;
      } catch {
        // a corrupt/partial stored snapshot or delta must not block recovering the rest
      }
    }
    const text = scratch.getXmlFragment("default").toString();
    if (text.length === 0 && (appliedBytes > 0 || allPayloads.length > 0)) return RECOVERY_EXPORT_REQUIRED_MESSAGE;
    return text;
  } finally {
    scratch.destroy();
  }
}

export type RecoveryExportEntry = { key: string; payload: string; valid: boolean };

export type RecoveryExportResult = {
  userId: string;
  pageId: string;
  generation: number;
  snapshots: RecoveryExportEntry[];
  pending: RecoveryExportEntry[];
};

function isApplyableUpdate(payload: string): boolean {
  if (!payload) return false;
  const scratch = new Y.Doc();
  try {
    Y.applyUpdate(scratch, fromBase64(payload));
    return true;
  } catch {
    return false;
  } finally {
    scratch.destroy();
  }
}

/**
 * Exact raw snapshot/delta data (valid and corrupt alike) for lossless download, so a
 * user can recover content even when `recoverPendingText` cannot render it as text.
 */
export function exportRecoveryData(
  store: RecoveryStore,
  userId: string,
  pageId: string,
  generation: number,
  pendingPayloads: string[],
): RecoveryExportResult {
  const snapshots: RecoveryExportEntry[] = listRecoverySnapshotEntries(store, userId, pageId, generation).map(({ key, payload }) => ({
    key,
    payload,
    valid: isApplyableUpdate(payload),
  }));
  const pending: RecoveryExportEntry[] = pendingPayloads.map((payload, index) => ({
    key: `pending:${index}`,
    payload,
    valid: isApplyableUpdate(payload),
  }));
  return { userId, pageId, generation, snapshots, pending };
}

/** Deletes only the current tab's snapshot — call once all of that tab's pending operations are confirmed persisted. */
export function clearRecoverySnapshot(store: RecoveryStore, userId: string, pageId: string, generation: number, sessionId: string): void {
  store.removeItem(recoverySnapshotKey(userId, pageId, generation, sessionId));
}

/**
 * Deletes every tab-session snapshot for this exact user/page/generation — call only
 * after explicit user confirmation that stale-generation edits have been exported.
 * Never touches another user's, another page's, or another generation's snapshots.
 */
export function clearRecoveryGeneration(store: RecoveryStore, userId: string, pageId: string, generation: number): void {
  for (const key of store.keys()) {
    const parsed = parseRecoverySnapshotKey(key);
    if (!parsed || parsed.userId !== userId || parsed.pageId !== pageId || parsed.generation !== generation) continue;
    store.removeItem(key);
  }
}
