import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_NEXT, safeNext } from "./safeNext.ts";

test("rejects external and parser-normalized redirect destinations", () => {
  for (const value of [
    "https://other.example", "//other.example", "/\\other.example",
    "/\t/other.example", "/\n/other.example", "/\r/other.example",
    "/\u0000/other.example", "/space\\other", "javascript:alert(1)",
  ]) assert.equal(safeNext(value), DEFAULT_NEXT, JSON.stringify(value));
});

test("preserves local destinations including workspace and search context", () => {
  for (const value of ["/space?workspace=abc", "/search?workspace=abc&q=a%20b", "/editor/abc#section"])
    assert.equal(safeNext(value), value);
});

test("uses the caller's fallback for absent or unsafe destinations", () => {
  for (const value of [null, undefined, "", "//other.example"])
    assert.equal(safeNext(value, "/space"), "/space");
});
