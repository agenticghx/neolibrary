import { headers } from "next/headers";
import { ASSETS, BOOKS, FOCUS_STORAGE_KEY } from "@/lib/offline";
import { OWN_KEY_SIGNED_IN, OWN_KEY_STORAGE } from "@/lib/own-key-names";
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
export async function ClearOfflineAtLoad({ clearAllKeys = false }: { clearAllKeys?: boolean } = {}) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const clearKeysJs = clearAllKeys
    ? `localStorage.removeItem(${JSON.stringify(OWN_KEY_STORAGE.ai)});localStorage.removeItem(${JSON.stringify(OWN_KEY_STORAGE.voice)});localStorage.removeItem(${JSON.stringify(OWN_KEY_SIGNED_IN)});`
    : `if(localStorage.getItem(${JSON.stringify(OWN_KEY_SIGNED_IN)})){localStorage.removeItem(${JSON.stringify(OWN_KEY_STORAGE.ai)});localStorage.removeItem(${JSON.stringify(OWN_KEY_STORAGE.voice)});localStorage.removeItem(${JSON.stringify(OWN_KEY_SIGNED_IN)});}`;
  const code = `try{caches.delete(${JSON.stringify(BOOKS)});caches.delete(${JSON.stringify(ASSETS)})}catch(e){}try{localStorage.removeItem(${JSON.stringify(FOCUS_STORAGE_KEY)});${clearKeysJs}}catch(e){}`;
  return (
    <>
      <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: code }} />
      <ClearOffline clearAllKeys={clearAllKeys} />
    </>
  );
}
