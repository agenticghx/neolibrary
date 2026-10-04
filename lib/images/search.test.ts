import { describe, expect, it } from "vitest";
import { FakeImageSearch, getImageSearch, ImageSearchError, textOf, WikimediaSearch } from "./search";

// No network: a stand-in for the Commons API answers (ground rule 3).
function commons(body: unknown, status = 200) {
  const urls: { url: string; headers: Headers }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    urls.push({ url: String(url), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetcher, urls };
}

const page = (title: string, index: number, extra: Record<string, unknown> = {}) => ({
  pageid: index,
  title,
  index,
  imageinfo: [
    {
      url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${encodeURIComponent(title.slice(5))}`,
      thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/x/480px-x.jpg`,
      thumbwidth: 480,
      thumbheight: 360,
      descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
      mime: "image/jpeg",
      width: 4000,
      height: 3000,
      extmetadata: {
        LicenseShortName: { value: "CC BY-SA 3.0" },
        LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/3.0" },
        Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Ada">Ada &amp; Co</a>' },
        ObjectName: { value: "Silicon wafer with chips" },
      },
      ...extra,
    },
  ],
});

describe("Wikimedia Commons image search", () => {
  it("asks the MediaWiki API for files with licence and credit, and returns them in search order", async () => {
    const api = commons({ query: { pages: [page("File:Wafer B.jpg", 2), page("File:Wafer A.jpg", 1)] } });
    const results = await new WikimediaSearch(api.fetcher).search("silicon wafer");
    const url = new URL(api.urls[0].url);
    expect(url.origin + url.pathname).toBe("https://commons.wikimedia.org/w/api.php");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      action: "query",
      generator: "search",
      gsrsearch: "silicon wafer filetype:bitmap|drawing",
      gsrnamespace: "6",
      prop: "imageinfo",
      iiprop: "url|size|mime|extmetadata",
      iiurlwidth: "480",
    });
    expect(api.urls[0].headers.get("user-agent")).toMatch(/^Neolibrary\//);
    expect(results.map((r) => r.id)).toEqual(["File:Wafer A.jpg", "File:Wafer B.jpg"]);
    expect(results[0]).toMatchObject({
      title: "Silicon wafer with chips",
      credit: "Ada & Co",
      licence: "CC BY-SA 3.0",
      licenceUrl: "https://creativecommons.org/licenses/by-sa/3.0",
      thumbUrl: expect.stringMatching(/^https:\/\/upload\.wikimedia\.org\//),
      pageUrl: "https://commons.wikimedia.org/wiki/File%3AWafer%20A.jpg",
      width: 480,
      height: 360,
      source: "wikimedia",
    });
  });

  it("skips files that are not images or have no thumbnail, and explains failures", async () => {
    const api = commons({ query: { pages: [page("File:Talk.ogg", 1, { mime: "audio/ogg" }), page("File:Big.tif", 2, { thumburl: undefined })] } });
    expect(await new WikimediaSearch(api.fetcher).search("wafer")).toEqual([]);
    expect(await new WikimediaSearch(commons({}).fetcher).search("wafer")).toEqual([]);
    expect(await new WikimediaSearch(commons({}).fetcher).search("   ")).toEqual([]);
    await expect(new WikimediaSearch(commons({}, 503).fetcher).search("wafer")).rejects.toThrow(ImageSearchError);
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(new WikimediaSearch(down).search("wafer")).rejects.toThrow("could not be reached");
  });

  it("reads plain text out of Commons' bits of HTML", () => {
    expect(textOf('<span class="x">J. Smith</span>, <i>NASA</i> &quot;Apollo&quot;')).toBe('J. Smith , NASA "Apollo"');
    expect(textOf(undefined)).toBe("");
  });

  it("uses the fake in tests, which finds wafers and nothing else", async () => {
    const s = getImageSearch();
    expect(s).toBeInstanceOf(FakeImageSearch);
    expect(getImageSearch({})).toBeInstanceOf(WikimediaSearch);
    expect((await s.search("silicon wafer")).map((r) => r.title)).toEqual([
      "Silicon wafer 1 (test image)",
      "Silicon wafer 2 (test image)",
      "Silicon wafer 3 (test image)",
    ]);
    expect(await s.search("teapot")).toEqual([]);
  });
});
