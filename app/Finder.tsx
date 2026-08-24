"use client";

import { useMemo, useState } from "react";
import { highlight } from "./highlight";
import { CORPUS } from "./data";
import { Search } from "./icons";

export default function Finder() {
  const [q, setQ] = useState("");
  const query = q.trim();

  const hits = useMemo(() => {
    if (!query) return [];
    const needle = query.toLowerCase();
    return CORPUS.filter((c) => c.text.toLowerCase().includes(needle));
  }, [query]);

  return (
    <div className="finder">
      <div className="finder-field">
        <Search size={17} />
        <label className="sr-only" htmlFor="finder-q">
          문서 본문 검색
        </label>
        <input
          id="finder-q"
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="예: 권한, 반출, 검색"
          autoComplete="off"
        />
      </div>

      <ul className="finder-list" aria-live="polite">
        {(query ? hits : CORPUS).map((c) => (
          <li
            key={c.doc + c.text}
            className={`beam${query ? " is-hit" : " is-dark"}`}
          >
            <p className="beam-text">{highlight(c.text, query)}</p>
            <p className="beam-src latin">
              {c.space} <span aria-hidden="true">/</span> {c.doc}
            </p>
          </li>
        ))}
      </ul>

      {query && hits.length === 0 && (
        <p className="finder-empty">
          <span className="finder-empty-title">
            “{query}”가 들어간 문장이 없습니다.
          </span>
          더 짧은 낱말로 좁혀 보거나, 제목 대신 본문에 쓰였을 표현으로
          찾아보세요.
        </p>
      )}

      <p className="finder-note">
        제목이 아니라 본문을 찾습니다. 위 여섯 문장은 이 페이지를 위해 지어낸
        예시입니다.
      </p>
    </div>
  );
}
