/** Build a source-only Preview 0.1 archive and a fresh-install SQL bundle. */
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
assert.equal(pkg.name, "hestia");
assert.equal(pkg.version, "0.1.0-preview.3");
const release = "hestia-preview-0.1";
const sha = content => createHash("sha256").update(content).digest("hex");
const migrationDir = join(root, "supabase", "migrations");
const migrationNames = (await readdir(migrationDir)).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
assert.equal(migrationNames.length, 26, "Review the release schema version before packaging");
const migrations = [];
for (const [index, file] of migrationNames.entries()) {
  assert.equal(Number(file.slice(0, 4)), index + 1, "Migration numbers must be contiguous");
  const sql = await readFile(join(migrationDir, file), "utf8");
  migrations.push({ version: file.slice(0, 4), name: file.slice(5, -4), file, sql, sha256: sha(sql) });
}
const header = `-- Hestia Preview 0.1 (${pkg.version}) — generated; edit numbered migrations.
-- FRESH SUPABASE DATABASE ONLY. Existing installs use migration up, not this file.
-- Requires Supabase Auth, Storage, Realtime schemas and standard API roles.
begin;
do $fresh$
begin
  if exists (select 1 from pg_tables where schemaname = 'public'
    and tablename in ('profiles','workspaces','workspace_roles','workspace_members','pages','page_revisions','page_collaboration','page_collaboration_updates','comment_threads','comments','notifications')) then
    raise exception 'Hestia tables already exist. Apply pending numbered migrations instead.';
  end if;
end;
$fresh$;
`;
const sections = migrations.map(m => `\n-- ===== ${m.file} | SHA256 ${m.sha256} =====\n${m.sql}\n`).join("");
const history = `
-- Register versions so subsequent Supabase CLI upgrades do not replay them.
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key, statements text[], name text
);
insert into supabase_migrations.schema_migrations(version, name, statements) values
${migrations.map(m => `('${m.version}', '${m.name}', array[]::text[])`).join(",\n")};
commit;
`;
const install = header + sections + history;
await writeFile(join(root, "supabase", "install.sql"), install);
const dist = join(root, "dist");
await mkdir(dist, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), "hestia-preview-"));
try {
  const stage = join(temporary, release);
  await mkdir(stage);
  const allow = ["README.md", "LICENSE.md", "SECURITY.md", ".github", ".env.production.example", "CHANGELOG.md", "PRODUCT.md", "DESIGN.md", ".env.example", ".gitignore", "package.json", "package-lock.json", "next.config.mjs", "tsconfig.json", "middleware.ts", "auth.config.ts", "app", "engine", "lib", "public", "examples", "docs", "scripts"];
  for (const entry of allow) await cp(join(root, entry), join(stage, entry), { recursive: true });
  await mkdir(join(stage, "supabase"));
  for (const entry of ["migrations", "tests", "config.toml", "seed.sql", "install.sql", "security-check.sql", "README.md"]) {
    await cp(join(root, "supabase", entry), join(stage, "supabase", entry), { recursive: true });
  }
  const files = [];
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      assert.ok(!entry.isSymbolicLink(), "Release sources may not contain symlinks");
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await collect(path);
      else {
        const name = relative(stage, path).split("\\").join("/");
        assert.ok(!/(^|\/)(?:node_modules|\.next|\.git|\.temp|start-secrets|test-results)(\/|$)/.test(name));
        assert.ok(!/(^|\/)\.env(?:$|\..*local$)/.test(name));
        const content = await readFile(path);
        // Public environment examples contain placeholders, never live keys.
        if (/\.(?:ts|tsx|mjs|json|md|sql|toml|ya?ml)$/.test(name) || name.startsWith(".env.")) {
          const text = content.toString("utf8");
          assert.ok(!/sb_secret_[A-Za-z0-9_-]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text), "Private credential found in " + name);
          assert.ok(!/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/.test(text), "JWT-like credential found in " + name);
        }
        files.push({ path: name, bytes: content.byteLength, sha256: sha(content) });
      }
    }
  }
  await collect(stage);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const manifest = JSON.stringify({ product: "Hestia", label: "Preview 0.1", version: pkg.version, schemaVersion: migrations.at(-1).version, migrations: migrations.map(({ version, file, sha256 }) => ({ version, file, sha256 })), files }, null, 2) + "\n";
  await writeFile(join(stage, "RELEASE-MANIFEST.json"), manifest);
  const archive = join(dist, release + ".zip");
  const pending = join(dist, release + ".pending.zip");
  await rm(pending, { force: true });
  execFileSync("/usr/bin/zip", ["-qr", pending, release], { cwd: temporary });
  const entries = execFileSync("/usr/bin/unzip", ["-Z1", pending], { encoding: "utf8" });
  assert.ok(!/\/(?:\.env\.local|node_modules|\.next|\.git|\.temp|test-results)(?:\/|$)/m.test(entries), "Unexpected release entry");
  execFileSync("/usr/bin/unzip", ["-tq", pending], { stdio: "pipe" });
  await rename(pending, archive);
  const sqlName = release + "-install.sql";
  await writeFile(join(dist, sqlName), install);
  await writeFile(join(dist, release + ".manifest.json"), manifest);
  const sums = `${sha(await readFile(archive))}  ${release}.zip\n${sha(install)}  ${sqlName}\n${sha(manifest)}  ${release}.manifest.json\n`;
  await writeFile(join(dist, release + ".sha256"), sums);
  console.log(`Prepared ${release}: ${files.length} source files, schema ${migrations.at(-1).version}`);
  console.log("Archive, SQL, manifest and SHA256 checksums are in dist/.");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
