"use client";

import { useEffect, useRef } from "react";
import { usePlayer } from "./PlayerProvider";
import styles from "./MiniPlayer.module.css";

/**
 * Where the mini-player goes on the app's pages (M14 step 6b): the foot of
 * the main column. It has no box of its own, so a page with nothing playing
 * looks exactly as before; the reader and the sign-in pages have no slot, so
 * the mini-player never shows there.
 */
export function MiniPlayerSlot() {
  const { attachMini } = usePlayer();
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = slot.current;
    if (el) return attachMini(el);
  }, [attachMini]);
  return <div ref={slot} className={styles.slot} />;
}
