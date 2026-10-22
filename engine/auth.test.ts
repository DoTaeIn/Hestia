// node --test engine/auth.test.ts
//
// Owns a fake `SupabaseClient.auth` so these tests exercise exactly what
// engine/auth.ts sends to the SDK and how it maps each response, without a
// real auth server. Public API: engine/auth.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAuthAdapter } from "./auth.ts";

type BackendError = { message: string; code?: string; name?: string };
type AuthOutcome<T> = { data: T; error: BackendError | null } | { fail: unknown };

class FakeAuth {
  getUserCalls: unknown[] = [];
  signOutCalls = 0;
  otpCalls: unknown[] = [];
  passwordCalls: unknown[] = [];
  oauthCalls: unknown[] = [];
  exchangeCalls: unknown[] = [];

  getUserOutcome: AuthOutcome<{ user: { id: string; email?: string | null } | null }> = { data: { user: null }, error: null };
  signOutOutcome: { error: BackendError | null } | { fail: unknown } = { error: null };
  otpOutcome: AuthOutcome<unknown> = { data: {}, error: null };
  passwordOutcome: AuthOutcome<{ user: { id: string; email?: string | null } | null }> = { data: { user: null }, error: null };
  oauthOutcome: AuthOutcome<{ provider: string; url: string | null }> = { data: { provider: "google", url: null }, error: null };
  exchangeOutcome: AuthOutcome<{ user: { id: string; email?: string | null } | null }> = { data: { user: null }, error: null };

  async getUser() {
    this.getUserCalls.push({});
    if ("fail" in this.getUserOutcome) throw this.getUserOutcome.fail;
    return this.getUserOutcome;
  }
  async signOut() {
    this.signOutCalls += 1;
    if ("fail" in this.signOutOutcome) throw this.signOutOutcome.fail;
    return this.signOutOutcome;
  }
  async signInWithOtp(args: unknown) {
    this.otpCalls.push(args);
    if ("fail" in this.otpOutcome) throw this.otpOutcome.fail;
    return this.otpOutcome;
  }
  async signInWithPassword(args: unknown) {
    this.passwordCalls.push(args);
    if ("fail" in this.passwordOutcome) throw this.passwordOutcome.fail;
    return this.passwordOutcome;
  }
  async signInWithOAuth(args: unknown) {
    this.oauthCalls.push(args);
    if ("fail" in this.oauthOutcome) throw this.oauthOutcome.fail;
    return this.oauthOutcome;
  }
  async exchangeCodeForSession(code: unknown) {
    this.exchangeCalls.push(code);
    if ("fail" in this.exchangeOutcome) throw this.exchangeOutcome.fail;
    return this.exchangeOutcome;
  }
}

function asClient(auth: FakeAuth) {
  return { auth } as unknown as SupabaseClient;
}

const USER_ID = "11111111-1111-1111-1111-111111111111";

// ---------------------------------------------------------------------------
// getUser
// ---------------------------------------------------------------------------

test("getUser maps an active session to an Identity", async () => {
  const auth = new FakeAuth();
  auth.getUserOutcome = { data: { user: { id: USER_ID, email: "a@b.com" } }, error: null };
  const adapter = createSupabaseAuthAdapter(asClient(auth));

  const result = await adapter.getUser();

  assert.deepEqual(result, { data: { id: USER_ID, email: "a@b.com" }, error: null });
});

test("getUser: a missing session (AuthSessionMissingError) is unauthenticated null, not an error", async () => {
  const auth = new FakeAuth();
  auth.getUserOutcome = { data: { user: null }, error: { message: "Auth session missing!", name: "AuthSessionMissingError" } };
  const adapter = createSupabaseAuthAdapter(asClient(auth));

  const result = await adapter.getUser();

  assert.deepEqual(result, { data: null, error: null });
});

test("getUser: any other auth failure is normalized, not silently swallowed", async () => {
  const auth = new FakeAuth();
  auth.getUserOutcome = { data: { user: null }, error: { message: "fetch failed", name: "AuthRetryableFetchError" } };
  const adapter = createSupabaseAuthAdapter(asClient(auth));

  const result = await adapter.getUser();

  assert.equal(result.data, null);
  assert.equal(result.error?.code, "unavailable");
});

// ---------------------------------------------------------------------------
// requestEmailLink / signInWithPassword
// ---------------------------------------------------------------------------

test("requestEmailLink trims the email and forwards redirectTo as emailRedirectTo", async () => {
  const auth = new FakeAuth();
  const adapter = createSupabaseAuthAdapter(asClient(auth));

  const result = await adapter.requestEmailLink({ email: "  a@b.com  ", redirectTo: "https://app/callback" });

  assert.deepEqual(result, { data: null, error: null });
  assert.deepEqual(auth.otpCalls[0], { email: "a@b.com", options: { emailRedirectTo: "https://app/callback" } });
});

test("signInWithPassword sends the trimmed email but the password verbatim", async () => {
  const auth = new FakeAuth();
  auth.passwordOutcome = { data: { user: { id: USER_ID, email: "a@b.com" } }, error: null };
  const adapter = createSupabaseAuthAdapter(asClient(auth));

  const result = await adapter.signInWithPassword({ email: "  a@b.com  ", password: "  secret  " });

  assert.deepEqual(result, { data: { id: USER_ID, email: "a@b.com" }, error: null });
  assert.deepEqual(auth.passwordCalls[0], { email: "a@b.com", password: "  secret  " });
});

