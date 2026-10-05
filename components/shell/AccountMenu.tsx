"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { signOutAction } from "@/app/(app)/actions";
import styles from "./Shell.module.css";

/**
 * On a phone: a round button with the reader's initial opens the account
 * links and Sign out (on desktop they sit at the foot of the sidebar).
 * Closes on a new page, on Escape and on a tap outside.
 */
export function AccountMenu({ name, admin }: { name: string; admin: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const [shownFor, setShownFor] = useState(pathname);
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);
  return (
    <div className={styles.account} ref={box}>
      <button
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
