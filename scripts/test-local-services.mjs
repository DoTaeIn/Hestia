/** Real Auth/PostgREST/Storage/Realtime integration, deliberately local-only.
 * Run: node scripts/test-local-services.mjs [--keep-fixtures]
 * Uses .env.local without printing keys or session tokens. Requires Node 24.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import * as Y from "yjs";
import { createSupabaseSecurityAdapter } from "../engine/security.ts";
import { localTotp } from "./local-totp.mjs";
import { createSupabaseAuthAdapter } from "../engine/auth.ts";
import { createHestiaEngine } from "../engine/index.ts";
import { CollaborationProviderCore, applyLoadedCollaboration, appendPageCollaborationUpdate, loadPageCollaboration, seedPageCollaboration, createMemoryOperationStore, toBase64 } from "../engine/collaboration.ts";

process.loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
assert.equal(url, "http://127.0.0.1:55421", "Refusing to test any target except this project's local Supabase");
assert.ok(key, "Configure the local publishable key in .env.local");
const container = "supabase_db_Confluence";
const labels = JSON.parse(execFileSync("docker", ["inspect", "-f", "{{json .Config.Labels}}", container], { encoding: "utf8" }));
assert.equal(labels["com.supabase.cli.workdir"], process.cwd(), "Refusing an unrelated Docker project");
const keep = process.argv.includes("--keep-fixtures");
const run = crypto.randomUUID().slice(0, 8);
const fixturePath = "/private/tmp/hestia-service-fixtures.json";
const users = [];
const extraClients = [];
let mfaFixture;
const workspaces = [];
const uploads = [];
const providers = [];
const docs = [];
const channels = [];
const results = [];
let page;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const value = result => { if (result.error) throw result.error; return result.data; };
const check = (condition, label) => { assert.ok(condition, label); results.push(label); console.log("PASS:", label); };
async function until(predicate, label, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await delay(80); }
  throw new Error("Timed out: " + label);
}
function makeClient() { return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }); }
async function signup(role) {
  const client = makeClient();
  const email = `hestia-e2e-${run}-${role}@example.com`;
  const password = "Local-Audit!" + crypto.randomUUID();
  const { data, error } = await client.auth.signUp({ email, password, options: { data: { display_name: "E2E " + role } } });
  if (error) throw error;
  assert.ok(data.user && data.session, "Local Auth must create a confirmed test session");
  await client.realtime.setAuth(data.session.access_token);
  const user = { id: data.user.id, email, password, client, engine: createHestiaEngine(client) };
  users.push(user);
  return user;
}
function fixture() {
  return { run, url, mfa: mfaFixture, users: users.map(({ id, email, password }) => ({ id, email, password })), workspaces, uploads: uploads.map(({ owner, path }) => ({ userId: owner.id, path })), pageId: page?.id };
}
async function subscribe(client, topic, received) {
  const channel = client.channel(topic, { config: { private: true, broadcast: { self: false, ack: true } } });
  channels.push({ client, channel });
  channel.on("broadcast", { event: "integration-probe" }, message => received.push(message.payload));
  const status = await new Promise(resolve => {
    const timer = setTimeout(() => resolve("TIMEOUT"), 15000);
    channel.subscribe((status) => { if (["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT"].includes(status)) { clearTimeout(timer); resolve(status); } });
  });
  return { channel, status };
}

try {
  const owner = await signup("owner");
  const editor = await signup("editor");
  const viewer = await signup("viewer");
  const outsider = await signup("outsider");
  check(users.length === 4, "real Auth signup creates four independent sessions and profiles");

  check(value(await owner.engine.profiles.getSelf()).display_name === "E2E owner", "signup metadata provisions the bounded own profile");
  const profile = value(await owner.engine.profiles.updateSelf({ displayName: "  Preview owner  ", avatarUrl: "https://example.com/avatar.png" }));
  check(profile.display_name === "Preview owner" && profile.avatar_url === "https://example.com/avatar.png", "own profile name and avatar persist through real PostgREST");
  value(await owner.engine.profiles.updateSelf({ displayName: "E2E owner", avatarUrl: "" }));
  check(value(await owner.engine.profiles.getSelf()).avatar_url === null, "own avatar can be cleared");
  const stolen = await outsider.client.from("profiles").update({ display_name: "stolen" }).eq("id", owner.id).select("id");
  check(!stolen.error && stolen.data.length === 0 && value(await owner.engine.profiles.getSelf()).display_name === "E2E owner", "RLS prevents another account from editing a profile");
  const immutable = await owner.client.from("profiles").update({ created_at: new Date(0).toISOString() }).eq("id", owner.id);
  check(Boolean(immutable.error), "column grants prevent direct profile timestamp forgery");
  const unsafeAvatar = await owner.client.from("profiles").update({ avatar_url: "javascript:alert(1)" }).eq("id", owner.id);
  check(Boolean(unsafeAvatar.error), "database rejects unsafe avatars even when bypassing the engine");
  const forgedEngine = createHestiaEngine(outsider.client, { identity: { getUser: async () => ({ data: { id: owner.id, email: owner.email }, error: null }) } });
  check(Boolean((await forgedEngine.profiles.updateSelf({ displayName: "forged" })).error), "an injected identity cannot override the actual database JWT");
  const loginClient = makeClient();
  const authAdapter = createSupabaseAuthAdapter(loginClient);
  check(value(await authAdapter.signInWithPassword({ email: owner.email, password: owner.password })).id === owner.id, "default adapter signs in through real password Auth");
  value(await authAdapter.signOut());
  check(value(await authAdapter.getUser()) === null, "default adapter signs out and reports no session");
  loginClient.auth.stopAutoRefresh();
  // Supabase signOut defaults to global scope; establish the fixture's new session.
  value(await createSupabaseAuthAdapter(owner.client).signInWithPassword({ email: owner.email, password: owner.password }));
  await owner.client.realtime.setAuth((await owner.client.auth.getSession()).data.session.access_token);

  const workspace = value(await owner.engine.workspaces.create({ name: "Hestia local E2E " + run }));
  workspaces.push(workspace.id);
  const other = value(await outsider.engine.workspaces.create({ name: "Other tenant " + run }));
  workspaces.push(other.id);
  value(await owner.engine.workspaces.invite({ workspaceId: workspace.id, email: editor.email, role: "editor" }));
  value(await owner.engine.workspaces.invite({ workspaceId: workspace.id, email: viewer.email, role: "viewer" }));
  check(value(await editor.engine.workspaces.listMemberships(editor.id)).some(row => row.workspaceId === workspace.id), "workspace creation and registered-member invitation via real RPC");

  const customWriter = value(await owner.engine.roles.create({ workspaceId: workspace.id, name: "회의록 담당", permissions: ["pages.write"] }));
  const customManager = value(await owner.engine.roles.create({ workspaceId: workspace.id, name: "구성원 담당", permissions: ["members.manage"] }));
  check(customWriter.workspace_id === workspace.id && value(await viewer.engine.roles.list(workspace.id)).length === 2 && value(await outsider.engine.roles.list(workspace.id)).length === 0, "custom roles are owner-defined and tenant-scoped");
  check(Boolean((await editor.engine.roles.create({ workspaceId: workspace.id, name: "forged", permissions: ["members.manage"] })).error), "editors cannot define privileged custom roles");
  value(await owner.engine.members.assignRole(workspace.id, editor.id, customWriter.id));
  const customMembership = value(await editor.engine.workspaces.listMemberships(editor.id)).find(row => row.workspaceId === workspace.id);
  check(customMembership?.permissions?.includes("pages.write") && customMembership.customRoleId === customWriter.id, "custom permissions reach the session-scoped engine membership API");
  const customPage = value(await editor.engine.pages.create({ workspaceId: workspace.id, title: "Custom role document" }));
  check(Boolean(customPage.id), "custom writer creates documents through actual RLS");
  value(await owner.engine.members.assignRole(workspace.id, viewer.id, customManager.id));
  check(Boolean((await viewer.engine.pages.create({ workspaceId: workspace.id, title: "Denied manager document" })).error), "custom member management does not grant document editing");
  check(Boolean((await viewer.engine.members.assignRole(workspace.id, editor.id, customManager.id)).error) && Boolean((await viewer.engine.workspaces.setMemberRole(workspace.id, owner.id, "viewer")).error), "custom manager cannot grant management or demote the owner");
  value(await viewer.engine.members.assignRole(workspace.id, editor.id, customWriter.id));
  check(value(await viewer.engine.members.list(workspace.id)).some(row => row.user_id === editor.id && row.custom_role_id === customWriter.id), "custom manager can assign an ordinary custom role");
  const otherRole = value(await outsider.engine.roles.create({ workspaceId: other.id, name: "Other tenant role", permissions: [] }));
  check(Boolean((await owner.engine.members.assignRole(workspace.id, editor.id, otherRole.id)).error), "role IDs from another workspace cannot be assigned");
  check(Boolean((await owner.engine.roles.delete(workspace.id, customWriter.id)).error), "assigned roles cannot be deleted");
  value(await owner.engine.workspaces.setMemberRole(workspace.id, editor.id, "editor"));
  value(await owner.engine.workspaces.setMemberRole(workspace.id, viewer.id, "viewer"));
  check(value(await owner.engine.members.list(workspace.id)).every(row => !row.custom_role_id), "fixed role assignment clears custom permissions");

  page = value(await owner.engine.pages.create({ workspaceId: workspace.id, title: "Local integration " + run, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Club handbook " + run }] }] } }));
  const revision = value(await owner.engine.revisions.save({ pageId: page.id, title: page.title, content: page.content, reason: "integration " + run }));
  check(Boolean(revision.id), "page creation and version recording via PostgREST");
  check((await viewer.engine.revisions.save({ pageId: page.id, title: "Forbidden", content: page.content })).error?.code === "forbidden", "viewer cannot record a version");
  check((await editor.engine.revisions.save({ pageId: page.id, title: "Forbidden", content: page.content })).error?.code === "forbidden", "non-owner editor cannot record another user's version");
  check(value(await outsider.engine.pages.get(page.id)) === null && value(await outsider.engine.pages.list(workspace.id)).length === 0, "cross-workspace page reads return no data");
  check((await outsider.engine.workspaces.invite({ workspaceId: workspace.id, email: outsider.email, role: "admin" })).error?.code === "forbidden", "outsider cannot add itself to a workspace");
  check(value(await owner.engine.search(workspace.id, run)).some(hit => hit.page_id === page.id) && value(await outsider.engine.search(workspace.id, run)).length === 0, "search is scoped by workspace and session");

  const thread = value(await editor.engine.comments.createThread({ workspaceId: workspace.id, pageId: page.id, quote: "Club", from: 1, to: 5 }));
  const comment = value(await editor.engine.comments.reply(thread.id, "Integration reply " + run));
  check(Boolean(comment.id) && value(await owner.engine.notifications.list()).some(n => n.page_id === page.id), "comment creation triggers a real notification");
  value(await editor.engine.comments.delete(comment.id));

  const imagePath = `${workspace.id}/${page.id}/${crypto.randomUUID()}.png`;
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ7sAAAAASUVORK5CYII=", "base64");
  const upload = await owner.client.storage.from("page-images").upload(imagePath, image, { contentType: "image/png", upsert: false });
  if (upload.error) throw upload.error;
  uploads.push({ owner, path: imagePath });
  const signed = await viewer.client.storage.from("page-images").createSignedUrl(imagePath, 60);
  if (signed.error) throw signed.error;
  const response = await fetch(signed.data.signedUrl);
  check(response.ok && Buffer.from(await response.arrayBuffer()).equals(image), "private Storage upload and member signed image download");
  const deniedImage = await outsider.client.storage.from("page-images").createSignedUrl(imagePath, 60);
  const viewerUpload = await viewer.client.storage.from("page-images").upload(`${workspace.id}/${page.id}/viewer-denied.png`, image, { contentType: "image/png" });
  check(Boolean(deniedImage.error) && Boolean(viewerUpload.error), "Storage denies outsider reads and viewer uploads");
  const anonymous = makeClient();
  const anonymousImage = await anonymous.storage.from("page-images").createSignedUrl(imagePath, 60);
  const publicImage = await fetch(`${url}/storage/v1/object/public/page-images/${imagePath}`);
  check(Boolean(anonymousImage.error) && !publicImage.ok, "anonymous users and public object URLs cannot read the private bucket");
  anonymous.auth.stopAutoRefresh();

  const topic = "page-v2:" + page.id;
  const received = [];
  const ownerChannel = await subscribe(owner.client, topic, received);
  const editorChannel = await subscribe(editor.client, topic, []);
  const viewerChannel = await subscribe(viewer.client, topic, []);
  const outsiderChannel = await subscribe(outsider.client, topic, []);
  check(ownerChannel.status === "SUBSCRIBED" && editorChannel.status === "SUBSCRIBED" && viewerChannel.status === "SUBSCRIBED", "members join real private Realtime channels");
  check(outsiderChannel.status !== "SUBSCRIBED", "Realtime refuses an outsider's private channel join");
  await editorChannel.channel.send({ type: "broadcast", event: "integration-probe", payload: { source: "editor" } });
  await until(() => received.some(message => message.source === "editor"), "authorized broadcast delivery");
  await viewerChannel.channel.send({ type: "broadcast", event: "integration-probe", payload: { source: "viewer" } });
  await delay(700);
  check(!received.some(message => message.source === "viewer"), "Realtime accepts editor broadcasts and rejects viewer broadcasts");
  for (const item of channels.splice(0)) await item.client.removeChannel(item.channel);

  const seedA = new Y.Doc(); const seedB = new Y.Doc();
  docs.push(seedA, seedB);
  seedA.getText("integration").insert(0, "canonical A ");
  seedB.getText("integration").insert(0, "canonical B ");
  const seeds = await Promise.all([
    seedPageCollaboration(owner.client, page.id, 1, toBase64(Y.encodeStateAsUpdate(seedA))),
    seedPageCollaboration(editor.client, page.id, 1, toBase64(Y.encodeStateAsUpdate(seedB))),
  ]);
  check(seeds.filter(seed => seed.seeded).length === 1 && seeds[0].state === seeds[1].state, "real concurrent RPCs choose exactly one canonical Yjs seed");
  const statuses = [[], []];
  const peers = [owner, editor].map((user, index) => {
    const doc = new Y.Doc(); docs.push(doc);
    const provider = new CollaborationProviderCore(doc, page.id, 1, { id: user.id, name: "E2E" }, { client: user.client, realtime: user.client, store: createMemoryOperationStore(), onStatus: status => statuses[index].push(status.status) });
    providers.push(provider);
    return doc;
  });
  await until(() => statuses.every(list => list.at(-1) === "live"), "both real providers complete database catchup");
  peers[0].getText("integration").insert(peers[0].getText("integration").length, "edit A ");
  peers[1].getText("integration").insert(peers[1].getText("integration").length, "edit B ");
  await until(() => peers.every(doc => doc.getText("integration").toString().includes("edit A") && doc.getText("integration").toString().includes("edit B")), "two-session Yjs convergence over real WebSockets");
  await until(async () => (await loadPageCollaboration(owner.client, page.id)).updates.length >= 2, "both changes acknowledged in real database");
  const reopened = new Y.Doc(); docs.push(reopened);
  applyLoadedCollaboration(reopened, await loadPageCollaboration(owner.client, page.id), "integration");
  check(reopened.getText("integration").toString() === peers[0].getText("integration").toString() && peers[0].getText("integration").toString() === peers[1].getText("integration").toString(), "two real providers converge and reopened DB state preserves both edits");
  value(await owner.engine.workspaces.invite({ workspaceId: workspace.id, email: outsider.email, role: "editor" }));
  const revokedDoc = new Y.Doc(); docs.push(revokedDoc); const revokedStatuses = [];
  const revokedProvider = new CollaborationProviderCore(revokedDoc, page.id, 1, { id: outsider.id, name: "revoked" }, { client: outsider.client, realtime: outsider.client, store: createMemoryOperationStore(), onStatus: status => revokedStatuses.push(status.status) });
  providers.push(revokedProvider);
  await until(() => revokedStatuses.at(-1) === "live", "temporary peer finishes DB catchup");
  const observer = makeClient(); extraClients.push(observer);
  const observerLogin = await observer.auth.signInWithPassword({ email: outsider.email, password: outsider.password }); if (observerLogin.error) throw observerLogin.error;
  await observer.realtime.setAuth(observerLogin.data.session.access_token);
  const retainedPayloads = []; const retainedChannel = observer.channel(topic, { config: { private: true, broadcast: { self: false, ack: true } } });
  retainedChannel.on("broadcast", { event: "yjs-persisted" }, message => retainedPayloads.push(message.payload));
  await new Promise((resolve,reject) => { retainedChannel.subscribe(status => { if (status === "SUBSCRIBED") resolve(); if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error("observer join failed")); }); });
  value(await owner.engine.workspaces.removeMember(workspace.id, outsider.id));
  peers[0].getText("integration").insert(peers[0].getText("integration").length, " after-revocation-secret ");
  await until(() => peers[1].getText("integration").toString().includes("after-revocation-secret"), "authorized receiver sees persisted new data");
  await until(() => revokedStatuses.includes("forbidden"), "removed peer rechecks DB authorization");
  check(!revokedDoc.getText("integration").toString().includes("after-revocation-secret") && retainedPayloads.every(payload => Object.keys(payload).length === 1 && typeof payload.generation === "number"), "cached Realtime subscription receives no document bytes after revocation");
  const malicious = new Y.Doc(); docs.push(malicious); malicious.getText("integration").insert(0,"forged-legacy-payload");
  await retainedChannel.send({ type: "broadcast", event: "yjs-update", payload: { generation: 1, update: toBase64(Y.encodeStateAsUpdate(malicious)) } });
  await delay(300);
  check(peers.every(doc => !doc.getText("integration").toString().includes("forged-legacy-payload")), "revoked writer cannot inject legacy raw broadcast content");
  revokedProvider.destroy(); providers.splice(providers.indexOf(revokedProvider),1);
  await observer.removeAllChannels();

  const retryId = crypto.randomUUID();
  const retryPayload = toBase64(Y.encodeStateAsUpdate(peers[0]));
  const firstAppend = await appendPageCollaborationUpdate(owner.client, page.id, 1, retryId, retryPayload);
  const retriedAppend = await appendPageCollaborationUpdate(owner.client, page.id, 1, retryId, retryPayload);
  await assert.rejects(() => appendPageCollaborationUpdate(owner.client, page.id, 1, retryId, toBase64(Y.encodeStateAsUpdate(seedA))), /different update/);
  check(firstAppend.status === "appended" && retriedAppend.status === "duplicate", "real HTTP retries are idempotent and changed-payload UUID reuse is rejected");

  value(await owner.engine.revisions.restore({ pageId: page.id, revisionId: revision.id, reason: "integration restore" }));
  peers[1].getText("integration").insert(0, "stale ");
  await until(() => statuses[1].includes("stale"), "provider detects real restore generation fence");
  const afterRestore = await loadPageCollaboration(owner.client, page.id);
  check(afterRestore.generation === 2 && afterRestore.state === null && afterRestore.updates.length === 0, "restore clears old collaboration and fences live stale writers");
  for (const provider of providers.splice(0)) provider.destroy();
  value(await owner.engine.workspaces.removeMember(workspace.id, editor.id));
  const revoked = await editor.client.rpc("append_page_collaboration_update", { target_page_id: page.id, expected_generation: 2, operation_id: crypto.randomUUID(), update_payload: retryPayload }).single();
  check(Boolean(revoked.error) && value(await editor.engine.pages.get(page.id)) === null, "revoked membership immediately blocks database reads and collaboration writes");
  value(await owner.engine.workspaces.invite({ workspaceId: workspace.id, email: editor.email, role: "editor" }));
  value(await owner.engine.pages.trash(page.id));
  check(value(await owner.engine.pages.list(workspace.id, { trashed: true })).some(row => row.id === page.id), "trash hides active page and lists it in the workspace trash");
  value(await owner.engine.pages.restore(page.id));
  check(Boolean(value(await owner.engine.pages.get(page.id))), "restore from trash succeeds through the real API");

  check(value(await owner.engine.audit.list(workspace.id)).some(event => event.action === "role.created") && value(await viewer.engine.audit.list(workspace.id)).length === 0 && value(await outsider.engine.audit.list(workspace.id)).length === 0, "audit events are visible only to this workspace's managers");
  const forgedAudit = await owner.client.from("workspace_security_events").insert({ workspace_id: workspace.id, action: "member.added", actor_id: outsider.id });
  check(Boolean(forgedAudit.error), "even the workspace owner cannot forge an audit event");
  const lowClient = makeClient(); extraClients.push(lowClient);
  value(await createSupabaseAuthAdapter(lowClient).signInWithPassword({ email: owner.email, password: owner.password }));
  const security = createSupabaseSecurityAdapter(owner.client);
  const enrollment = value(await security.enrollTotp());
  check(value(await security.listFactors()).some(factor => factor.id === enrollment.id && factor.status === "unverified"), "actual Auth exposes unfinished TOTP enrollment for cleanup");
  const wrong = localTotp(enrollment.secret).replace(/^./, digit => String((Number(digit)+1)%10));
  check(Boolean((await security.verifyTotp(enrollment.id, wrong)).error), "actual Auth rejects a wrong TOTP code");
  value(await security.verifyTotp(enrollment.id, localTotp(enrollment.secret)));
  mfaFixture = { userId: owner.id, factorId: enrollment.id, secret: enrollment.secret };
  check(value(await security.getAssurance()).currentLevel === "aal2", "real TOTP verification upgrades the session to aal2");
  const lowEngine = createHestiaEngine(lowClient);
  check(value(await lowEngine.pages.get(page.id)) === null && Boolean((await lowEngine.roles.create({ workspaceId: workspace.id, name: "AAL1 forged", permissions: [] })).error), "enrolled user's old aal1 token cannot bypass MFA through direct DB APIs");
  check(Boolean((await lowClient.storage.from("page-images").download(imagePath)).error), "MFA restriction also applies to authenticated Storage downloads");
  const lowSecurity = createSupabaseSecurityAdapter(lowClient);
  const secondEnrollment = await lowSecurity.enrollTotp();
  if (secondEnrollment.error) check(true, "aal1 cannot enroll a replacement for established MFA");
  else {
    const bypass = await lowSecurity.verifyTotp(secondEnrollment.data.id, localTotp(secondEnrollment.data.secret));
    check(Boolean(bypass.error), "aal1 cannot bootstrap a replacement factor to bypass established MFA");
    value(await lowSecurity.unenroll(secondEnrollment.data.id));
  }
  check(Boolean((await createSupabaseSecurityAdapter(lowClient).unenroll(enrollment.id)).error), "aal1 session cannot remove a verified MFA factor");
  check(Boolean(value(await owner.engine.pages.get(page.id))) && value(await owner.engine.audit.list(workspace.id)).length > 0, "aal2 restores authorized document and audit access");
  if (!keep) { value(await security.unenroll(enrollment.id)); mfaFixture = undefined; }

  if (keep) {
    writeFileSync(fixturePath, JSON.stringify(fixture()), { mode: 0o600 });
    console.log("Local-only browser fixtures retained in", fixturePath);
  }
  console.log(`Integration checks passed: ${results.length}`);
} catch (error) {
  console.error("INTEGRATION FAILED:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
  if (keep) writeFileSync(fixturePath, JSON.stringify(fixture()), { mode: 0o600 });
} finally {
  for (const provider of providers) provider.destroy();
  for (const doc of docs) doc.destroy();
  for (const user of users) { await user.client.removeAllChannels(); user.client.auth.stopAutoRefresh(); }
  for (const client of extraClients) { await client.removeAllChannels(); client.auth.stopAutoRefresh(); }
  if (!keep) {
    for (const { owner, path } of uploads) await owner.client.storage.from("page-images").remove([path]);
    const uuid = value => { assert.match(value, /^[0-9a-f-]{36}$/); return "'" + value + "'"; };
    const sql = [workspaces.length ? `delete from public.workspaces where id in (${workspaces.map(uuid).join(",")});` : "", users.length ? `delete from auth.users where id in (${users.map(user => uuid(user.id)).join(",")});` : ""].join("\n");
    if (sql) execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: sql, stdio: ["pipe", "ignore", "pipe"] });
    console.log("Local test fixtures removed.");
  }
}
