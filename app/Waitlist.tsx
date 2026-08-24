"use client";

import { useActionState } from "react";
import { join_waitlist, type JoinState } from "./actions";
import { ArrowRight } from "./icons";

export default function Waitlist({ id }: { id?: string }) {
  const [state, action, pending] = useActionState<JoinState, FormData>(
    join_waitlist,
    null,
  );

  return (
    <form className="waitlist" action={action} id={id} noValidate>
      <div className="waitlist-row">
        <label className="sr-only" htmlFor={`${id ?? "wl"}-email`}>
          이메일 주소
        </label>
        <input
          id={`${id ?? "wl"}-email`}
          name="email"
          type="email"
          autoComplete="email"
          placeholder="name@company.com"
          disabled={pending || state?.ok}
          aria-invalid={state?.ok === false}
          aria-describedby={state ? `${id ?? "wl"}-msg` : undefined}
        />
        <button className="btn btn-amber" type="submit" disabled={pending || state?.ok}>
          {pending ? "등록하는 중" : state?.ok ? "등록됨" : "대기자 등록"}
          {!pending && !state?.ok && <ArrowRight size={16} />}
        </button>
      </div>

      <p
        id={`${id ?? "wl"}-msg`}
        className={`waitlist-msg${state ? (state.ok ? " is-ok" : " is-err") : ""}`}
        role="status"
        aria-live="polite"
      >
        {state
          ? state.message
          : "베타가 열릴 때 한 번만 메일을 보냅니다. 그 외에는 쓰지 않습니다."}
      </p>
    </form>
  );
}
