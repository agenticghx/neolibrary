import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bookPng } from "./fake-png";
import { candidateOfChoice, CoverSourceError, CoverSources, FakeCovers, getCoverSource, GoogleBooksCovers, OpenLibraryCovers } from "./sources";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

/** A stand-in for fetch that answers Open Library from saved answers (fixtures/, recorded 2026-10-11) and records every request. */
function openLibraryFake(over: (url: URL) => Response | undefined = () => undefined) {
  const seen: { url: string; agent: string | null }[] = [];
  const fetcher = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    seen.push({ url: url.toString(), agent: new Headers(init?.headers).get("user-agent") });
    const special = over(url);
    if (special) return special;
    if (url.hostname === "covers.openlibrary.org") return new Response(bookPng(120, 180, [90, 60, 40]).buffer as ArrayBuffer, { headers: { "content-type": "image/jpeg" } });
    if (url.pathname.startsWith("/books/")) return new Response(fixture(`ol-edition-${url.pathname.slice(7, -5)}.json`));
    const title = url.searchParams.get("title");
    const file =
      title === "The Grid"
        ? "ol-search-the-grid.json"
        : title === "Thinking in Systems: A Primer"
          ? "ol-search-thinking-in-systems-full.json"
          : title === "Thinking in Systems"
            ? "ol-search-thinking-in-systems-short.json"
            : title === "Einstein's Clocks, Poincaré's Maps"
              ? "ol-search-einsteins-clocks.json"
              : title === "Seeing Like a State"
                ? "ol-search-seeing-like-a-state.json"
                : title === "Money: The Unauthorized Biography"
                  ? "ol-search-money-full.json"
                  : title === "Money"
                    ? "ol-search-money-short.json"
                    : title === "Ninety Percent of Everything"
                      ? "ol-search-ninety-percent.json"
                      : title === "The World for Sale"
                        ? "ol-search-world-for-sale.json"
                        : "ol-search-the-pay-off.json";
    return new Response(fixture(file));
  }) as typeof fetch;
  return { fetcher, seen };
}

