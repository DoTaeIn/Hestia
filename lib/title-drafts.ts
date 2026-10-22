export type TitleDraft = { key: string; title: string };
export type TitleDraftStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

function prefix(userId: string, pageId: string) {
  return `hestia:title-draft:${encodeURIComponent(userId)}:${encodeURIComponent(pageId)}:`;
}

export function titleDraftKey(userId: string, pageId: string, sessionId: string) {
  return prefix(userId, pageId) + encodeURIComponent(sessionId);
}

export function readTitleDrafts(storage: TitleDraftStorage, userId: string, pageId: string): TitleDraft[] {
  const drafts: TitleDraft[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix(userId, pageId))) continue;
    const raw = storage.getItem(key);
    if (!raw) continue;
    try {
      const data = JSON.parse(raw);
      if (typeof data.title === "string") drafts.push({ key, title: data.title });
    } catch { /* keep unrecognized data intact */ }
  }
  return drafts.sort((a, b) => a.key.localeCompare(b.key));
}

export function writeTitleDraft(storage: TitleDraftStorage, key: string, title: string): boolean {
  try { storage.setItem(key, JSON.stringify({ title })); return true; } catch { return false; }
}

/** An older version-save response must never delete a newer, different draft. */
export function clearRecordedTitleDrafts(storage: TitleDraftStorage, userId: string, pageId: string, recordedTitle: string) {
  for (const draft of readTitleDrafts(storage, userId, pageId)) {
    if ((draft.title.trim() || "제목 없는 문서") === recordedTitle) storage.removeItem(draft.key);
  }
}
