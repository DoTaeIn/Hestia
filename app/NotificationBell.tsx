"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "./icons";
import { describe, fetchNotifications, markRead, type Notification } from "@/lib/notifications";

const when = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}시간 전`;
  return new Date(iso).toLocaleDateString("ko-KR");
};

export default function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [failed, setFailed] = useState(false);
  const unread = items.filter((n) => !n.readAt).length;

  useEffect(() => {
    let live = true;
    fetchNotifications()
      .then((rows) => live && setItems(rows))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  // opening the list is the acknowledgement; the rows stay, the badge clears
  async function onToggle(event: React.SyntheticEvent<HTMLDetailsElement>) {
    if (!event.currentTarget.open || !unread) return;
    const now = new Date().toISOString();
    setItems((rows) => rows.map((n) => (n.readAt ? n : { ...n, readAt: now })));
    try {
      await markRead();
    } catch {
      setFailed(true);
    }
  }

  return (
    <details className="account-menu" onToggle={onToggle}>
      <summary
        className="ctl notify-summary"
        aria-label={unread ? `알림 ${unread}건` : "알림"}
        title={unread ? `읽지 않은 알림 ${unread}건` : "알림"}
      >
        <Bell size={16} />
        {unread > 0 && <span className="notify-count">{unread > 9 ? "9+" : unread}</span>}
      </summary>

      <div className="account-popover notify-popover">
        <p className="account-label">알림</p>

        {failed ? (
          <p className="notify-empty">알림을 불러오지 못했습니다.</p>
        ) : items.length === 0 ? (
          <p className="notify-empty">
            아직 알림이 없습니다. 누군가 회원님의 문서에 댓글을 남기면 여기에 뜹니다.
          </p>
        ) : (
          <ul className="notify-list">
            {items.map((n) => {
              const line = (
                <>
                  <span className="notify-text">{describe(n)}</span>
                  <span className="notify-meta">
                    {n.pageTitle} · {when(n.createdAt)}
                  </span>
                </>
              );
              return (
                <li key={n.id} className={n.readAt ? undefined : "is-unread"}>
                  {n.pageId ? (
                    <Link className="notify-item" href={`/editor/${n.pageId}`}>
                      {line}
                    </Link>
                  ) : (
                    <span className="notify-item is-inert">{line}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </details>
  );
}