describe("Open Library", () => {
  it("finds The Grid's covers by title and surname, best first, without a lookalike, and says who is asking", async () => {
    const { fetcher, seen } = openLibraryFake();
    const ol = new OpenLibraryCovers(fetcher, 0);
    const found = await ol.find({ title: "The Grid", author: "Bakke" });
    expect(found.map((c) => c.imageUrl)).toEqual([
      "https://covers.openlibrary.org/b/id/12516365-L.jpg?default=false",
      "https://covers.openlibrary.org/b/id/8850661-L.jpg?default=false",
      "https://covers.openlibrary.org/b/id/10646039-L.jpg?default=false",
    ]);
    expect(found[0]).toMatchObject({ source: "openlibrary", title: "The grid", edition: "OL27211014M" });
    expect(found[0].pageUrl).toMatch(/^https:\/\/openlibrary\.org\/works\/OL\d+W$/);
    const search = new URL(seen[0].url);
    expect([search.searchParams.get("title"), search.searchParams.get("author")]).toEqual(["The Grid", "Bakke"]);
    expect(seen[0].agent).toMatch(/^Neolibrary\/1\.0 \(.*github\.com\/agenticghx\/neolibrary\)$/);
    expect(await ol.isbnOf(found[0])).toBe("9781608196104");
    expect(await ol.download(found[0])).toBeInstanceOf(Uint8Array);
  });

  it("tries the title without its subtitle when the full one finds nothing", async () => {
    const { fetcher, seen } = openLibraryFake();
    const found = await new OpenLibraryCovers(fetcher, 0).find({ title: "Thinking in Systems: A Primer", author: "Donella Meadows" });
    expect(seen.map((s) => new URL(s.url).searchParams.get("title"))).toEqual(["Thinking in Systems: A Primer", "Thinking in Systems"]);
    expect(found.map((c) => c.imageUrl)).toEqual(["https://covers.openlibrary.org/b/id/14420637-L.jpg?default=false"]);
  });

  it("keeps only records with a cover, matches an accent the catalogue left out, and finds nothing for a book it lacks", async () => {
    const { fetcher } = openLibraryFake();
    const ol = new OpenLibraryCovers(fetcher, 0);
    expect((await ol.find({ title: "Einstein's Clocks, Poincaré's Maps", author: "Galison" })).length).toBe(2);
    expect(await ol.find({ title: "The Pay Off", author: "Leibbrandt & de Terán" })).toEqual([]);
  });

  it("offers an English edition's cover before the work's own (a translation's), and asks for English editions", async () => {
    const { fetcher, seen } = openLibraryFake();
    const found = await new OpenLibraryCovers(fetcher, 0).find({ title: "Seeing Like a State", author: "James C. Scott" });
    expect(found.map((c) => [c.imageUrl, c.edition])).toEqual([
      ["https://covers.openlibrary.org/b/id/8290759-L.jpg?default=false", "OL9626676M"],
      ["https://covers.openlibrary.org/b/id/12242192-L.jpg?default=false", "OL35399905M"],
    ]);
    expect(new URL(seen[0].url).searchParams.get("lang")).toBe("en");
    expect(new URL(seen[0].url).searchParams.get("fields")).toContain("editions.cover_i");
  });

  it("keeps the work's own cover first when it is an English edition's", async () => {
    const { fetcher } = openLibraryFake((u) => {
      if (u.pathname === "/search.json") {
        return new Response(
          JSON.stringify({
            docs: [{ key: "/works/OL1W", title: "Pinpoint", author_name: ["Greg Milner"], cover_i: 111, cover_edition_key: "OL1M", editions: { docs: [{ key: "/books/OL2M", cover_i: 222, language: ["eng"] }] } }],
          }),
        );
      }
      if (u.pathname === "/books/OL1M.json") return new Response(JSON.stringify({ title: "Pinpoint", languages: [{ key: "/languages/eng" }], isbn_13: ["9780393078671"] }));
      return undefined;
    });
    const ol = new OpenLibraryCovers(fetcher, 0);
    const found = await ol.find({ title: "Pinpoint", author: "Greg Milner" });
    expect(found.map((c) => c.imageUrl.match(/id\/(\d+)/)![1])).toEqual(["111", "222"]);
    expect(await ol.isbnOf(found[0])).toBe("9780393078671");
  });

  it("finds the right author's book, not a first name's, refuses a bundle, and takes a run-on subtitle (cases from the run on the live library)", async () => {
    const { fetcher } = openLibraryFake();
    const ol = new OpenLibraryCovers(fetcher, 0);
    // "Money" by Martin Amis comes first in the answer; Felix Martin's is further down.
    const money = await ol.find({ title: "Money: The Unauthorized Biography", author: "Felix Martin" });
    expect(money.length).toBeGreaterThan(0);
    expect(money.every((c) => c.authors.includes("Felix Martin"))).toBe(true);
    expect(money.map((c) => c.imageUrl.match(/id\/(\d+)/)![1]).sort()).toEqual(["12312457", "8355279"]);
    expect(await ol.find({ title: "The World for Sale", author: "Blas & Farchy" })).toEqual([]);
    expect((await ol.find({ title: "Ninety Percent of Everything", author: "George" })).map((c) => c.imageUrl)).toEqual([
      "https://covers.openlibrary.org/b/id/7856155-L.jpg?default=false",
    ]);
  });

  it("reports a catalogue that refuses or cannot be reached, and a missing picture as none", async () => {
    const busy = openLibraryFake((u) => (u.hostname === "openlibrary.org" ? new Response("", { status: 429 }) : undefined));
    await expect(new OpenLibraryCovers(busy.fetcher, 0).find({ title: "The Grid", author: "Bakke" })).rejects.toThrow(CoverSourceError);
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(new OpenLibraryCovers(down, 0).find({ title: "The Grid", author: "Bakke" })).rejects.toThrow("Open Library could not be reached.");
    const gone = openLibraryFake((u) => (u.hostname === "covers.openlibrary.org" ? new Response("", { status: 404 }) : undefined));
    const ol = new OpenLibraryCovers(gone.fetcher, 0);
    const [first] = await ol.find({ title: "The Grid", author: "Bakke" });
    expect(await ol.download(first)).toBeNull();
  });

  it("waits between requests (one a second unless told otherwise)", async () => {
    const { fetcher } = openLibraryFake();
    const ol = new OpenLibraryCovers(fetcher, 120);
    const t0 = Date.now();
    await ol.find({ title: "Thinking in Systems: A Primer", author: "Meadows" }); // two searches
    expect(Date.now() - t0).toBeGreaterThanOrEqual(110);
  });
});

