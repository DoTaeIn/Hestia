/** Remove only the synthetic run retained by test-local-services --keep-fixtures. */
import assert from "node:assert/strict";
import { readFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createSupabaseSecurityAdapter } from "../engine/security.ts";
import { localTotp } from "./local-totp.mjs";
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(url, "http://127.0.0.1:55421", "Local Hestia only");
const container = "supabase_db_Confluence";
const labels = JSON.parse(execFileSync("docker", ["inspect", "-f", "{{json .Config.Labels}}", container], { encoding: "utf8" }));
assert.equal(labels["com.supabase.cli.workdir"], process.cwd());
const path = "/private/tmp/hestia-service-fixtures.json";
const fixture = JSON.parse(readFileSync(path, "utf8"));
assert.equal(fixture.url, url);
assert.match(fixture.run, /^[0-9a-f]{8}$/);
assert.equal(fixture.users.length, 4);
const ids = fixture.users.map(user => {
  assert.match(user.id, /^[0-9a-f-]{36}$/);
  assert.ok(user.email.startsWith(`hestia-e2e-${fixture.run}-`) && user.email.endsWith("@example.com"));
  return "'" + user.id + "'";
}).join(",");
function sql(text) {
  return execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: text, encoding: "utf8" }).trim();
}
for (const user of fixture.users) {
  const workspaceIds = sql(`select id from public.workspaces where owner_id='${user.id}'`).split("\n").filter(Boolean);
  if (!workspaceIds.length) continue;
  const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  try {
    const login = await client.auth.signInWithPassword({ email: user.email, password: user.password });
    if (login.error) throw login.error;
    if (fixture.mfa?.userId === user.id) { const verified = await createSupabaseSecurityAdapter(client).verifyTotp(fixture.mfa.factorId, localTotp(fixture.mfa.secret)); if (verified.error) throw verified.error; }
    for (const workspaceId of workspaceIds) {
      assert.match(workspaceId, /^[0-9a-f-]{36}$/);
      const paths = sql(`select name from storage.objects where bucket_id='page-images' and split_part(name,'/',1)='${workspaceId}'`).split("\n").filter(Boolean);
      if (paths.length) {
        const removed = await client.storage.from("page-images").remove(paths);
        if (removed.error) throw removed.error;
      }
    }
  } finally { client.auth.stopAutoRefresh(); await client.removeAllChannels(); }
}
sql(`begin; delete from public.workspaces where owner_id in (${ids}); delete from auth.users where id in (${ids}); commit;`);
// Local-only mail cleanup: never delete messages for another account.
const inbox = await (await fetch("http://127.0.0.1:55424/api/v1/messages")).json();
const addresses = new Set(fixture.users.map(user => user.email));
const messageIds = (inbox.messages ?? []).filter(message => message.To?.some(to => addresses.has(to.Address))).map(message => message.ID);
if (messageIds.length) {
  const removed = await fetch("http://127.0.0.1:55424/api/v1/messages", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ IDs: messageIds }) });
  assert.ok(removed.ok, "Could not remove test login messages");
}
unlinkSync(path);
console.log("Retained synthetic users, owned workspaces, images and test login messages removed.");
