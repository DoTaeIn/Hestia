"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * `showModal()` 로 여는 네이티브 `<dialog>`.
 *
 * Escape 닫기, 포커스 트랩, 뒤 페이지 비활성화, 닫을 때 포커스 복귀 — 손으로 짠
 * 트랩이 늘 하나씩 틀리는 네 가지를 브라우저가 전부 해준다. `role="dialog"` 와
 * `aria-modal="true"` 도 showModal 로 열린 dialog 에는 이미 붙어 있어 적지 않는다.
 */
export default function Modal({
  labelledBy,
  className = "",
  onClose,
  children,
}: {
  labelledBy: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className={`modal${className ? ` ${className}` : ""}`}
      aria-labelledby={labelledBy}
      // Escape 는 dialog 를 혼자 닫아버린다. 그러면 React 상태는 열린 채로 남아
      // 다시 못 연다 — 기본 동작을 막고 상태를 지우는 쪽으로 돌린다.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // 배경(::backdrop) 클릭은 dialog 자신을 target 으로 온다. 내용 클릭과 이걸로 구분된다.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
