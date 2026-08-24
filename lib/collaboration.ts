"use client";

import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import { createClient } from "@/lib/supabase/browser";

const toBase64 = (value: Uint8Array) => {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 0x8000) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

export async function loadCollaboration(pageId: string) {
  const { data, error } = await createClient().rpc("initialize_page_collaboration", { target_page_id: pageId }).single();
  if (error || !data) throw error ?? new Error("공동 편집 문서를 불러오지 못했습니다.");
  return data as { collaboration_state: string | null; should_seed: boolean; collaboration_generation: number };
}

export class SupabaseYjsProvider {
  readonly awareness: Awareness;
  private readonly channel;
  private connected = false;
  private saveTimer: number | undefined;

  constructor(
    readonly doc: Y.Doc,
    private readonly pageId: string,
    private readonly generation: number,
    user: { id: string; name: string },
  ) {
    this.awareness = new Awareness(doc);
    this.awareness.setLocalStateField("user", { name: user.name });
    this.channel = createClient().channel(`page:${pageId}`, { config: { broadcast: { self: false }, presence: { key: user.id } } });
    this.channel
      .on("broadcast", { event: "yjs-update" }, ({ payload }) => { if (payload.generation === this.generation) Y.applyUpdate(this.doc, fromBase64(payload.update), this); })
      .on("broadcast", { event: "yjs-awareness" }, ({ payload }) => { if (payload.generation === this.generation) applyAwarenessUpdate(this.awareness, fromBase64(payload.update), this); })
      .subscribe((status) => { this.connected = status === "SUBSCRIBED"; });
    this.doc.on("update", (update, origin) => {
      if (origin !== this && this.connected) void this.channel.send({ type: "broadcast", event: "yjs-update", payload: { update: toBase64(update), generation: this.generation } });
      if (origin !== this) this.queuePersistence();
    });
    this.awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin !== this && this.connected) {
        const update = encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed]);
        void this.channel.send({ type: "broadcast", event: "yjs-awareness", payload: { update: toBase64(update), generation: this.generation } });
      }
    });
  }

  private queuePersistence() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      void this.persist();
    }, 900);
  }

  async persist() {
    return createClient().rpc("save_page_collaboration", {
      target_page_id: this.pageId,
      next_state: toBase64(Y.encodeStateAsUpdate(this.doc)),
      expected_generation: this.generation,
    });
  }

  destroy() {
    window.clearTimeout(this.saveTimer);
    this.awareness.destroy();
    void this.channel.unsubscribe();
  }
}
