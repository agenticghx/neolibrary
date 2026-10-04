import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { exportLibrary } from "@/lib/library/export";

export const dynamic = "force-dynamic";

/** Downloads the signed-in user's whole library as JSON (ground rule 7). */
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const data = await exportLibrary(await getDb(), user.id);
  const date = data.exportedAt.slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="neolibrary-library-${date}.json"`,
      "cache-control": "no-store",
    },
  });
}
