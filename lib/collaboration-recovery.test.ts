// node --test lib/collaboration-recovery.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import {
  RECOVERY_EXPORT_REQUIRED_MESSAGE,
  type RecoveryStore,
  clearRecoveryGeneration,
  clearRecoverySnapshot,
  exportRecoveryData,
  fromBase64,
  recoverPendingText,
  recoverySnapshotKey,
  saveRecoverySnapshot,
  toBase64,
} from "./collaboration-recovery.ts";

function createMemoryRecoveryStore(available = true): RecoveryStore {
  const map = new Map<string, string>();
  return {
    keys: () => [...map.keys()],
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
    available,
  };
}

function buildSeedDoc(): Y.Doc {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("default");
  const paragraph = new Y.XmlElement("paragraph");
  const text = new Y.XmlText();
  text.insert(0, "원본");
  paragraph.insert(0, [text]);
  fragment.insert(0, [paragraph]);
  return doc;
}

function paragraphText(doc: Y.Doc): Y.XmlText {
  const fragment = doc.getXmlFragment("default");
  const paragraph = fragment.get(0) as Y.XmlElement;
  return paragraph.get(0) as Y.XmlText;
}

test("a lone incremental update cannot stand alone, but a prior full snapshot plus the delta recovers real content", () => {
  const doc = buildSeedDoc();
  const store = createMemoryRecoveryStore();
  const userId = "user-1";
  const pageId = "page-1";
  const generation = 1;

  assert.equal(saveRecoverySnapshot(store, userId, pageId, generation, "tab-a", doc), true);

  let delta: Uint8Array | null = null;
  const onUpdate = (update: Uint8Array) => { delta = update; };
  doc.on("update", onUpdate);
  paragraphText(doc).insert(2, " 추가");
  doc.off("update", onUpdate);
  assert.ok(delta);
  const deltaPayload = toBase64(delta as Uint8Array);

  assert.equal(doc.getXmlFragment("default").toString(), "<paragraph>원본 추가</paragraph>");

  // reproduces the bug this module fixes: a fresh scratch doc fed only the delta has
  // nothing to anchor the incremental structs to, so it renders as empty.
  const scratch = new Y.Doc();
  Y.applyUpdate(scratch, fromBase64(deltaPayload));
  assert.equal(scratch.getXmlFragment("default").toString(), "");
  scratch.destroy();

  const recovered = recoverPendingText(store, userId, pageId, generation, [deltaPayload]);
  assert.equal(recovered, "<paragraph>원본 추가</paragraph>");

  doc.destroy();
});

test("two tabs sharing user/page/generation diverge from the same seed and both snapshots merge on recovery", () => {
  const seed = buildSeedDoc();
  const seedBytes = Y.encodeStateAsUpdate(seed);
  seed.destroy();

  const tabA = new Y.Doc();
  Y.applyUpdate(tabA, seedBytes);
  const tabB = new Y.Doc();
  Y.applyUpdate(tabB, seedBytes);

  paragraphText(tabA).insert(paragraphText(tabA).length, "-A");
  paragraphText(tabB).insert(paragraphText(tabB).length, "-B");

  const store = createMemoryRecoveryStore();
  const userId = "user-1";
  const pageId = "page-1";
  const generation = 1;
  assert.equal(saveRecoverySnapshot(store, userId, pageId, generation, "tab-a", tabA), true);
  assert.equal(saveRecoverySnapshot(store, userId, pageId, generation, "tab-b", tabB), true);

  const recovered = recoverPendingText(store, userId, pageId, generation, []);
  assert.ok(recovered.includes("-A"), recovered);
  assert.ok(recovered.includes("-B"), recovered);

  // recovery never touches the live tab docs it read snapshots from
  assert.equal(tabA.getXmlFragment("default").toString(), "<paragraph>원본-A</paragraph>");
  assert.equal(tabB.getXmlFragment("default").toString(), "<paragraph>원본-B</paragraph>");

  tabA.destroy();
  tabB.destroy();
});

test("another user's snapshot under the same page/generation is never mixed into recovery", () => {
  const docUser1 = buildSeedDoc();
  const docUser2 = buildSeedDoc();
  paragraphText(docUser2).insert(2, " 다른사용자");

  const store = createMemoryRecoveryStore();
  saveRecoverySnapshot(store, "user-1", "page-1", 1, "tab-a", docUser1);
  saveRecoverySnapshot(store, "user-2", "page-1", 1, "tab-a", docUser2);

  const recovered = recoverPendingText(store, "user-1", "page-1", 1, []);
  assert.equal(recovered, "<paragraph>원본</paragraph>");
  assert.ok(!recovered.includes("다른사용자"));

  docUser1.destroy();
  docUser2.destroy();
});

test("a snapshot from a stale generation is excluded from a current-generation recovery", () => {
  const staleDoc = buildSeedDoc();
  paragraphText(staleDoc).insert(2, " 구세대");

  const store = createMemoryRecoveryStore();
  saveRecoverySnapshot(store, "user-1", "page-1", 1, "tab-a", staleDoc);

  const recoveredCurrent = recoverPendingText(store, "user-1", "page-1", 2, []);
  assert.equal(recoveredCurrent, "");

  const recoveredStale = recoverPendingText(store, "user-1", "page-1", 1, []);
  assert.equal(recoveredStale, "<paragraph>원본 구세대</paragraph>");

  staleDoc.destroy();
});

