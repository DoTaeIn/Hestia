// node --test engine/security.test.ts
//
// Owns a fake `SupabaseClient.auth.mfa` so these tests exercise exactly what
// engine/security.ts sends to the SDK and how it maps each response, without
// a real auth server. Public API: engine/security.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseSecurityAdapter } from "./security.ts";

type BackendError = { message: string; code?: string };
type Outcome<T> = { data: T; error: BackendError | null } | { fail: unknown };

class FakeMfa {
  aalCalls = 0;
  listCalls = 0;
  enrollCalls: unknown[] = [];
  challengeCalls: unknown[] = [];
  unenrollCalls: unknown[] = [];

  aalOutcome: Outcome<{ currentLevel: "aal1" | "aal2" | null; nextLevel: "aal1" | "aal2" | null }> = { data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null };
  listOutcome: Outcome<{ all?: Array<{ id: string; factor_type: string; friendly_name: string; status: string }>; totp: Array<{ id: string; friendly_name: string; status: string }> }> = { data: { totp: [] }, error: null };
  enrollOutcome: Outcome<{ id: string; totp: { secret: string; qr_code: string } | null }> = { data: { id: "", totp: null }, error: null };
  challengeOutcome: Outcome<unknown> = { data: {}, error: null };
  unenrollOutcome: Outcome<unknown> = { data: {}, error: null };

  async getAuthenticatorAssuranceLevel() {
    this.aalCalls += 1;
    if ("fail" in this.aalOutcome) throw this.aalOutcome.fail;
    return this.aalOutcome;
  }
  async listFactors() {
    this.listCalls += 1;
    if ("fail" in this.listOutcome) throw this.listOutcome.fail;
    return this.listOutcome;
  }
  async enroll(args: unknown) {
    this.enrollCalls.push(args);
    if ("fail" in this.enrollOutcome) throw this.enrollOutcome.fail;
    return this.enrollOutcome;
  }
  async challengeAndVerify(args: unknown) {
    this.challengeCalls.push(args);
    if ("fail" in this.challengeOutcome) throw this.challengeOutcome.fail;
    return this.challengeOutcome;
  }
  async unenroll(args: unknown) {
    this.unenrollCalls.push(args);
    if ("fail" in this.unenrollOutcome) throw this.unenrollOutcome.fail;
    return this.unenrollOutcome;
  }
}

function asClient(mfa: FakeMfa) {
  return { auth: { mfa } } as unknown as SupabaseClient;
}

const FACTOR_ID = "11111111-1111-1111-1111-111111111111";

// ---------------------------------------------------------------------------
// getAssurance
// ---------------------------------------------------------------------------

test("getAssurance maps the SDK's current/next AAL verbatim", async () => {
  const mfa = new FakeMfa();
  mfa.aalOutcome = { data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null };
  const adapter = createSupabaseSecurityAdapter(asClient(mfa));

  const result = await adapter.getAssurance();

  assert.deepEqual(result, { data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null });
});

test("getAssurance: an SDK failure is normalized, not thrown", async () => {
  const mfa = new FakeMfa();
  mfa.aalOutcome = { data: { currentLevel: null, nextLevel: null }, error: { message: "fetch failed" } };
  const adapter = createSupabaseSecurityAdapter(asClient(mfa));

  const result = await adapter.getAssurance();

  assert.equal(result.data, null);
  assert.equal(result.error?.code, "unavailable");
});

// ---------------------------------------------------------------------------
// listFactors
// ---------------------------------------------------------------------------

test("listFactors returns only the allowlisted fields, verified and unverified alike", async () => {
  const mfa = new FakeMfa();
  mfa.listOutcome = {
    data: { totp: [
      { id: FACTOR_ID, friendly_name: "Hestia 1", status: "verified" },
      { id: "22222222-2222-2222-2222-222222222222", friendly_name: "", status: "unverified" },
    ] },
    error: null,
  };
  const adapter = createSupabaseSecurityAdapter(asClient(mfa));

  const result = await adapter.listFactors();

  assert.deepEqual(result, {
    data: [
      { id: FACTOR_ID, friendlyName: "Hestia 1", status: "verified" },
      { id: "22222222-2222-2222-2222-222222222222", friendlyName: "Authenticator", status: "unverified" },
    ],
    error: null,
  });
});

test("listFactors: an SDK failure is normalized, not thrown", async () => {
  const mfa = new FakeMfa();
  mfa.listOutcome = { fail: new TypeError("fetch failed") };
  const adapter = createSupabaseSecurityAdapter(asClient(mfa));

  const result = await adapter.listFactors();

  assert.equal(result.data, null);
  assert.equal(result.error?.code, "unavailable");
});

// ---------------------------------------------------------------------------
// enrollTotp
// ---------------------------------------------------------------------------

test("enrollTotp sends a unique friendly name and returns only id/secret/qrCode", async () => {
  const mfa = new FakeMfa();
  mfa.enrollOutcome = { data: { id: FACTOR_ID, totp: { secret: "SECRET", qr_code: "data:image/svg+xml;base64,AAAA" } }, error: null };
  const adapter = createSupabaseSecurityAdapter(asClient(mfa));

  const result = await adapter.enrollTotp();

  assert.deepEqual(result, { data: { id: FACTOR_ID, secret: "SECRET", qrCode: "data:image/svg+xml;base64,AAAA" }, error: null });
  const call = mfa.enrollCalls[0] as { factorType: string; friendlyName: string };
  assert.equal(call.factorType, "totp");
  assert.match(call.friendlyName, /^Hestia \d+$/);
});

