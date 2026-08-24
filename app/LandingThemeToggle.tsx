"use client";

import { Moon, Sun } from "./icons";
import { useTheme } from "./useTheme";

export default function LandingThemeToggle() {
  const { dark, toggle } = useTheme();
  const label = dark ? "밝은 화면으로" : "어두운 화면으로";

  return <button type="button" className="landing-theme-toggle" aria-label={label} title={label} onClick={toggle}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button>;
}
