import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContentSecurityPolicy } from "./security-policy.ts";
const input = { nonce: "R4nd0mNonce0123456789+/==", supabaseUrl: "https://example.supabase.co", development: false };
test("production CSP authorizes nonce scripts and only the configured backend connections", () => {
  const csp = buildContentSecurityPolicy(input);
  const scripts = csp.split(";").find(value => value.trim().startsWith("script-src"))!;
  assert.match(scripts, /'nonce-R4nd0mNonce0123456789\+\/=='/);
  assert.match(scripts, /'strict-dynamic'/);
  assert.ok(!scripts.includes("unsafe-inline") && !scripts.includes("unsafe-eval"));
  assert.match(csp, /connect-src 'self' https:\/\/example.supabase.co wss:\/\/example.supabase.co/);
  assert.ok(!csp.includes("challenges.cloudflare.com"));
  assert.match(csp, /frame-ancestors 'none'/);
});
test("development eval is explicit and CAPTCHA origins are opt-in", () => {
  assert.match(buildContentSecurityPolicy({ ...input, development: true }), /'unsafe-eval'/);
  assert.match(buildContentSecurityPolicy({ ...input, turnstile: true }), /frame-src https:\/\/challenges.cloudflare.com/);
});
test("CSP rejects injected nonces and non-HTTP or credentialed backend URLs", () => {
  assert.throws(() => buildContentSecurityPolicy({ ...input, nonce: "bad'; script-src *" }));
  assert.throws(() => buildContentSecurityPolicy({ ...input, supabaseUrl: "https://user:pass@backend.test" }));
  assert.throws(() => buildContentSecurityPolicy({ ...input, supabaseUrl: "javascript:alert(1)" }));
});
