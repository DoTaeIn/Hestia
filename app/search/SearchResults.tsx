"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import BrandMark from "../BrandMark";
import AccountMenu from "../AccountMenu";
import NotificationBell from "../NotificationBell";
import { useTheme } from "../useTheme";
import { highlight } from "../highlight";
import { workspaceHref } from "@/lib/workspace-context";
import { Moon, Search, Sun } from "../icons";

export type SearchHit = {
  key: string;
  kind: "page" | "reason";
  pageId: string;
  title: string;
  space: string;
  text: string;
  version?: number | null;
};

export default function SearchResults({ hits, query, workspaceId }: { hits: SearchHit[]; query: string; workspaceId: string }) {
  const { dark, toggle: toggleDark } = useTheme();
  const router = useRouter();
  const [q, setQ] = useState(query);
  const field = useRef<HTMLInputElement>(null);
  const reasonCount = hits.filter((hit) => hit.kind === "reason").length;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next = q.trim();
    router.replace(workspaceHref(next ? `/search?q=${encodeURIComponent(next)}` : "/search", workspaceId));
  }

  function clear() {
    setQ("");
    router.replace(workspaceHref("/search", workspaceId));
    field.current?.focus();
  }

  return (
    <div className="surface search-page">
      <header className="bar">
        <Link className="bar-mark" href={workspaceHref("/space", workspaceId)}>
          <BrandMark size={28} />
        </Link>

        <form className="search-field" role="search" onSubmit={onSubmit}>
          <Search size={16} />
          <label className="sr-only" htmlFor="search-q">
            문서 검색 — 제목, 본문, 그리고 변경 이유
          </label>
          <input
            id="search-q"
            ref={field}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && q && clear()}
            placeholder="제목·본문·변경 이유에 쓰인 말"
            autoComplete="off"
            autoFocus
          />
          {q && (
            <button
              type="button"
              className="search-clear"
              aria-label="검색어 지우기"
              title="검색어 지우기 (Esc)"
              onClick={clear}
            >
              ✕
            </button>
          )}
        </form>

        <div className="bar-right">
          <button
            type="button"
            className="ctl"
            aria-label={dark ? "밝은 화면으로" : "어두운 화면으로"}
            title={dark ? "밝은 화면으로" : "어두운 화면으로"}
            onClick={toggleDark}
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <NotificationBell />
          <AccountMenu />
        </div>
      </header>

      <main className="search-main">
        <div className="doc-scroll">
          <div className="doc-sheet search-sheet">
            <p className="search-count" aria-live="polite">
              {query
                ? `“${query}” 결과 ${hits.length}건${reasonCount ? ` · 이 중 변경 이유 ${reasonCount}건` : ""}`
                : `최근 문서 ${hits.length}건`}
            </p>

            <ul className="search-list">
              {hits.map((hit) => (
                <li key={hit.key}>
                  <Link href={`/editor/${hit.pageId}`} className="search-hit">
                    {hit.kind === "reason" && (
                      <p className="search-kind">
                        <span className="search-kind-tag">변경 이유</span>
                        <span className="latin">v{hit.version}</span>
                      </p>
                    )}
                    {hit.text && <p className="search-text">{highlight(hit.text, query)}</p>}
                    <p className="search-src">
                      {highlight(hit.space, query)} <span aria-hidden="true">/</span> {highlight(hit.title, query)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>

            {query && hits.length === 0 && (
              <p className="empty search-empty">
                <b>“{query}”로 찾은 것이 없습니다.</b>
                제목·본문뿐 아니라 판마다 적어 둔 변경 이유까지 찾아봤습니다. 더 짧은 낱말로 좁혀 보세요.
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