test("corrupt snapshot and delta entries are tolerated and the rest still recovers", () => {
  const doc = buildSeedDoc();
  const store = createMemoryRecoveryStore();
  const userId = "user-1";
  const pageId = "page-1";
  const generation = 1;
  saveRecoverySnapshot(store, userId, pageId, generation, "tab-good", doc);
  store.setItem(recoverySnapshotKey(userId, pageId, generation, "tab-corrupt-base64"), "not valid base64 !!!");
  store.setItem(recoverySnapshotKey(userId, pageId, generation, "tab-corrupt-update"), toBase64(new Uint8Array([1, 2, 3, 4, 5])));

  const recovered = recoverPendingText(store, userId, pageId, generation, ["also not base64 !!!"]);
  assert.equal(recovered, "<paragraph>원본</paragraph>");

  doc.destroy();
});

test("saveRecoverySnapshot returns false instead of throwing when storage is unavailable or fails", () => {
  const doc = buildSeedDoc();

  const unavailableStore = createMemoryRecoveryStore(false);
  assert.equal(saveRecoverySnapshot(unavailableStore, "user-1", "page-1", 1, "tab-a", doc), false);
  assert.deepEqual(unavailableStore.keys(), []);

  const quotaStore: RecoveryStore = {
    keys: () => [],
    getItem: () => null,
    setItem: () => { throw new Error("QuotaExceededError"); },
    removeItem: () => {},
    available: true,
  };
  assert.equal(saveRecoverySnapshot(quotaStore, "user-1", "page-1", 1, "tab-a", doc), false);

  doc.destroy();
});

test("saveRecoverySnapshot and recoverPendingText never mutate the doc/state they read from", () => {
  const doc = buildSeedDoc();
  const beforeState = Y.encodeStateAsUpdate(doc);
  const store = createMemoryRecoveryStore();
  saveRecoverySnapshot(store, "user-1", "page-1", 1, "tab-a", doc);
  recoverPendingText(store, "user-1", "page-1", 1, []);
  const afterState = Y.encodeStateAsUpdate(doc);
  assert.deepEqual(afterState, beforeState);
  assert.equal(doc.getXmlFragment("default").toString(), "<paragraph>원본</paragraph>");

  doc.destroy();
});

test("clearRecoverySnapshot removes only one tab's key; clearRecoveryGeneration removes only that user/page/generation", () => {
  const doc = buildSeedDoc();
  const store = createMemoryRecoveryStore();
  saveRecoverySnapshot(store, "user-1", "page-1", 1, "tab-a", doc);
  saveRecoverySnapshot(store, "user-1", "page-1", 1, "tab-b", doc);
  saveRecoverySnapshot(store, "user-1", "page-1", 2, "tab-a", doc);
  saveRecoverySnapshot(store, "user-2", "page-1", 1, "tab-a", doc);

  clearRecoverySnapshot(store, "user-1", "page-1", 1, "tab-a");
  assert.deepEqual(
    store.keys().sort(),
    [
      recoverySnapshotKey("user-1", "page-1", 1, "tab-b"),
      recoverySnapshotKey("user-1", "page-1", 2, "tab-a"),
      recoverySnapshotKey("user-2", "page-1", 1, "tab-a"),
    ].sort(),
  );

  clearRecoveryGeneration(store, "user-1", "page-1", 1);
  assert.deepEqual(
    store.keys().sort(),
    [
      recoverySnapshotKey("user-1", "page-1", 2, "tab-a"),
      recoverySnapshotKey("user-2", "page-1", 1, "tab-a"),
    ].sort(),
  );

  doc.destroy();
});

test("exportRecoveryData reports exact valid/corrupt raw snapshot and delta data", () => {
  const doc = buildSeedDoc();
  const store = createMemoryRecoveryStore();
  const userId = "user-1";
  const pageId = "page-1";
  const generation = 1;
  saveRecoverySnapshot(store, userId, pageId, generation, "tab-good", doc);
  const corruptPayload = toBase64(new Uint8Array([9, 9, 9]));
  store.setItem(recoverySnapshotKey(userId, pageId, generation, "tab-bad"), corruptPayload);

  const exported = exportRecoveryData(store, userId, pageId, generation, ["not base64 !!!"]);
  assert.equal(exported.userId, userId);
  assert.equal(exported.pageId, pageId);
  assert.equal(exported.generation, generation);
  assert.equal(exported.snapshots.length, 2);
  const good = exported.snapshots.find((entry) => entry.key.includes("tab-good"));
  const bad = exported.snapshots.find((entry) => entry.key.includes("tab-bad"));
  assert.equal(good?.valid, true);
  assert.equal(bad?.valid, false);
  assert.equal(bad?.payload, corruptPayload);
  assert.equal(exported.pending.length, 1);
  assert.equal(exported.pending[0].valid, false);
  assert.equal(exported.pending[0].payload, "not base64 !!!");

  doc.destroy();
});

test("returns a truthful diagnostic instead of a false empty when data exists but cannot render as text", () => {
  const doc = buildSeedDoc();
  const store = createMemoryRecoveryStore();
  const userId = "user-1";
  const pageId = "page-1";
  const generation = 1;
  // only a fully-deleted history exists: the snapshot carries real (tombstoned) data,
  // but rendering the fragment back to text is legitimately empty.
  doc.getXmlFragment("default").delete(0, 1);
  assert.equal(saveRecoverySnapshot(store, userId, pageId, generation, "tab-a", doc), true);

  const recovered = recoverPendingText(store, userId, pageId, generation, []);
  assert.equal(recovered, RECOVERY_EXPORT_REQUIRED_MESSAGE);

  doc.destroy();
});

test("truly no data recorded returns a plain empty string, not a diagnostic", () => {
  const store = createMemoryRecoveryStore();
  assert.equal(recoverPendingText(store, "user-1", "page-1", 1, []), "");
});
