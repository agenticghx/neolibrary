"use client";

import { useState } from "react";
import { Icon } from "./icons";
import styles from "./Shell.module.css";
import { SIDEBAR_COOKIE } from "./sidebar-cookie";

/**
 * Hide or show the sidebar (M24, Samuel 2026-10-14: "like in the Claude desktop app"): one button at the
 * top left, in the same place either way. Desktop only; a phone has the tab bar instead.
 */
export function SidebarToggle({ initiallyHidden }: { initiallyHidden: boolean }) {
  const [hidden, setHidden] = useState(initiallyHidden);
  return (
    <button
      type="button"
      className={styles.toggle}
      aria-label={hidden ? "Show sidebar" : "Hide sidebar"}
      aria-expanded={!hidden}
      aria-controls="sidebar"
      onClick={() => {
        const next = !hidden;
        setHidden(next);
        document.querySelector("[data-shell]")?.setAttribute("data-sidebar", next ? "hidden" : "shown");
        document.cookie = `${SIDEBAR_COOKIE}=${next ? "hidden" : "shown"}; path=/; max-age=31536000; samesite=lax`;
      }}
    >
      <Icon name="sidebar" />
    </button>
  );
}
