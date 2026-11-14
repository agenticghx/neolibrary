import { headers } from "next/headers";
import { ASSETS, BOOKS } from "@/lib/offline";
import { ClearOffline } from "./ClearOffline";

/**
 * On pages shown to someone not signed in: books downloaded for offline leave the device as the page loads.
 *
 * A small script written into the page runs as soon as the browser reads it, before the app's own scripts and the
 * page's pictures have arrived. Before, the downloads were removed only once the app's scripts had loaded and run; on
 * a slow connection, or with the open shelf's 129 covers sharing the connections, that took more than five seconds
 * (version 2 line 3; e2e/offline.spec.ts). The page's security policy runs only scripts carrying its nonce (proxy.ts).
 * ClearOffline stays for a move between pages inside the app, where a script written into the page does not run.
 */
export async function ClearOfflineAtLoad() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const code = `try{caches.delete(${JSON.stringify(BOOKS)});caches.delete(${JSON.stringify(ASSETS)})}catch(e){}`;
  return (
    <>
      <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: code }} />
      <ClearOffline />
    </>
  );
}
