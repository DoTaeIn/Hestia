import type { SupabaseClient } from "@supabase/supabase-js";
import { EngineError, execute, requireId, type EngineResult } from "./result.ts";

export type AssuranceLevel = "aal1" | "aal2";
export type AssuranceStatus = { currentLevel: AssuranceLevel | null; nextLevel: AssuranceLevel | null };
export type SecurityFactor = { id: string; friendlyName: string; status: "verified" | "unverified" };
export type TotpEnrollment = { id: string; secret: string; qrCode: string };

export type SecurityAdapter = {
  getAssurance(): Promise<EngineResult<AssuranceStatus>>;
  listFactors(): Promise<EngineResult<SecurityFactor[]>>;
  enrollTotp(): Promise<EngineResult<TotpEnrollment>>;
  verifyTotp(factorId: string, code: string): Promise<EngineResult<null>>;
  unenroll(factorId: string): Promise<EngineResult<null>>;
};

function requireTotpCode(code: string, operation: string) {
  if (!/^\d{6}$/.test(code)) throw new EngineError("validation", "Enter the 6-digit code from your authenticator app", operation);
  return code;
}

/** Database RLS and the SDK's own AAL check remain the real enforcement; this only shapes requests/responses. */
export function createSupabaseSecurityAdapter(client: SupabaseClient): SecurityAdapter {
  return {
    getAssurance: () => execute<AssuranceStatus>("security.getAssurance", async () => {
      const result = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (result.error) return { data: null, error: result.error };
      return { data: { currentLevel: result.data.currentLevel, nextLevel: result.data.nextLevel }, error: null };
    }),

    listFactors: () => execute<SecurityFactor[]>("security.listFactors", async () => {
      const result = await client.auth.mfa.listFactors();
      if (result.error) return { data: null, error: result.error };
      const source = result.data.all ? result.data.all.filter(factor => factor.factor_type === "totp") : result.data.totp;
      const factors = (source ?? []).map(factor => ({
        id: factor.id,
        friendlyName: factor.friendly_name || "Authenticator",
        status: factor.status === "verified" ? ("verified" as const) : ("unverified" as const),
      }));
      return { data: factors, error: null };
    }),

    enrollTotp: () => execute<TotpEnrollment>("security.enrollTotp", async () => {
      const operation = "security.enrollTotp";
      const friendlyName = `Hestia ${Date.now()}`;
      const result = await client.auth.mfa.enroll({ factorType: "totp", friendlyName });
      if (result.error) return { data: null, error: result.error };
      const totp = result.data.totp;
      if (!totp || typeof totp.qr_code !== "string" || !totp.qr_code.startsWith("data:image/svg+xml")) {
        throw new EngineError("unknown", "The authenticator did not return a usable QR code", operation);
      }
      return { data: { id: result.data.id, secret: totp.secret, qrCode: totp.qr_code }, error: null };
    }),

    verifyTotp: (factorId: string, code: string) => execute<null>("security.verifyTotp", async () => {
      const operation = "security.verifyTotp";
      requireId(factorId, operation);
      requireTotpCode(code, operation);
      const result = await client.auth.mfa.challengeAndVerify({ factorId, code });
      if (result.error) return { data: null, error: result.error };
      return { data: null, error: null };
    }),

    unenroll: (factorId: string) => execute<null>("security.unenroll", async () => {
      requireId(factorId, "security.unenroll");
      const result = await client.auth.mfa.unenroll({ factorId });
      return { data: null, error: result.error };
    }),
  };
}
