import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";

test("engine modules keep UI, session construction and environment configuration outside the boundary", () => {
  const directory = new URL("./", import.meta.url);
  for (const name of readdirSync(directory).filter(name => name.endsWith(".ts") && !name.endsWith(".test.ts"))) {
    const source = readFileSync(new URL(name, directory), "utf8");
    const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const dependency = node.moduleSpecifier.text;
        assert.ok(!/^(?:react(?:\/|$)|next(?:\/|$)|@\/|\.\.\/)/.test(dependency), `${name} imports shell dependency ${dependency}`);
        assert.ok(!dependency.includes("supabase/ssr"), `${name} constructs a platform session`);
      }
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
        assert.ok(!["localStorage", "window", "document"].includes(node.expression.text), `${name} accesses browser state directly`);
        assert.ok(!(node.expression.text === "process" && node.name.text === "env"), `${name} reads application environment`);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
});

test("the basic engine entry loads without a session or app configuration", async () => {
  const api = await import("./index.ts");
  assert.equal(typeof api.createHestiaEngine, "function");
  assert.equal(api.getCapabilities({ role: undefined }).canRead, false);
});
