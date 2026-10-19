"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { focusRedirect } from "@/lib/library/focus-redirect";

/**
 * M26 R4a. The app's layout checks for a running focus session when a page is loaded, but a layout is not run
 * again when a link inside the app is followed (Library to Search, say). So on every change of page, and when the
 * tab comes back into view (a session may have started on another device), this asks the server and, while a
 * session runs, goes to the focused book. Draws nothing.
 */
export function FocusGuard() {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/focus", { cache: "no-store" });
        if (!res.ok) return;
        const { session } = (await res.json()) as { session: { bookId: string; running: boolean } | null };
        const to = focusRedirect(session?.running ? session : null, window.location.pathname);
        if (to && !cancelled) router.replace(to);
      } catch {
        // Offline: the page stays; the server refuses other books' files anyway.
      }
    };
    void check();
    const onShow = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [pathname, router]);
  return null;
}
