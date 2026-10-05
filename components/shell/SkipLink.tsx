"use client";

import styles from "./Shell.module.css";

/**
 * The first Tab on a page: skip the navigation. The page's wrapper becomes
 * focusable only for this jump (tabindex -1, removed again on blur): if it
 * stayed focusable, Safari would focus it on every click inside the page
 * (Safari does not focus clicked buttons), and code that checks whether
 * focus fell back to the page (document.body) would stop working.
 */
export function SkipLink() {
  return (
    <a
      href="#content"
      className={styles.skip}
      onClick={(e) => {
        const target = document.getElementById("content");
        if (!target) return;
        e.preventDefault();
        target.setAttribute("tabindex", "-1");
        target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
        target.focus();
      }}
    >
      Skip to the page
    </a>
  );
}
