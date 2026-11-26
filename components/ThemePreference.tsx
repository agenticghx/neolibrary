"use client";

import { useEffect, useSyncExternalStore } from "react";

export type AppTheme = "auto" | "light" | "dark";
const KEY = "nl.appTheme";

let chosen: AppTheme | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readTheme(): AppTheme {
  if (chosen) return chosen;
  try {
    const raw = localStorage.getItem(KEY);
    return raw === "light" || raw === "dark" ? raw : "auto";
  } catch {
    return "auto";
  }
}

function applyTheme(theme: AppTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("theme-paper", theme === "light");
  root.classList.toggle("theme-night", theme === "dark");
}

export function setAppTheme(theme: AppTheme) {
  chosen = theme;
  try {
    if (theme === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Storage blocked: the choice still applies for this session.
  }
  applyTheme(theme);
  listeners.forEach((l) => l());
}

/** Keeps the saved app-wide theme (Auto / Light / Dark) applied on <html> across pages. */
export function ThemeSync() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "auto" as AppTheme);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  return null;
}

const OPTIONS: [AppTheme, string][] = [
  ["auto", "Auto"],
  ["light", "Light"],
  ["dark", "Dark"],
];

/** Segmented Auto / Light / Dark switch for the Account page (independent of the Reader's 7 paper themes). */
export function ThemePicker({
  choiceClass,
  legendClass,
  segmentClass,
  buttonClass,
  hintClass,
}: {
  choiceClass: string;
  legendClass: string;
  segmentClass: string;
  buttonClass: string;
  hintClass: string;
}) {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "auto" as AppTheme);
  return (
    <fieldset className={choiceClass}>
      <legend className={legendClass}>Appearance</legend>
      <div className={segmentClass}>
        {OPTIONS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={buttonClass}
            aria-pressed={theme === value}
            onClick={() => setAppTheme(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className={hintClass}>Auto follows your device setting. The reader keeps its own paper themes under Aa.</p>
    </fieldset>
  );
}
