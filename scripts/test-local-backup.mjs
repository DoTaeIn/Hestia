/** Local restart/volume recovery check with the retained synthetic service run. */
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {createClient} from "@supabase/supabase-js";
import * as Y from "yjs";
import {getSchema} from "@tiptap/core";
import {StarterKit} from "@tiptap/starter-kit";
import {createHestiaEngine} from "../engine/index.ts";
import {createSupabaseSecurityAdapter} from "../engine/security.ts";
import {buildSeedUpdate,seedPageCollaboration,appendPageCollaborationUpdate,loadPageCollaboration,applyLoadedCollaboration,toBase64} from "../engine/collaboration.ts";
import {localTotp} from "./local-totp.mjs";
process.loadEnvFile(".env.local");
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,"http://127.0.0.1:55421");
const label=JSON.parse(execFileSync("docker",["inspect","-f","{{json .Config.Labels}}","supabase_db_Confluence"],{encoding:"utf8"}));
assert.equal(label["com.supabase.cli.workdir"],process.cwd());
const path="/private/tmp/hestia-service-fixtures.json";
const f=JSON.parse(readFileSync(path,"utf8")); assert.equal(f.url,process.env.NEXT_PUBLIC_SUPABASE_URL);
const owner=f.users.find(user=>user.id===f.mfa?.userId); assert.ok(owner);
const client=createClient(f.url,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const value=result=>{if(result.error)throw result.error;return result.data;};
try {
  value(await client.auth.signInWithPassword({email:owner.email,password:owner.password}));
  const security=createSupabaseSecurityAdapter(client); value(await security.verifyTotp(f.mfa.factorId,localTotp(f.mfa.secret)));
  const engine=createHestiaEngine(client); const page=value(await engine.pages.get(f.pageId)); assert.ok(page);
  if(process.argv.includes("--capture")) {
    const loaded=await loadPageCollaboration(client,f.pageId); const doc=new Y.Doc();
    if(loaded.shouldSeed)await seedPageCollaboration(client,f.pageId,loaded.generation,buildSeedUpdate(getSchema([StarterKit]),page.content));
    applyLoadedCollaboration(doc,await loadPageCollaboration(client,f.pageId),"backup");
    f.backupMarker="volume-check-"+crypto.randomUUID(); let update;
    doc.on("update",bytes=>{update=bytes;}); doc.getText("backup-check").insert(0,f.backupMarker);
    await appendPageCollaborationUpdate(client,f.pageId,loaded.generation,crypto.randomUUID(),toBase64(update)); doc.destroy();
    f.backupEvents=value(await engine.audit.list(page.workspace_id)).length;
    writeFileSync(path,JSON.stringify(f),{mode:0o600}); console.log("PASS: captured synthetic document log and audit state for local restart check.");
  } else {
    assert.ok(f.backupMarker); const doc=new Y.Doc(); applyLoadedCollaboration(doc,await loadPageCollaboration(client,f.pageId),"backup");
    assert.equal(doc.getText("backup-check").toString(),f.backupMarker); doc.destroy();
    assert.equal(value(await engine.audit.list(page.workspace_id)).length,f.backupEvents);
    const image=f.uploads.find(image=>image.userId===owner.id); assert.ok(value(await client.storage.from("page-images").download(image.path)).size>0);
    assert.ok(value(await security.listFactors()).some(factor=>factor.id===f.mfa.factorId&&factor.status==="verified"));
    console.log("PASS: Auth MFA, document/log, audit events and private image survived the local volume restart.");
  }
} finally {client.auth.stopAutoRefresh();await client.removeAllChannels();}
