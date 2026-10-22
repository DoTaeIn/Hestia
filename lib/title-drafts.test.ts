import { test } from "node:test";
import assert from "node:assert/strict";
import { clearRecordedTitleDrafts, readTitleDrafts, titleDraftKey, writeTitleDraft, type TitleDraftStorage } from "./title-drafts.ts";

function storage(): TitleDraftStorage {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: (key) => { data.delete(key); } };
}

test("title drafts survive reopening, isolate users/pages, and retain both tabs", () => {
  const store = storage();
  writeTitleDraft(store, titleDraftKey("u", "p", "tab-a"), "A");
  writeTitleDraft(store, titleDraftKey("u", "p", "tab-b"), "B");
  writeTitleDraft(store, titleDraftKey("other", "p", "tab"), "private");
  writeTitleDraft(store, titleDraftKey("u", "other", "tab"), "different");
  assert.deepEqual(readTitleDrafts(store, "u", "p").map((draft) => draft.title), ["A", "B"]);
});

test("a successful save only clears the recorded title and retains a newer edit", () => {
  const store = storage();
  const key = titleDraftKey("u", "p", "tab-a");
  writeTitleDraft(store, key, "first");
  writeTitleDraft(store, key, "newer edit while save was pending");
  writeTitleDraft(store, titleDraftKey("u", "p", "tab-b"), " first ");
  clearRecordedTitleDrafts(store, "u", "p", "first");
  assert.deepEqual(readTitleDrafts(store, "u", "p").map((draft) => draft.title), ["newer edit while save was pending"]);
});

test("quota failure is explicit and invalid cached data is preserved", () => {
  const store = storage();
  const key = titleDraftKey("u", "p", "tab");
  store.setItem(key, "not json");
  assert.deepEqual(readTitleDrafts(store, "u", "p"), []);
  assert.equal(store.getItem(key), "not json");
  assert.equal(writeTitleDraft({ ...store, setItem() { throw new Error("quota"); } }, key, "new"), false);
});
