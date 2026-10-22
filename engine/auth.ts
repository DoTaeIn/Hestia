import type { Provider, SupabaseClient } from "@supabase/supabase-js";
import { EngineError, execute, type EngineResult } from "./result.ts";

export type Identity = { id: string; email: string | null };
export type IdentityProvider = { getUser(): Promise<EngineResult<Identity | null>> };
export type OAuthProvider = Provider;

export type AuthAdapter = IdentityProvider & {
  signOut(): Promise<EngineResult<null>>;
  requestEmailLink(input: { email: string; redirectTo: string; captchaToken?: string }): Promise<EngineResult<null>>;
  signInWithPassword(input: { email: string; password: string; captchaToken?: string }): Promise<EngineResult<Identity>>;
  signInWithOAuth(input: { provider: OAuthProvider; redirectTo: string }): Promise<EngineResult<{ url: string | null }>>;
  exchangeCode(code: string): Promise<EngineResult<Identity>>;
};

function toIdentity(user: { id: string; email?: string | null }): Identity {
  return { id: user.id, email: user.email ?? null };
}

/** Database RLS remains the real authorization boundary; this only bridges the SDK's session to an Identity. */
export function createSupabaseAuthAdapter(client: SupabaseClient): AuthAdapter {
  return {
    getUser: () => execute<Identity | null>("auth.getUser", async () => {
      const result = await client.auth.getUser();
      if (result.error) {
        if (result.error.name === "AuthSessionMissingError" || ["user_not_found", "session_not_found", "session_expired", "bad_jwt", "refresh_token_not_found", "refresh_token_already_used"].includes(result.error.code ?? "")) return { data: null, error: null };
        return { data: null, error: result.error };
      }
      return { data: result.data.user ? toIdentity(result.data.user) : null, error: null };
    }),

    signOut: () => execute<null>("auth.signOut", async () => {
      const result = await client.auth.signOut();
      return { data: null, error: result.error };
    }),

    requestEmailLink: (input) => execute<null>("auth.requestEmailLink", async () => {
      const result = await client.auth.signInWithOtp({
        email: input.email.trim(),
        options: { emailRedirectTo: input.redirectTo, ...(input.captchaToken ? { captchaToken: input.captchaToken } : {}) },
      });
      return { data: null, error: result.error };
    }),

    signInWithPassword: (input) => execute<Identity>("auth.signInWithPassword", async () => {
      const result = await client.auth.signInWithPassword({ email: input.email.trim(), password: input.password, ...(input.captchaToken ? { options: { captchaToken: input.captchaToken } } : {}) });
      if (result.error) return { data: null, error: result.error };
      if (!result.data.user) throw new EngineError("unauthenticated", "Authentication required", "auth.signInWithPassword");
      return { data: toIdentity(result.data.user), error: null };
    }),

    signInWithOAuth: (input) => execute<{ url: string | null }>("auth.signInWithOAuth", async () => {
      const result = await client.auth.signInWithOAuth({
        provider: input.provider,
        options: { redirectTo: input.redirectTo, skipBrowserRedirect: true },
      });
      if (result.error) return { data: null, error: result.error };
      return { data: { url: result.data.url ?? null }, error: null };
    }),

    exchangeCode: (code) => execute<Identity>("auth.exchangeCode", async () => {
      const result = await client.auth.exchangeCodeForSession(code);
      if (result.error) return { data: null, error: result.error };
      if (!result.data.user) throw new EngineError("unauthenticated", "Authentication required", "auth.exchangeCode");
      return { data: toIdentity(result.data.user), error: null };
    }),
  };
}
