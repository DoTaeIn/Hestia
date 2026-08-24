"use client";

import { useEffect, useState } from "react";

/**
 * Light by default, dark on request — persisted per the DESIGN.md theme
 * contract. The <html data-theme> attribute is set before paint by the boot
 * script in layout.tsx; this hook reads that as the source of truth and only
 * writes it on an explicit toggle, so it never clobbers the pre-paint value.
 */
export function useTheme() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark");
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    localStorage.setItem("hestia-theme", next ? "dark" : "light");
  }

  return { dark, toggle };
}
