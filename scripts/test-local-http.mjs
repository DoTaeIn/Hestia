/** Start the app at localhost:3010 before running this local-only security smoke test. */
import assert from "node:assert/strict";
const origin = "http://localhost:3010";
for (const path of ["/space", "/space/members", "/editor/11111111-1111-4111-8111-111111111111", "/account/profile"]) {
  const response = await fetch(origin + path, { redirect: "manual", headers: { "x-middleware-subrequest": "middleware:middleware:middleware:middleware:middleware" } });
  assert.equal(response.status, 307, path);
  assert.ok(response.headers.get("location")?.includes("/login?next="));
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  console.log("PASS: anonymous and spoofed middleware request denied:", path);
}
const login = await fetch(origin + "/login");
assert.equal(login.status, 200);
assert.match(login.headers.get("content-security-policy"), /frame-ancestors 'none'/);
assert.equal(login.headers.get("x-powered-by"), null);
console.log("PASS: public login works with security headers");

const second = await fetch(origin + "/login", { headers: { "x-nonce": "attacker-controlled-nonce", "Content-Security-Policy": "script-src * 'unsafe-inline'" } });
const policy = second.headers.get("content-security-policy");
const nonce = policy?.match(/'nonce-([^']+)'/)?.[1];
assert.ok(nonce && nonce !== "attacker-controlled-nonce");
assert.notEqual(policy, login.headers.get("content-security-policy"), "fresh nonce per response");
const scriptPolicy = policy.split(";").find(value => value.trim().startsWith("script-src"));
assert.ok(!scriptPolicy.includes("unsafe-inline"));
const html = await second.text();
const scripts = [...html.matchAll(/<script\b([^>]*)>/g)];
assert.ok(scripts.length > 0);
for (const [, attributes] of scripts) assert.ok(attributes.includes(`nonce="${nonce}"`), "framework and theme scripts receive the CSP nonce");
console.log("PASS: CSP rejects forged nonce headers, rotates nonces, and authorizes only nonce scripts");