describe("Google Books", () => {
  it("matches volumes with a picture, on https, with their ISBN, and sends the key", async () => {
    let asked = "";
    const fetcher = (async (input: string | URL) => {
      asked = String(input);
      return new Response(
        JSON.stringify({
          items: [
            { id: "x1", volumeInfo: { title: "The Pay Off", subtitle: "How Changing the Way We Pay Changes Everything", authors: ["Gottfried Leibbrandt", "Natasha de Terán"], imageLinks: { thumbnail: "http://books.google.com/books/content?id=x1&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api" }, industryIdentifiers: [{ type: "ISBN_10", identifier: "1529364566" }, { type: "ISBN_13", identifier: "9781529364569" }], infoLink: "http://books.google.com/books?id=x1" } },
            { id: "x2", volumeInfo: { title: "The Pay Off", authors: ["Someone Else"], imageLinks: { thumbnail: "http://books.google.com/x2" } } },
            { id: "x3", volumeInfo: { title: "The Pay Off", authors: ["Gottfried Leibbrandt"] } },
          ],
        }),
      );
    }) as typeof fetch;
    const found = await new GoogleBooksCovers("KEY", fetcher, 0).find({ title: "The Pay Off", author: "Leibbrandt & de Terán" });
    expect(new URL(asked).searchParams.get("key")).toBe("KEY");
    // Plain words: on 2026-10-11 Google found no book for any search with intitle: or inauthor:.
    expect(new URL(asked).searchParams.get("q")).toBe("The Pay Off Leibbrandt");
    expect(found).toEqual([
      expect.objectContaining({
        source: "googlebooks",
        imageUrl: "https://books.google.com/books/content?id=x1&printsec=frontcover&img=1&zoom=1&source=gbs_api&fife=w400-h600",
        pageUrl: "https://books.google.com/books?id=x1",
        isbn: "9781529364569",
      }),
    ]);
  });

  it("keeps only the right book from a real answer full of other books (recorded 2026-10-11, trimmed to the fields read)", async () => {
    const fetcher = (async () => new Response(fixture("gb-search-undersea-network.json"))) as unknown as typeof fetch;
    const found = await new GoogleBooksCovers("KEY", fetcher, 0).find({ title: "The Undersea Network", author: "Starosielski" });
    expect(found.map((c) => [c.title, c.authors, c.isbn, c.pageUrl])).toEqual([
      ["The Undersea Network", ["Nicole Starosielski"], "9780822376224", "https://books.google.com/books?id=NtGqCAAAQBAJ"],
    ]);
  });

  it("asks again while Google answers 503 (about half its answers on 2026-10-11), and gives up after eight tries", async () => {
    let calls = 0;
    const flaky = (async () => (++calls < 4 ? new Response("", { status: 503 }) : new Response(fixture("gb-search-undersea-network.json")))) as unknown as typeof fetch;
    const found = await new GoogleBooksCovers("KEY", flaky, 0, 0).find({ title: "The Undersea Network", author: "Starosielski" });
    expect([calls, found.length]).toEqual([4, 1]);
    calls = 0;
    const down = (async () => (calls++, new Response("", { status: 503 }))) as unknown as typeof fetch;
    await expect(new GoogleBooksCovers("KEY", down, 0, 0).find({ title: "The Undersea Network", author: "Starosielski" })).rejects.toThrow("Google Books could not search (503).");
    expect(calls).toBe(8);
    calls = 0;
    const refused = (async () => (calls++, new Response("", { status: 403 }))) as unknown as typeof fetch;
    await expect(new GoogleBooksCovers("KEY", refused, 0, 0).find({ title: "The Undersea Network", author: "Starosielski" })).rejects.toThrow(CoverSourceError);
    expect(calls).toBe(1);
  });
});

