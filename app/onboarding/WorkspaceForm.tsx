"use client";

import { useActionState } from "react";
import { createWorkspace, type WorkspaceState } from "./actions";

const initialState: WorkspaceState = {};

export default function WorkspaceForm() {
  const [state, action, pending] = useActionState(createWorkspace, initialState);

  return (
    <form className="auth-form" action={action}>
      <label className="auth-field">
        워크스페이스 이름
        <input name="name" required minLength={2} maxLength={80} autoFocus placeholder="예: 플랫폼실" />
      </label>
      <p className="auth-hint">처음 만든 분은 소유자가 되며, 이후 팀원을 초대할 수 있습니다.</p>
      {state.error && <p className="auth-error" role="alert">{state.error}</p>}
      <button type="submit" className="ctl ctl-solid auth-submit" disabled={pending}>
        {pending ? "만드는 중…" : "워크스페이스 만들기"}
      </button>
    </form>
  );
}
