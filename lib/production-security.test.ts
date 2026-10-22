import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
function check(overrides: Record<string,string>) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("NEXT_PUBLIC_"))) as NodeJS.ProcessEnv;
  Object.assign(env,{ NEXT_PUBLIC_SITE_URL:"https://docs.hestia.test", NEXT_PUBLIC_SUPABASE_URL:"https://backend.hestia.test", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_synthetic_fixture", NEXT_PUBLIC_TURNSTILE_SITE_KEY:"synthetic-site-key" }, overrides);
  return spawnSync(process.execPath,[fileURLToPath(new URL("../scripts/check-production-security.mjs",import.meta.url))],{ env, encoding:"utf8" });
}
test("production readiness accepts explicit HTTPS/public-key/bot-protection configuration", () => { assert.equal(check({}).status,0); });
test("production readiness rejects loopback targets and missing bot protection", () => {
  assert.equal(check({NEXT_PUBLIC_SITE_URL:"https://127.0.0.1"}).status,1);
  assert.equal(check({NEXT_PUBLIC_TURNSTILE_SITE_KEY:""}).status,1);
});
test("production readiness rejects public secrets without printing their values", () => {
  const marker = "sb_" + "secret_" + "synthetic_do_not_echo";
  const result = check({ NEXT_PUBLIC_ACCIDENTAL:marker });
  assert.equal(result.status,1); assert.match(result.stderr,/NEXT_PUBLIC_ACCIDENTAL/); assert.ok(!result.stderr.includes(marker));
});
