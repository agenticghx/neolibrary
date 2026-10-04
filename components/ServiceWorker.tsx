"use client";

import { useEffect } from "react";

/** Registers the service worker (public/sw.js) that lets downloaded books open offline (M12). */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
