"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { signOutAction } from "@/app/(app)/actions";
import { Icon, type IconName } from "./icons";
import styles from "./Shell.module.css";

type Props = { name: string; email: string; admin: boolean; placement: "sidebar" | "sheet" };

/**
 * The account menu (M18, Samuel's picks of 2026-10-11, borrowed from the Claude app): the reader's email,
 * then Account, Reading stats and Your data, then Invite (admins only), then Sign out on its own.
 * - "sidebar" (desktop, computer A): the initial, the name and an arrow at the foot of the sidebar;
 *   a card opens above them.
 * - "sheet" (phone, phone B): the round initial on Home; a sheet slides up from the bottom of the screen,
 *   over the tabs, and the page behind dims.
 * Closes on a new page, on Escape (focus goes back to the button), on a tap outside (the dimmed page
 * included), and when focus leaves it.
 */
export function AccountMenu({ name, email, admin, placement }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
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
    // Outside is anything but the menu and its button. The dimmed page behind the sheet closes it on its
    // click instead: closed here, the tap's click would land on the link under the finger.
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (target === scrim.current) return;
      if (!panel.current?.contains(target) && !toggle.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const sheet = placement === "sheet";
  const row = (href: string, icon: IconName, label: string) => (
    <Link href={href} className={styles.menuRow}>
      <Icon name={icon} className={styles.menuIcon} />
      {label}
    </Link>
  );
  return (
    <div
      className={sheet ? styles.account : styles.accountFoot}
      ref={box}
      onBlur={(e) => {
        // Focus moved to something outside (Tab past Sign out). A tap on the menu's text moves focus nowhere.
        if (open && e.relatedTarget && !box.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={toggle}
        type="button"
        className={sheet ? styles.initial : styles.who}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Account: ${name}`}
        onClick={() => setOpen((o) => !o)}
      >
        {sheet ? (
          <span aria-hidden="true">{initial}</span>
        ) : (
          <>
            <span className={styles.initialSmall} aria-hidden="true">
              {initial}
            </span>
            <span className={styles.whoName}>{name}</span>
            <Icon name="chevron" className={styles.chevron} />
          </>
        )}
      </button>
      {sheet ? <div ref={scrim} className={styles.scrim} hidden={!open} onClick={() => setOpen(false)} /> : null}
      <div id={id} ref={panel} className={sheet ? styles.sheet : `${styles.popover} glass-card`} hidden={!open}>
        {sheet ? <span className={styles.grab} aria-hidden="true" /> : null}
        <p className={styles.email}>{email}</p>
        {row("/account", "account", "Account")}
        {row("/stats", "stats", "Reading stats")}
        {row("/data", "data", "Your data")}
        {admin ? (
          <>
            <hr className={styles.menuRule} />
            {row("/admin/invites", "invite", "Invite")}
          </>
        ) : null}
        <hr className={styles.menuRule} />
        <form action={signOutAction}>
          <button type="submit" className={styles.menuRow}>
            <Icon name="signOut" className={styles.menuIcon} />
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
