import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseSecurityAdapter, type SecurityAdapter } from "@/engine/security";
import { createClient } from "@/lib/supabase/browser";

/** Replace this factory when the host app owns a different MFA flow; return null only when the custom provider implements its own step-up flow. */
export function createBrowserSecurity(client: SupabaseClient = createClient()): SecurityAdapter | null {
  return createSupabaseSecurityAdapter(client);
}
