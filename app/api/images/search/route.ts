import { currentUser } from "@/lib/auth/session";
import { getImageSearch, ImageSearchError } from "@/lib/images/search";

export const dynamic = "force-dynamic";

/** Images for a word or phrase: `?q=silicon wafer` returns { results } (Wikimedia Commons; the fake in tests). */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!q) return Response.json({ results: [] });
  try {
    return Response.json({ results: await getImageSearch().search(q) });
  } catch (e) {
    if (e instanceof ImageSearchError) return Response.json({ error: e.message }, { status: 502 });
    throw e;
  }
}
