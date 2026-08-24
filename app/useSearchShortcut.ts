"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Ctrl/Cmd+K jumps to search from anywhere in the app — the shortcut people
 * already expect from every other tool. Nothing in the editor binds it
 * (StarterKit ships no link extension), so it is free to take.
 */
export function useSearchShortcut() {
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      router.push("/search");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
}
