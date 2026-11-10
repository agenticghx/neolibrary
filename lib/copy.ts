/**
 * Puts `text` on the clipboard and says whether it worked. The browser can
 * refuse (no permission, a page that is not secure, an old browser), and a
 * button must not say "Copied" then.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
