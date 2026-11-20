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

/**
 * Copies text fetched on demand while keeping Safari's user-gesture activation
 * alive (ClipboardItem accepts a Promise<Blob> started synchronously inside the click).
 */
export async function copyDeferredText(getText: () => Promise<string>): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false;
    if (typeof ClipboardItem !== "undefined" && typeof navigator.clipboard.write === "function") {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": getText().then((t) => new Blob([t], { type: "text/plain" })),
        }),
      ]);
      return true;
    }
    return await copyText(await getText());
  } catch {
    return false;
  }
}
