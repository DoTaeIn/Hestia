import type { SupabaseClient } from "@supabase/supabase-js";
import { createHestiaEngine } from "@/engine";
import { createServerAuth } from "@/lib/auth/server";

export function createServerEngine(client: SupabaseClient) {
  return createHestiaEngine(client, { identity: createServerAuth(client) });
}
