// node --test lib/search.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { snippet, SNIPPET_PAD } from "./search.ts";

const filler = (n: number) => "가".repeat(n);

test("맞은 자리를 반드시 품는다", () => {
  const text = `${filler(500)}폐기된절차${filler(500)}`;
  assert.ok(snippet(text, "폐기된절차").includes("폐기된절차"));
});

test("양쪽이 잘리면 양쪽에 줄임표", () => {
  const out = snippet(`${filler(500)}표적${filler(500)}`, "표적");
  assert.ok(out.startsWith("…"));
  assert.ok(out.endsWith("…"));
});

test("짧은 글은 통째로, 줄임표 없이", () => {
  assert.equal(snippet("짧은 본문", "본문"), "짧은 본문");
});

test("대소문자를 가리지 않고 찾는다", () => {
  assert.ok(snippet("Deploy 절차", "deploy").includes("Deploy"));
});

test("검색어가 없거나 안 맞으면 앞에서부터 자른다", () => {
  const text = filler(500);
  assert.equal(snippet(text, "").length, SNIPPET_PAD * 2);
  assert.equal(snippet(text, "없는말").length, SNIPPET_PAD * 2);
});

test("맞은 자리가 끝에 있어도 잘려나가지 않는다", () => {
  const text = `${filler(500)}꼬리`;
  const out = snippet(text, "꼬리");
  assert.ok(out.endsWith("꼬리"), out.slice(-10));
});
