"use client";

import * as Y from "yjs";
import { createClient } from "@/lib/supabase/browser";
import {
  applyLoadedCollaboration,
  CollaborationProviderCore,
  createMemoryOperationStore,
  loadPageCollaboration,
  seedCollaborationDocument,
  type CollaborationProviderOptions,
  type LoadCollaborationResult,
  type OperationStore,
  type RealtimeChannelLike,
  type RealtimeClientLike,
  type SupabaseRpcClient,
} from "../engine/collaboration";

export { buildSeedUpdate, fromBase64 } from "../engine/collaboration";
export type { CollaborationStatus, CollaborationStatusDetail, LoadCollaborationResult, StaleRecoveryDetail } from "../engine/collaboration";

/**
 * The real client already has the shape these two interfaces require
 * (`rpc(fn, args).single()` and `channel(topic, config)`); this only narrows the type.
 */
function asRpcClient(client: ReturnType<typeof createClient>): SupabaseRpcClient {
  return client as unknown as SupabaseRpcClient;
}

function asRealtimeClient(client: ReturnType<typeof createClient>): RealtimeClientLike {
  return {
    channel: (topic, config) => client.channel(topic, config as Parameters<typeof client.channel>[1]) as unknown as RealtimeChannelLike,
  };
}

export async function loadCollaboration(pageId: string): Promise<LoadCollaborationResult> {
  return loadPageCollaboration(asRpcClient(createClient()), pageId);
}

export { applyLoadedCollaboration };

export async function seedIfNeeded(pageId: string, generation: number, seedStateBase64: string, doc: Y.Doc, origin: unknown) {
  await seedCollaborationDocument(asRpcClient(createClient()), pageId, generation, seedStateBase64, doc, origin);
}

/** `localStorage` wrapped as an `OperationStore`, falling back to an in-memory store (marked unavailable) if storage is missing/blocked (private mode, quota, SSR). */
function browserOperationStore(): OperationStore {
  let usable = typeof window !== "undefined";
  if (usable) {
    try {
      window.localStorage.setItem("__hestia_collab_probe__", "1");
      window.localStorage.removeItem("__hestia_collab_probe__");
    } catch {
      usable = false;
    }
  }
  if (!usable) return createMemoryOperationStore(false);

  let quotaOk = true;
  return {
    keys() {
      const keys: string[] = [];
      try {
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (key) keys.push(key);
        }
      } catch {
        quotaOk = false;
      }
      return keys;
    },
    getItem(key) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        quotaOk = false;
        return null;
      }
    },
    setItem(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // full/blocked after the probe succeeded (e.g. quota hit mid-session) — stop promising retention
        quotaOk = false;
      }
    },
    removeItem(key) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // ignore
      }
    },
    get available() {
      return quotaOk;
    },
  };
}

export class SupabaseYjsProvider extends CollaborationProviderCore {
  constructor(
    doc: Y.Doc,
    pageId: string,
    generation: number,
    user: { id: string; name: string },
    options: Pick<CollaborationProviderOptions, "onStatus" | "onStaleRecovery"> = {},
  ) {
    const client = createClient();
    super(doc, pageId, generation, user, {
      client: asRpcClient(client),
      realtime: asRealtimeClient(client),
      store: browserOperationStore(),
      onStatus: options.onStatus,
      onStaleRecovery: options.onStaleRecovery,
    });
  }
}
