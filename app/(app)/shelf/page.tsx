import { redirect } from "next/navigation";

/** The shelf became the library (M14): old links land on /library with the same query. */
export default async function ShelfPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, v);
  }
  const s = query.toString();
  redirect(s ? `/library?${s}` : "/library");
}
