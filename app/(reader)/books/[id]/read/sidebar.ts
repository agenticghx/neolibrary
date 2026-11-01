/**
 * The reader's sidebar (Samuel 2026-11-01: "a side toggle sidebar, like the right menu in the Claude desktop app or
 * Obsidian"): the reading tools (Notes, Study, Rewritten view, Bookmark, Focus session) sit in a rail on the right
 * that one button in the top bar shows or hides, so the top bar keeps only Back, Contents, the title, Full screen and
 * Aa. Whether it is open is this viewer's own choice, kept in this browser; a browser that keeps nothing (a private
 * window) still opens and closes it for the visit.
 */
const KEY = "neolibrary:reader-sidebar";
const EVENT = "neolibrary:reader-sidebar";

let memory: boolean | null = null;

export function sidebarOpen(): boolean {
  if (memory !== null) return memory;
  try {
    return localStorage.getItem(KEY) === "open";
  } catch {
    return false;
  }
}

export function setSidebarOpen(open: boolean): void {
  memory = open;
  try {
    localStorage.setItem(KEY, open ? "open" : "closed");
  } catch {
    // Kept for this visit only.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function onSidebarChange(changed: () => void): () => void {
  const fromOtherTab = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    memory = null;
    changed();
  };
  window.addEventListener(EVENT, changed);
  window.addEventListener("storage", fromOtherTab);
  return () => {
    window.removeEventListener(EVENT, changed);
    window.removeEventListener("storage", fromOtherTab);
  };
}