describe("choosing the catalogues", () => {
  it("is the fake in tests; Open Library alone without a Google key; Open Library then Google with one", () => {
    expect(getCoverSource({ VITEST: "true" })).toBeInstanceOf(FakeCovers);
    expect(getCoverSource({ AI_FAKE: "1" })).toBeInstanceOf(FakeCovers);
    expect(getCoverSource({}).name).toBe("openlibrary");
    expect(getCoverSource({ GOOGLE_BOOKS_API_KEY: " k " }).name).toBe("openlibrary+googlebooks");
    expect(new CoverSources([]).name).toBe("");
  });

  it("keeps one catalogue's matches when another cannot be reached; with no match from any, says it could not ask", async () => {
    const down = { name: "googlebooks", find: async () => Promise.reject(new CoverSourceError("Google Books could not search (503).")), search: async () => [], download: async () => null, isbnOf: async () => null };
    const both = new CoverSources([new FakeCovers(), down]);
    expect((await both.find({ title: "The Grid", author: "Bakke" })).length).toBe(2);
    await expect(both.find({ title: "Oil 101", author: "Downey" })).rejects.toThrow("Google Books could not search (503).");
    const broken = { ...down, find: async () => Promise.reject(new TypeError("a bug")) };
    await expect(new CoverSources([new FakeCovers(), broken]).find({ title: "The Grid", author: "Bakke" })).rejects.toThrow("a bug");
  });

  it("the fake offers two covers a title, none for Oil 101", async () => {
    const fake = new FakeCovers();
    expect((await fake.find({ title: "The Grid", author: "Bakke" })).length).toBe(2);
    expect(await fake.find({ title: "Oil 101", author: "Downey" })).toEqual([]);
  });
});

/** A stand-in for fetch for a reader's own search: the saved answer for the search, a small cover for any picture. */
function searchFake(answer: string, seen: string[] = []) {
  return (async (input: string | URL) => {
    const url = String(input);
    seen.push(url);
    if (url.includes("/search.json") || url.includes("/books/v1/volumes")) return new Response(fixture(answer));
    return new Response(bookPng(120, 180, [90, 60, 40]).buffer as ArrayBuffer, { headers: { "content-type": "image/png" } });
  }) as unknown as typeof fetch;
}

