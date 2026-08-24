// node --test lib/pages.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { needsReason, REASON_SHRINK_CHARS } from "./pages.ts";

const doc = (...paragraphs: string[]) => ({
  type: "doc",
  content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});

const long = "가".repeat(REASON_SHRINK_CHARS + 10);
const page = (title: string, ...paragraphs: string[]) => ({ title, content: doc(...paragraphs) });

test("제목이 바뀌면 묻는다", () => {
  assert.equal(needsReason(page("배포 절차", "본문"), page("배포 절차 v2", "본문")), true);
});

test("문단이 통째로 사라지면 묻는다", () => {
  assert.equal(needsReason(page("문서", "남는 문단", long), page("문서", "남는 문단")), true);
});

test("내용이 늘기만 하면 묻지 않는다", () => {
  assert.equal(needsReason(page("문서", "본문"), page("문서", "본문", long)), false);
});

test("오타 한 글자 지우는 정도로는 묻지 않는다", () => {
  assert.equal(needsReason(page("문서", "본문입니닿"), page("문서", "본문입니다")), false);
});

test("경계: 정확히 기준치만큼 줄면 묻는다", () => {
  // 빈 문서의 "(내용 없음)" 자리표시자가 길이로 세어지면 이 판정이 무너진다
  assert.equal(needsReason(page("문서", "가".repeat(REASON_SHRINK_CHARS)), page("문서", "")), true);
});

test("경계: 기준치보다 한 글자 덜 줄면 묻지 않는다", () => {
  assert.equal(needsReason(page("문서", "가".repeat(REASON_SHRINK_CHARS - 1)), page("문서", "")), false);
});