test("signInWithPassword: an SDK auth failure is normalized, not thrown", async () => {
  const auth = new FakeAuth();
  auth.passwordOutcome = { data: { user: null }, error: { message: "Invalid login credentials", name: "AuthApiError" } };
  const adapter = createSupabaseAuthAdapter(asClient(auth));

  const result = await adapter.signInWithPassword({ email: "a@b.com", password: "wrong" });

  assert.equal(result.data, null);
  assert.ok(result.error);
});

test("signInWithPassword: no error but also no user becomes unauthenticated, not a false success", async () => {
  const auth = new FakeAuth();
  auth.passwordOutcome = { data: { user: null }, error: null };
  const adapter = createSupabaseAuthAdapter(asClient(auth));

  const result = await adapter.signInWithPassword({ email: "a@b.com", password: "x" });

  assert.equal(result.data, null);
  assert.equal(result.error?.code, "unauthenticated");
});

// ---------------------------------------------------------------------------
// signInWithOAuth / exchangeCode
// ---------------------------------------------------------------------------

test("signInWithOAuth forwards the provider and redirectTo and returns only the redirect url", async () => {
  const auth = new FakeAuth();
  auth.oauthOutcome = { data: { provider: "github", url: "https://provider/authorize" }, error: null };
  const adapter = createSupabaseAuthAdapter(asClient(auth));

  const result = await adapter.signInWithOAuth({ provider: "github", redirectTo: "https://app/callback" });

  assert.deepEqual(result, { data: { url: "https://provider/authorize" }, error: null });
  assert.deepEqual(auth.oauthCalls[0], { provider: "github", options: { redirectTo: "https://app/callback", skipBrowserRedirect: true } });
});

test("exchangeCode forwards the raw code and maps the session user to an Identity", async () => {
  const auth = new FakeAuth();
  auth.exchangeOutcome = { data: { user: { id: USER_ID, email: null } }, error: null };
  const adapter = createSupabaseAuthAdapter(asClient(auth));

  const result = await adapter.exchangeCode("the-code");

  assert.deepEqual(result, { data: { id: USER_ID, email: null }, error: null });
  assert.deepEqual(auth.exchangeCalls, ["the-code"]);
});

test("exchangeCode: no error but also no user becomes unauthenticated, not a false success", async () => {
  const auth = new FakeAuth();
  auth.exchangeOutcome = { data: { user: null }, error: null };
  const adapter = createSupabaseAuthAdapter(asClient(auth));

  const result = await adapter.exchangeCode("bad-code");

  assert.equal(result.data, null);
  assert.equal(result.error?.code, "unauthenticated");
});

test("exchangeCode: an invalid/expired code is normalized, not thrown", async () => {
  const auth = new FakeAuth();
  auth.exchangeOutcome = { data: { user: null }, error: { message: "invalid flow state, no valid flow state found", name: "AuthApiError" } };
  const adapter = createSupabaseAuthAdapter(asClient(auth));

  const result = await adapter.exchangeCode("expired");

  assert.equal(result.data, null);
  assert.ok(result.error);
});

// ---------------------------------------------------------------------------
// signOut
// ---------------------------------------------------------------------------

test("signOut returns explicit null data since the SDK response carries no data field", async () => {
  const auth = new FakeAuth();
  const adapter = createSupabaseAuthAdapter(asClient(auth));

  const result = await adapter.signOut();

  assert.deepEqual(result, { data: null, error: null });
  assert.equal(auth.signOutCalls, 1);
});

test("signOut: an SDK failure is normalized, not thrown", async () => {
  const auth = new FakeAuth();
  auth.signOutOutcome = { error: { message: "network error", name: "AuthRetryableFetchError" } };
  const adapter = createSupabaseAuthAdapter(asClient(auth));

  const result = await adapter.signOut();

  assert.equal(result.data, null);
  assert.ok(result.error);
});

// ---------------------------------------------------------------------------
// transport exceptions: every method returns an EngineResult, never throws
// ---------------------------------------------------------------------------

test("a thrown transport exception from the SDK is returned as an EngineResult, never thrown to the caller", async () => {
  const auth = new FakeAuth();
  auth.getUserOutcome = { fail: new TypeError("fetch failed") };
  const adapter = createSupabaseAuthAdapter(asClient(auth));

  const result = await adapter.getUser();

  assert.equal(result.data, null);
  assert.equal(result.error?.code, "unavailable");
});

test("getUser treats deleted users and rejected sessions as anonymous while preserving transport failures", async () => {
  for (const code of ["user_not_found", "session_not_found", "session_expired", "bad_jwt", "refresh_token_not_found", "refresh_token_already_used"]) {
    const auth = new FakeAuth();
    auth.getUserOutcome = { data: { user: null }, error: { message: "Rejected session", code } };
    assert.deepEqual(await createSupabaseAuthAdapter(asClient(auth)).getUser(), { data: null, error: null });
  }
});

test("login adapter forwards CAPTCHA tokens only in SDK challenge options", async () => {
  const auth = new FakeAuth(); const adapter = createSupabaseAuthAdapter(asClient(auth));
  await adapter.requestEmailLink({ email: "a@b.com", redirectTo: "https://app/callback", captchaToken: "test-captcha" });
  await adapter.signInWithPassword({ email: "a@b.com", password: "secret", captchaToken: "test-captcha" });
  assert.deepEqual(auth.otpCalls[0], { email: "a@b.com", options: { emailRedirectTo: "https://app/callback", captchaToken: "test-captcha" } });
  assert.deepEqual(auth.passwordCalls[0], { email: "a@b.com", password: "secret", options: { captchaToken: "test-captcha" } });
});
