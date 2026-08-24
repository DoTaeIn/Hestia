"use client";

import { useState } from "react";
import { DOC_PATH, DOC_TITLE, VERSIONS } from "./data";

export default function History() {
  // v3 opens first: it is the revision where a sentence is both cut and added,
  // so the section's claim is visible before anyone clicks anything.
  const [no, setNo] = useState(3);
  const v = VERSIONS[no - 1];

  return (
    <div className="hist">
      <ol className="hist-rail" aria-label={`${DOC_TITLE} 수정 이력`}>
        {VERSIONS.map((item) => {
          const on = item.no === no;
          const past = item.no < no;
          return (
            <li key={item.no}>
              <button
                type="button"
                className={`knot${on ? " is-on" : ""}${past ? " is-past" : ""}`}
                aria-current={on ? "true" : undefined}
                onClick={() => setNo(item.no)}
              >
                <span className="knot-dot" aria-hidden="true" />
                <span className="knot-no latin">v{item.no}</span>
                <span className="knot-meta">
                  <span className="knot-when">{item.at}</span>
                  <span className="knot-who">{item.author}</span>
                </span>
                <span className="knot-summary">{item.summary}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="hist-doc">
        <div className="hist-doc-head">
          <p className="crumbs">
            {DOC_PATH.map((c, i) => (
              <span key={c}>
                {i > 0 && <span aria-hidden="true"> / </span>}
                {c}
              </span>
            ))}
          </p>
          <h3 className="hist-title">{DOC_TITLE}</h3>
          <p className="hist-stamp latin">
            v{v.no} · {v.at} · {v.author}
          </p>
        </div>

        <div className="hist-body">
          {v.lines.map((line, i) => (
            <p key={`${v.no}-${i}`} className={`ln ln-${line.state}`}>
              <span className="ln-mark" aria-hidden="true" />
              <span className="ln-text">{line.text}</span>
              {line.state === "cut" && <span className="sr-only"> (이 판에서 삭제됨)</span>}
              {line.state === "added" && <span className="sr-only"> (이 판에서 추가됨)</span>}
            </p>
          ))}
        </div>

        <p className="hist-note">
          삭제된 문장도 판에서 사라지지 않고 <span className="lit">꺼진 빛</span>으로
          남습니다. v5는 v2의 문장을 되살린 판인데, 되돌리기 역시 앞선 판을 덮어쓰지
          않고 <span className="kept">새 판</span>으로 기록됩니다.
        </p>
      </div>
    </div>
  );
}
