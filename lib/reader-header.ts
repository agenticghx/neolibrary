/**
 * Which reader a note request was sent for (verify-outbox F5). One browser has one sign-in for every tab: if a
 * reader signs out in one tab and another reader signs in, a reader page left open in a second tab would send the
 * first reader's notes with the second reader's sign-in, and the library would refuse them for good ("Book not
 * found."). So the reader page and its outbox name their reader in this header, and the note routes turn away,
 * untouched, a request meant for someone other than the reader signed in (401, which the outbox treats as "keep
 * it and try later"). A request without the header (a page loaded before this, the agent API) is handled as before.
 * Used by the browser and the server alike: it imports nothing.
 */
export const READER_HEADER = "x-neolibrary-reader";

/** True when `req` names a reader other than `userId`. */
export const meantForAnother = (req: Request, userId: string) => {
  const meant = req.headers.get(READER_HEADER);
  return Boolean(meant) && meant !== userId;
};

/** The answer to such a request. */
export const signedInAsAnother = () => Response.json({ error: "Signed in as another reader." }, { status: 401 });
