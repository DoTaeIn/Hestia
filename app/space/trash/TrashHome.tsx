"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import BrandMark from "../../BrandMark";
import { createClient } from "@/lib/supabase/browser";
import type { PageRecord } from "@/lib/pages";
import { Restore, Trash } from "../../icons";

export default function TrashHome({ workspaceName, pages }: { workspaceName: string; pages: PageRecord[] }) {
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const router = useRouter();

  async function restore(id: string) {
    setError(null);
    setRestoring(id);
    const { error } = await createClient().rpc("restore_page", { target_page_id: id });
    setRestoring(null);
    if (error) setError("문서를 복구하지 못했습니다. 잠시 후 다시 시도해주세요.");
    else router.refresh();
  }

  return (
    <div className="workbench surface trash-page">
      <header className="bar"><Link className="bar-mark" href="/space"><BrandMark size={28} /></Link><nav className="crumb" aria-label="현재 위치"><Link href="/space">{workspaceName}</Link><span aria-hidden="true"> /</span><b>휴지통</b></nav></header>
      <main className="doc"><div className="doc-scroll"><div className="doc-sheet space-sheet">
        <header className="space-header"><span className="space-icon" aria-hidden="true"><Trash size={26} /></span><div><h1 className="doc-title">휴지통</h1><p className="doc-meta">휴지통으로 옮긴 문서는 복구할 수 있습니다.</p></div></header>
        {error && <p className="space-error" role="alert">{error}</p>}
        {pages.length ? <ul className="trash-list">{pages.map((page) => <li key={page.id}><span><b>{page.title}</b><small>{page.deleted_at ? new Date(page.deleted_at).toLocaleString("ko-KR") : ""}</small></span><button type="button" className="ctl" disabled={restoring === page.id} onClick={() => restore(page.id)}><Restore size={15} />{restoring === page.id ? "복구 중…" : "복구"}</button></li>)}</ul> : <p className="empty"><b>휴지통이 비어 있습니다</b>문서를 삭제하면 이곳에서 복구할 수 있습니다.</p>}
      </div></div></main>
    </div>
  );
}
