/**
 * Image search (M9, ground rule 3): Wikimedia Commons first (free, no key,
 * every image with its credit and licence), or a fake for tests.
 */
export type ImageResult = {
  /** Stable id from the source, e.g. the Commons file title. */
  id: string;
  title: string;
  /** A thumbnail about 480 px wide, for the result grid and cards. */
  thumbUrl: string;
  /** The full image. */
  imageUrl: string;
  /** Where the image is described (credit and licence in full). */
  pageUrl: string;
  credit: string;
  licence: string;
  licenceUrl: string | null;
  width: number;
  height: number;
  source: "wikimedia" | "fake";
};

export interface ImageSearch {
  readonly source: string;
  search(query: string, limit?: number): Promise<ImageResult[]>;
}

export class ImageSearchError extends Error {}

const USER_AGENT = "Neolibrary/1.0 (private study library; https://github.com/agenticghx/neolibrary)";

/** Plain text from the small bits of HTML Commons puts in credit fields. */
export function textOf(html: string | undefined) {
  return (html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type CommonsPage = {
  pageid: number;
  title: string;
  index?: number;
  imageinfo?: {
    url: string;
    thumburl?: string;
    descriptionurl: string;
    mime: string;
    width: number;
    height: number;
    thumbwidth?: number;
    thumbheight?: number;
    extmetadata?: Record<string, { value?: string } | undefined>;
  }[];
};

/** Wikimedia Commons, through the MediaWiki API (no key needed). */
export class WikimediaSearch implements ImageSearch {
  readonly source = "wikimedia";
  constructor(private fetcher: typeof fetch = fetch) {}

  async search(query: string, limit = 12): Promise<ImageResult[]> {
    const q = query.trim().slice(0, 120);
    if (!q) return [];
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      generator: "search",
      gsrsearch: `${q} filetype:bitmap|drawing`,
      gsrnamespace: "6",
      gsrlimit: String(limit),
      prop: "imageinfo",
      iiprop: "url|size|mime|extmetadata",
      iiurlwidth: "480",
      iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|Credit|ObjectName",
    });
    let res: Response;
    try {
      res = await this.fetcher(`https://commons.wikimedia.org/w/api.php?${params}`, { headers: { "user-agent": USER_AGENT, accept: "application/json" } });
    } catch {
      throw new ImageSearchError("Wikimedia Commons could not be reached.");
    }
    if (!res.ok) throw new ImageSearchError(`Wikimedia Commons could not search (${res.status}).`);
    const data = (await res.json()) as { query?: { pages?: CommonsPage[] } };
    return (data.query?.pages ?? [])
      .filter((p) => p.imageinfo?.[0]?.thumburl && /^image\//.test(p.imageinfo[0].mime))
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((p) => {
        const info = p.imageinfo![0];
        const meta = info.extmetadata ?? {};
        const name = textOf(meta.ObjectName?.value) || p.title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "");
        return {
          id: p.title,
          title: name,
          thumbUrl: info.thumburl!,
          imageUrl: info.url,
          pageUrl: info.descriptionurl,
          credit: textOf(meta.Artist?.value) || textOf(meta.Credit?.value) || "Unknown author",
          licence: textOf(meta.LicenseShortName?.value) || "See the file page",
          licenceUrl: meta.LicenseUrl?.value ?? null,
          width: info.thumbwidth ?? info.width,
          height: info.thumbheight ?? info.height,
          source: "wikimedia" as const,
        };
      });
  }
}

/**
 * The fake used in tests: three made-up results for anything about wafers or
 * silicon, nothing otherwise. Its pictures are small SVGs in public/fake-images.
 */
export class FakeImageSearch implements ImageSearch {
  readonly source = "fake";
  calls: string[] = [];

  async search(query: string): Promise<ImageResult[]> {
    this.calls.push(query);
    if (!/wafer|silicon/i.test(query)) return [];
    return [1, 2, 3].map((n) => ({
      id: `fake:wafer-${n}`,
      title: `Silicon wafer ${n} (test image)`,
      thumbUrl: `/fake-images/wafer-${n}.svg`,
      imageUrl: `/fake-images/wafer-${n}.svg`,
      pageUrl: "https://commons.wikimedia.org/wiki/Category:Silicon_wafers",
      credit: `Test photographer ${n}`,
      licence: n === 2 ? "Public domain" : "CC BY-SA 4.0",
      licenceUrl: n === 2 ? null : "https://creativecommons.org/licenses/by-sa/4.0",
      width: 480,
      height: 320,
      source: "fake" as const,
    }));
  }
}

const g = globalThis as unknown as { __neolibraryFakeImages?: FakeImageSearch };

export function getImageSearch(env: Record<string, string | undefined> = process.env): ImageSearch {
  if (env.AI_FAKE === "1" || env.VITEST) return (g.__neolibraryFakeImages ??= new FakeImageSearch());
  return new WikimediaSearch();
}
