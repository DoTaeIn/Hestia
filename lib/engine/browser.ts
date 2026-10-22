import { createHestiaEngine } from "@/engine";
import { createBrowserAuth } from "@/lib/auth/browser";
import { createClient } from "@/lib/supabase/browser";

/** App composition root; the engine itself never constructs a session. */
export function createBrowserEngine() {
  const client = createClient();
  return createHestiaEngine(client, { identity: createBrowserAuth(client) });
}
