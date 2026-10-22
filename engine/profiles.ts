import type { SupabaseClient } from "@supabase/supabase-js";
import type { IdentityProvider } from "./auth.ts";
import { EngineError, execute, requireId } from "./result.ts";

export type ProfileRecord = { id: string; display_name: string; avatar_url: string | null; created_at: string };
export type ProfileInput = { displayName: string; avatarUrl?: string | null };
const fields = "id, display_name, avatar_url, created_at";

export function normalizeProfile(input: ProfileInput) {
  const operation = "profiles.updateSelf";
  if (typeof input.displayName !== "string") throw new EngineError("validation", "Display name is required", operation);
  const displayName = input.displayName.trim();
  if (!displayName || [...displayName].length > 80) throw new EngineError("validation", "Display name must contain 1–80 characters", operation);
  let avatarUrl = input.avatarUrl?.trim() || null;
  if (avatarUrl) {
    try {
      const url = new URL(avatarUrl);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Unsafe avatar URL");
      avatarUrl = url.href;
    } catch { throw new EngineError("validation", "Avatar must be an HTTP(S) URL without credentials", operation); }
    if (avatarUrl.length > 2048) throw new EngineError("validation", "Avatar URL is too long", operation);
  }
  return { display_name: displayName, avatar_url: avatarUrl };
}

export function createProfileOperations(client: SupabaseClient, identity: IdentityProvider) {
  const userId = async (operation: string) => {
    const result = await identity.getUser();
    if (result.error) throw result.error;
    if (!result.data) throw new EngineError("unauthenticated", "Authentication required", operation);
    return requireId(result.data.id, operation);
  };
  return {
    getSelf: () => execute<ProfileRecord>("profiles.getSelf", async () => {
      const id = await userId("profiles.getSelf");
      const result = await client.from("profiles").select(fields).eq("id", id).maybeSingle();
      if (!result.error && !result.data) throw new EngineError("not_found", "Profile not found; check identity provisioning", "profiles.getSelf");
      return result;
    }),
    updateSelf: (input: ProfileInput) => execute<ProfileRecord>("profiles.updateSelf", async () => {
      const values = normalizeProfile(input);
      const id = await userId("profiles.updateSelf");
      return client.from("profiles").update(values).eq("id", id).select(fields).single();
    }),
  };
}
