"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { signOutAction } from "@/app/(app)/actions";
import styles from "./Shell.module.css";

/**
 * On a phone: a round button with the reader's initial opens the account
 * links and Sign out (on desktop they sit at the foot of the sidebar).
 * Closes on a new page, on Escape (focus goes back to the button), on a tap
 * outside, and when focus leaves it.
 */
export function AccountMenu({ name, admin }: { name: string; admin: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const box = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [shownFor, setShownFor] = useState(pathname);
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);
  return (
    <div
      className={styles.account}
      ref={box}
      onBlur={(e) => {
        // Focus moved to something outside (Tab past the last link). A tap on the panel's text moves focus nowhere.
        if (open && e.relatedTarget && !box.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={toggle}
        type="button"
        className={styles.initial}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Account: ${name}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">{name.trim().charAt(0).toUpperCase() || "?"}</span>
      </button>
      <div id={id} className={styles.accountPanel} hidden={!open}>
        <p className={styles.accountName}>{name}</p>
        <Link href="/stats">Reading stats</Link>
        <Link href="/data">Your data</Link>
        <Link href="/account">Account</Link>
        {admin ? <Link href="/admin/invites">Invite</Link> : null}
        <form action={signOutAction}>
          <button type="submit" className={styles.signOut}>
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
