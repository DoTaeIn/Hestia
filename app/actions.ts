"use server";

import { appendFile } from "node:fs/promises";
import { join } from "node:path";

export type JoinState = { ok: boolean; message: string } | null;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ponytail: append-only JSONL next to the app. Swap for the real API once the
// NestJS service exists — this only has to survive the waitlist.
const STORE = join(process.cwd(), "waitlist.jsonl");

export async function join_waitlist(
  _prev: JoinState,
  form: FormData,
): Promise<JoinState> {
  const email = String(form.get("email") ?? "").trim();

  if (!email) {
    return { ok: false, message: "이메일을 입력해 주세요." };
  }
  if (email.length > 254 || !EMAIL.test(email)) {
    return {
      ok: false,
      message: "이메일 주소 형식이 아닙니다. 예: name@company.com",
    };
  }

  try {
    await appendFile(
      STORE,
      JSON.stringify({ email, at: new Date().toISOString() }) + "\n",
      "utf8",
    );
  } catch {
    return {
      ok: false,
      message: "지금은 등록할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  return { ok: true, message: "등록되었습니다. 베타가 열리면 이 주소로 알립니다." };
}
