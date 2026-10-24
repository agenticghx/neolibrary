import { CommandPalette } from "@/components/palette/CommandPalette";
import { MiniPlayerSlot } from "@/components/player/MiniPlayerSlot";
import { Sidebar } from "@/components/shell/Sidebar";
import { SIDEBAR_COOKIE } from "@/components/shell/sidebar-cookie";
import { SidebarToggle } from "@/components/shell/SidebarToggle";
import { SkipLink } from "@/components/shell/SkipLink";
import { TabBar } from "@/components/shell/TabBar";
import styles from "@/components/shell/Shell.module.css";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { BookFocusBanner } from "@/components/shell/BookFocusBanner";
import { FocusGuard } from "@/components/shell/FocusGuard";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { focusRedirect, redirectInfo, runningFocus } from "@/lib/library/focus-lock";
import { getBook } from "@/lib/library/paths";
import { listPathsWithProgress } from "@/lib/library/paths";
import { listCollections } from "@/lib/library/shelf";

// Everything under (app) needs a signed-in user, checked against the database.
// The shell (M14): a sidebar on desktop; on a phone, five tabs at the bottom,
// and the account menu on Home only (Samuel's choice B, 2026-10-06): every
// other page starts with its own title.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const db = await getDb();
  // M26 R4a: while a focus session runs, every page here but Account sends the reader to the focused book. This
  // runs when a page is loaded; FocusGuard does the same when a link inside the app is followed. M26 R5: a
  // whole-book focus sends only the pages that list other books, and other books, to the focused book's page.
  const running = await runningFocus(db, user.id);
  const info = await redirectInfo(db, user.id, running);
  const to = focusRedirect(info, (await headers()).get("x-pathname") ?? "/");
  if (to) redirect(to);
  const focusBook = running?.kind === "book" && info?.homeId ? await getBook(db, user.id, info.homeId) : null;
  const [paths, collections] = await Promise.all([listPathsWithProgress(db, user.id), listCollections(db, user.id)]);
  // Hidden with the button at the sidebar's top (M24); remembered on this device.
  const sidebarHidden = (await cookies()).get(SIDEBAR_COOKIE)?.value === "hidden";
  return (
    <div className={styles.shell} data-shell data-sidebar={sidebarHidden ? "hidden" : "shown"}>
      <SkipLink />
      <SidebarToggle initiallyHidden={sidebarHidden} />
      <Sidebar user={user} paths={paths} collections={collections} />
      <div className={styles.column}>
        <div id="content" className={styles.content}>
          {running && focusBook ? (
            <BookFocusBanner bookId={running.bookId} homeId={focusBook.book.id} title={focusBook.book.title} endsAt={running.endsAt.toISOString()} />
          ) : null}
          {children}
        </div>
        {/* The mini-player, while a book is read aloud (M14 step 6b): after the page, before the tabs. */}
        <MiniPlayerSlot />
      </div>
      <TabBar />
      {/* Cmd+K or Ctrl+K: jump to a book, a Path, a page or a note (M21). */}
      <CommandPalette admin={user.role === "admin"} />
      <FocusGuard />
    </div>
  );
}