test("enrollTotp: a QR code outside the data:image/svg+xml allowlist is rejected, not forwarded", async () => {
  const mfa = new FakeMfa();
  mfa.enrollOutcome = { data: { id: FACTOR_ID, totp: { secret: "SECRET", qr_code: "<svg>not a data uri</svg>" } }, error: null };
  const adapter = createSupabaseSecurityAdapter(asClient(mfa));

  const result = await adapter.enrollTotp();

  assert.equal(result.data, null);
  assert.equal(result.error?.code, "unknown");
});

test("enrollTotp: an SDK failure is normalized, not thrown", async () => {
  const mfa = new FakeMfa();
  mfa.enrollOutcome = { data: { id: "", totp: null }, error: { message: "too many factors", code: "mfa_factor_name_conflict" } };
  const adapter = createSupabaseSecurityAdapter(asClient(mfa));

  const result = await adapter.enrollTotp();

  assert.equal(result.data, null);
  assert.ok(result.error);
});

// ---------------------------------------------------------------------------
// verifyTotp
// ---------------------------------------------------------------------------

test("verifyTotp sends the factorId and code to challengeAndVerify unchanged", async () => {
  const mfa = new FakeMfa();
  const adapter = createSupabaseSecurityAdapter(asClient(mfa));

  const result = await adapter.verifyTotp(FACTOR_ID, "123456");

  assert.deepEqual(result, { data: null, error: null });
  assert.deepEqual(mfa.challengeCalls[0], { factorId: FACTOR_ID, code: "123456" });
});

test("verifyTotp: a non-UUID factorId is rejected before reaching the SDK", async () => {
  const mfa = new FakeMfa();
  const adapter = createSupabaseSecurityAdapter(asClient(mfa));

  const result = await adapter.verifyTotp("not-a-uuid", "123456");

  assert.equal(result.data, null);
  assert.equal(result.error?.code, "validation");
  assert.equal(mfa.challengeCalls.length, 0);
});

test("verifyTotp: codes that are not exactly six digits are rejected before reaching the SDK", async () => {
  const mfa = new FakeMfa();
  const adapter = createSupabaseSecurityAdapter(asClient(mfa));

  for (const code of ["12345", "1234567", "12a456", "", " 123456", "123456 "]) {
    const result = await adapter.verifyTotp(FACTOR_ID, code);
    assert.equal(result.data, null, code);
    assert.equal(result.error?.code, "validation", code);
  }
  assert.equal(mfa.challengeCalls.length, 0);
});

test("verifyTotp: an SDK failure (wrong code) is normalized, not thrown", async () => {
  const mfa = new FakeMfa();
  mfa.challengeOutcome = { data: null, error: { message: "Invalid TOTP code entered", code: "mfa_verification_failed" } };
  const adapter = createSupabaseSecurityAdapter(asClient(mfa));

  const result = await adapter.verifyTotp(FACTOR_ID, "000000");

  assert.equal(result.data, null);
  assert.ok(result.error);
});

// ---------------------------------------------------------------------------
// unenroll
// ---------------------------------------------------------------------------

test("unenroll sends the factorId unchanged", async () => {
  const mfa = new FakeMfa();
  const adapter = createSupabaseSecurityAdapter(asClient(mfa));

  const result = await adapter.unenroll(FACTOR_ID);

  assert.deepEqual(result, { data: null, error: null });
  assert.deepEqual(mfa.unenrollCalls[0], { factorId: FACTOR_ID });
});

test("unenroll: a non-UUID factorId is rejected before reaching the SDK", async () => {
  const mfa = new FakeMfa();
  const adapter = createSupabaseSecurityAdapter(asClient(mfa));

  const result = await adapter.unenroll("not-a-uuid");

  assert.equal(result.data, null);
  assert.equal(result.error?.code, "validation");
  assert.equal(mfa.unenrollCalls.length, 0);
});

test("unenroll: an SDK failure (e.g. missing AAL2 for a verified factor) is normalized, not thrown", async () => {
  const mfa = new FakeMfa();
  mfa.unenrollOutcome = { data: null, error: { message: "AAL2 required to unenroll a verified factor", code: "insufficient_aal" } };
  const adapter = createSupabaseSecurityAdapter(asClient(mfa));

  const result = await adapter.unenroll(FACTOR_ID);

  assert.equal(result.data, null);
  assert.ok(result.error);
});

// ---------------------------------------------------------------------------
// transport exceptions: every method returns an EngineResult, never throws
// ---------------------------------------------------------------------------

test("a thrown transport exception from the SDK is returned as an EngineResult, never thrown to the caller", async () => {
  const mfa = new FakeMfa();
  mfa.challengeOutcome = { fail: new TypeError("fetch failed") };
  const adapter = createSupabaseSecurityAdapter(asClient(mfa));

  const result = await adapter.verifyTotp(FACTOR_ID, "123456");

  assert.equal(result.data, null);
  assert.equal(result.error?.code, "unavailable");
});

test("listFactors includes unfinished TOTP enrollments from SDK all and excludes phone factors", async () => {
  const mfa = new FakeMfa();
  mfa.listOutcome = { data: { all: [{ id: FACTOR_ID, factor_type: "totp", friendly_name: "Setup", status: "unverified" }, { id: "phone", factor_type: "phone", friendly_name: "Phone", status: "verified" }], totp: [] }, error: null };
  assert.deepEqual((await createSupabaseSecurityAdapter(asClient(mfa)).listFactors()).data, [{ id: FACTOR_ID, friendlyName: "Setup", status: "unverified" }]);
});