describe("a reader's own search (C3a, Choose a cover)", () => {
  it("Open Library: every record with a cover for the words typed, whatever its title, with a preview and a code (real answer for Liftoff Berger)", async () => {
    const seen: string[] = [];
    const choices = await new OpenLibraryCovers(searchFake("ol-q-liftoff-berger.json", seen), 0).search("Liftoff Berger");
    expect(choices.map(({ preview, ...c }) => ({ ...c, preview: preview?.byteLength ? "a picture" : null }))).toEqual([
      { choice: "ol:11033056:OL21893953W:OL32375357M", source: "openlibrary", title: "Liftoff", authors: ["Eric Berger"], year: "2021", preview: "a picture" },
    ]);
    const search = new URL(seen[0]);
    expect([search.searchParams.get("q"), search.searchParams.get("limit")]).toEqual(["Liftoff Berger", "8"]);
    expect(seen[1]).toBe("https://covers.openlibrary.org/b/id/11033056-M.jpg?default=false");
  });

  it("Google Books: every volume with a picture, its year, the thumbnail as the preview, and three tries at most (real answer, trimmed)", async () => {
    const seen: string[] = [];
    const choices = await new GoogleBooksCovers("KEY", searchFake("gb-q-liftoff-berger.json", seen), 0, 0).search("Liftoff Berger");
    expect(choices).toHaveLength(10);
    expect(choices[0]).toMatchObject({ choice: "gb:TDyDzQEACAAJ", source: "googlebooks", title: "Liftoff", authors: ["Eric Berger"], year: "2021" });
    expect(choices[6]).toMatchObject({ title: "L'express", authors: [], year: "2021" });
    expect(new URL(seen[0]).searchParams.get("maxResults")).toBe("8");
    expect(seen).toContain("https://books.google.com/books/content?id=TDyDzQEACAAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api");
    let calls = 0;
    const down = (async () => (calls++, new Response("", { status: 503 }))) as unknown as typeof fetch;
    await expect(new GoogleBooksCovers("KEY", down, 0, 0).search("Liftoff Berger")).rejects.toThrow("Google Books could not search (503).");
    expect(calls).toBe(3);
  });

  it("a chosen code stands for one catalogue picture, its addresses rebuilt from ids; anything else is refused", () => {
    expect(candidateOfChoice("ol:11033056:OL21893953W:OL32375357M")).toMatchObject({
      source: "openlibrary",
      // The same address find() gives the picture, so a picture turned down stays turned down.
      imageUrl: "https://covers.openlibrary.org/b/id/11033056-L.jpg?default=false",
      pageUrl: "https://openlibrary.org/works/OL21893953W",
      edition: "OL32375357M",
    });
    expect(candidateOfChoice("ol:11033056:OL21893953W:")).toMatchObject({ source: "openlibrary", edition: undefined });
    expect(candidateOfChoice("gb:TDyDzQEACAAJ")).toMatchObject({
      source: "googlebooks",
      imageUrl: "https://books.google.com/books/content?id=TDyDzQEACAAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api&fife=w400-h600",
      pageUrl: "https://books.google.com/books?id=TDyDzQEACAAJ",
    });
    expect(candidateOfChoice("fake:oil-101-downey:2")).toMatchObject({ source: "fake", imageUrl: "https://covers.example.org/fake/oil-101-downey/2.png" });
    for (const bad of ["", "ol:11033056", "ol:x:OL1W:", "ol:1:OL1W:OL2M:extra", "gb:https://evil.example/x.png", "gb:../../etc", "gb:abc", "fake:../x:1", "fake:a:4", "https://covers.openlibrary.org/b/id/1-L.jpg"]) {
      expect(candidateOfChoice(bad), bad).toBeNull();
    }
  });

  it("asks every catalogue at once and shows those that answered, saying which could not be asked; a program error is passed on", async () => {
    const down = { name: "googlebooks", find: async () => [], search: async () => Promise.reject(new CoverSourceError("Google Books could not search (503).")), download: async () => null, isbnOf: async () => null };
    const both = new CoverSources([new FakeCovers(), down]);
    const r = await both.searchEach("Liftoff Berger");
    expect([r.choices.map((c) => c.choice), r.unreachable]).toEqual([["fake:liftoff-berger:1", "fake:liftoff-berger:2", "fake:liftoff-berger:3"], ["Google Books could not search (503)."]]);
    await expect(new CoverSources([down]).search("Liftoff")).rejects.toThrow("Google Books could not search (503).");
    const broken = { ...down, search: async () => Promise.reject(new TypeError("a bug")) };
    await expect(new CoverSources([new FakeCovers(), broken]).searchEach("Liftoff")).rejects.toThrow("a bug");
  });
});
