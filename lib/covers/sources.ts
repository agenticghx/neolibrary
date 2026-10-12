import { bookPng } from "./fake-png";
import { isMatch, normalize, shortTitle, surnameOf } from "./match";

/**
 * Where covers come from (M22, ground rule 3: an interface with a fake).
 * Open Library first (free, no key); Google Books after it when
 * GOOGLE_BOOKS_API_KEY is set (without a key Google refuses most lookups);
 * the fake in tests. Each picture is downloaded once and stored in the
 * bucket, so the catalogues are not asked again each time a page shows it.
 */

export type CoverSourceName = "openlibrary" | "googlebooks" | "fake";

export type CoverCandidate = {
  source: CoverSourceName;
  /** Where the picture is downloaded from; it also says which picture it is (stored as cover_ref). */
  imageUrl: string;
  /** The catalogue's page for the record (credit; stored as cover_page). */
  pageUrl: string;
  title: string;
  authors: string[];
  /** The edition's ISBN when the search gave it (Google Books); Open Library's comes from isbnOf. */
  isbn: string | null;
  /** Open Library: the edition the cover belongs to (its ISBN is looked up only for the cover chosen). */
  edition?: string;
};

/**
 * A result of the reader's own search (C3a, "Choose a cover"): a record with a picture, whatever its title and
 * author (the reader judges by eye), and a small preview of the picture.
 */
export type CoverChoice = {
  /** Which picture, as a short code ("ol:<cover id>:<work>:<edition>", "gb:<volume id>"): see candidateOfChoice. */
  choice: string;
  source: CoverSourceName;
  title: string;
  authors: string[];
  year: string | null;
  /** A medium-sized picture, fetched here (the site shows no pictures from other sites); null when it could not be had. */
  preview: Uint8Array | null;
};

export interface CoverSource {
  readonly name: string;
  /** Records that match the title and author, with a cover, best first. */
  find(wanted: { title: string; author: string }): Promise<CoverCandidate[]>;
  /** Records with a cover for the words the reader typed, as the catalogue ranks them, with previews. */
  search(words: string): Promise<CoverChoice[]>;
  /** The picture's bytes; null when the catalogue has none after all. */
  download(candidate: CoverCandidate): Promise<Uint8Array | null>;
  /** The ISBN of the edition the picture belongs to, if the catalogue knows it. */
  isbnOf(candidate: CoverCandidate): Promise<string | null>;
}

/** A catalogue could not be reached or refused (for example too many requests): the title is asked again later. */
export class CoverSourceError extends Error {}

/** How many results a reader's search shows from each catalogue. */
const SEARCH_LIMIT = 8;

const OL_CHOICE = /^ol:(\d{1,12}):(OL\d{1,12}W):(OL\d{1,12}M)?$/;
const GB_CHOICE = /^gb:([A-Za-z0-9_-]{6,20})$/;
const FAKE_CHOICE = /^fake:([a-z0-9-]{1,60}):([1-3])$/;

const openLibraryImage = (coverId: number | string) => `https://covers.openlibrary.org/b/id/${coverId}-L.jpg?default=false`;
// The thumbnail's own address (find() gets the same from the search answer), 400 wide: see GoogleBooksCovers.find.
const googleImage = (id: string) => `https://books.google.com/books/content?id=${id}&printsec=frontcover&img=1&zoom=1&source=gbs_api&fife=w400-h600`;
const fakeImage = (slug: string, n: number | string) => `https://covers.example.org/fake/${slug}/${n}.png`;

/**
 * The picture a reader's chosen code stands for, with the catalogue's addresses rebuilt here from ids: the browser
 * never sends an address for the server to fetch. Null for anything else.
 */
export function candidateOfChoice(choice: string): CoverCandidate | null {
  const base = { title: "", authors: [], isbn: null };
  const ol = OL_CHOICE.exec(choice);
  if (ol) return { ...base, source: "openlibrary", imageUrl: openLibraryImage(ol[1]), pageUrl: `https://openlibrary.org/works/${ol[2]}`, edition: ol[3] };
  const gb = GB_CHOICE.exec(choice);
  if (gb) return { ...base, source: "googlebooks", imageUrl: googleImage(gb[1]), pageUrl: `https://books.google.com/books?id=${gb[1]}` };
  const fake = FAKE_CHOICE.exec(choice);
  if (fake) return { ...base, source: "fake", imageUrl: fakeImage(fake[1], fake[2]), pageUrl: `https://catalogue.example.org/fake/${fake[1]}` };
  return null;
}

// Open Library asks applications to say who they are (name and a way to reach them): https://openlibrary.org/developers/api
const USER_AGENT = "Neolibrary/1.0 (private study library; https://github.com/agenticghx/neolibrary)";

/** One request at a time, at least `gapMs` apart: Open Library allows 1 a second from an application it cannot identify, 3 from one it can. */
class Pacer {
  private last = 0;
  constructor(private gapMs: number) {}
  async wait() {
    const left = this.last + this.gapMs - Date.now();
    if (left > 0) await new Promise((r) => setTimeout(r, left));
    this.last = Date.now();
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length"));
  if (declared > maxBytes) return null;
  const data = new Uint8Array(await res.arrayBuffer());
  return data.byteLength > maxBytes ? null : data;
}

/**
 * A search result's preview, all of them at once: picture addresses are not the catalogues' rate-limited searches
 * (Open Library: https://openlibrary.org/dev/docs/api/covers). A preview that cannot be had is null.
 */
async function preview(fetcher: typeof fetch, url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetcher(url, { headers: { "user-agent": USER_AGENT }, redirect: "follow" });
    return res.ok ? await readCapped(res, 512 * 1024) : null;
  } catch {
    return null;
  }
}

type OpenLibraryEdition = { key?: string; cover_i?: number; language?: string[] };
type OpenLibraryDoc = {
  key?: string;
  title?: string;
  author_name?: string[];
  cover_i?: number;
  cover_edition_key?: string;
  first_publish_year?: number;
  /** With lang=en, the best English edition of the work (its own cover; the work's may be a translation's). */
  editions?: { docs?: OpenLibraryEdition[] };
};

/**
 * Open Library (the Internet Archive's catalogue): search by title and the author's surname, then the cover by its
 * id (lookups by cover id are not rate limited; https://openlibrary.org/dev/docs/api/covers). `default=false`
 * makes a missing picture a 404 instead of a blank image.
 */
export class OpenLibraryCovers implements CoverSource {
  readonly name = "openlibrary";
  private pacer: Pacer;
  /** Edition records already fetched (title, languages, ISBN): the language check and the ISBN share one request. */
  private editions = new Map<string, { title: string; langs: string[]; isbn: string | null } | null>();
  constructor(
    private fetcher: typeof fetch = fetch,
    gapMs = 1000,
  ) {
    this.pacer = new Pacer(gapMs);
  }

  private async get(url: string) {
    await this.pacer.wait();
    try {
      return await this.fetcher(url, { headers: { "user-agent": USER_AGENT, accept: "application/json, image/*" }, redirect: "follow" });
    } catch {
      throw new CoverSourceError("Open Library could not be reached.");
    }
  }

  private async searchTitle(title: string, surname: string): Promise<OpenLibraryDoc[]> {
    const params = new URLSearchParams({
      title,
      fields: "key,title,author_name,cover_i,cover_edition_key,editions,editions.key,editions.cover_i,editions.language",
      lang: "en",
      limit: "10",
    });
    if (surname) params.set("author", surname);
    const res = await this.get(`https://openlibrary.org/search.json?${params}`);
    if (!res.ok) throw new CoverSourceError(`Open Library could not search (${res.status}).`);
    return ((await res.json()) as { docs?: OpenLibraryDoc[] }).docs ?? [];
  }

  async find(wanted: { title: string; author: string }): Promise<CoverCandidate[]> {
    const surname = surnameOf(wanted.author);
    const titles = [wanted.title.trim(), shortTitle(wanted.title)].filter((t, i, all) => t && all.indexOf(t) === i);
    const out: CoverCandidate[] = [];
    for (const title of titles) {
      for (const d of await this.searchTitle(title, surname)) {
        if (!d.title || !isMatch(wanted, { title: d.title, authors: d.author_name ?? [] })) continue;
        // The work's own cover, unless it belongs to a translation (Seeing Like a State's is Turkish): then the best
        // English edition's first. The other one stays as the next choice for "Not this cover".
        const englishEd = d.editions?.docs?.find((e) => e.cover_i && e.language?.includes("eng"));
        const work = d.cover_i ? { id: d.cover_i, edition: d.cover_edition_key } : null;
        const english = englishEd ? { id: englishEd.cover_i!, edition: englishEd.key?.replace(/^\/books\//, "") } : null;
        const covers =
          work && english && work.id !== english.id
            ? out.length === 0 && !(await this.workCoverIsEnglish(wanted, d))
              ? [english, work]
              : [work, english]
            : [work ?? english].filter((c) => c !== null);
        for (const cover of covers) {
          const imageUrl = openLibraryImage(cover.id);
          if (out.some((c) => c.imageUrl === imageUrl)) continue;
          out.push({
            source: "openlibrary",
            imageUrl,
            pageUrl: d.key ? `https://openlibrary.org${d.key}` : `https://openlibrary.org/search?q=${encodeURIComponent(wanted.title)}`,
            title: d.title,
            authors: d.author_name ?? [],
            isbn: null,
            edition: cover.edition,
          });
        }
      }
      // The full title found the book: the short one would only add other books with the same first words.
      if (out.length) break;
    }
    return out;
  }

  async search(words: string): Promise<CoverChoice[]> {
    const params = new URLSearchParams({ q: words, fields: "key,title,author_name,cover_i,cover_edition_key,first_publish_year", limit: String(SEARCH_LIMIT) });
    const res = await this.get(`https://openlibrary.org/search.json?${params}`);
    if (!res.ok) throw new CoverSourceError(`Open Library could not search (${res.status}).`);
    const docs = ((await res.json()) as { docs?: OpenLibraryDoc[] }).docs ?? [];
    const work = (d: OpenLibraryDoc) => /^\/works\/(OL\d{1,12}W)$/.exec(d.key ?? "")?.[1];
    const edition = (d: OpenLibraryDoc) => (/^OL\d{1,12}M$/.test(d.cover_edition_key ?? "") ? d.cover_edition_key : "");
    return Promise.all(
      docs
        .filter((d) => d.title && d.cover_i && Number.isSafeInteger(d.cover_i) && work(d))
        .map(async (d) => ({
          choice: `ol:${d.cover_i}:${work(d)}:${edition(d)}`,
          source: "openlibrary" as const,
          title: d.title!,
          authors: d.author_name ?? [],
          year: d.first_publish_year ? String(d.first_publish_year) : null,
          preview: await preview(this.fetcher, `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg?default=false`),
        })),
    );
  }

  async download(c: CoverCandidate): Promise<Uint8Array | null> {
    const res = await this.get(c.imageUrl);
    if (res.status === 404) return null;
    if (!res.ok) throw new CoverSourceError(`Open Library could not send the cover (${res.status}).`);
    return readCapped(res, 3 * 1024 * 1024);
  }

  /** An edition's title, languages and ISBN; null when it cannot be had (the cover stands without them). */
  private async edition(key: string | undefined) {
    if (!key || !/^OL\d+M$/.test(key)) return null;
    if (this.editions.has(key)) return this.editions.get(key)!;
    let info: { title: string; langs: string[]; isbn: string | null } | null = null;
    try {
      const res = await this.get(`https://openlibrary.org/books/${key}.json`);
      if (res.ok) {
        const e = (await res.json()) as { title?: string; languages?: { key?: string }[]; isbn_13?: string[]; isbn_10?: string[] };
        info = {
          title: e.title ?? "",
          langs: (e.languages ?? []).map((l) => (l.key ?? "").replace(/^\/languages\//, "")).filter(Boolean),
          isbn: e.isbn_13?.[0] ?? e.isbn_10?.[0] ?? null,
        };
      }
    } catch {
      info = null;
    }
    this.editions.set(key, info);
    return info;
  }

  /**
   * Whether the work's cover belongs to an English edition: its record says English, or says no language and has the
   * wanted title (a translation's title differs: "Devlet Gibi Görmek"). With no edition named, an English edition's
   * cover is the safer first choice; when the record cannot be had, the work's own stays first.
   */
  private async workCoverIsEnglish(wanted: { title: string; author: string }, d: OpenLibraryDoc) {
    if (!d.cover_edition_key) return false;
    const e = await this.edition(d.cover_edition_key);
    if (!e) return true;
    if (e.langs.length) return e.langs.includes("eng");
    return isMatch(wanted, { title: e.title, authors: d.author_name ?? [] });
  }

  async isbnOf(c: CoverCandidate): Promise<string | null> {
    return (await this.edition(c.edition))?.isbn ?? null; // the ISBN is a bonus; the cover stands without it
  }
}

type GoogleVolume = {
  id: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    industryIdentifiers?: { type: string; identifier: string }[];
    publishedDate?: string;
  };
};

/** Google Books answers "503 backendFailed" to about half of all requests (measured 2026-10-11); a try again gets through. */
const GOOGLE_TRIES = 8;
/** Fewer for a reader's own search: they are waiting, and Open Library's results show meanwhile. */
const GOOGLE_SEARCH_TRIES = 3;

/**
 * Google Books (needs GOOGLE_BOOKS_API_KEY; without one it answers "too many requests" to most lookups). Searched
 * with plain words, title then surname: on 2026-10-11 any search with `intitle:` or `inauthor:` found no book at
 * all, and a quoted title missed some that plain words found; isMatch keeps only the right title and author.
 */
export class GoogleBooksCovers implements CoverSource {
  readonly name = "googlebooks";
  private pacer: Pacer;
  constructor(
    private key: string,
    private fetcher: typeof fetch = fetch,
    gapMs = 500,
    private retryMs = 1500,
  ) {
    this.pacer = new Pacer(gapMs);
  }

  private async get(url: string, most = GOOGLE_TRIES) {
    for (let tries = 1; ; tries++) {
      await this.pacer.wait();
      let res: Response;
      try {
        res = await this.fetcher(url, { headers: { "user-agent": USER_AGENT } });
      } catch {
        throw new CoverSourceError("Google Books could not be reached.");
      }
      if (res.status < 500 || tries >= most) return res;
      await new Promise((r) => setTimeout(r, this.retryMs));
    }
  }

  async find(wanted: { title: string; author: string }): Promise<CoverCandidate[]> {
    const surname = surnameOf(wanted.author);
    const q = `${shortTitle(wanted.title).replace(/"/g, "")}${surname ? ` ${surname}` : ""}`;
    const params = new URLSearchParams({ q, maxResults: "10", printType: "books", key: this.key });
    const res = await this.get(`https://www.googleapis.com/books/v1/volumes?${params}`);
    if (!res.ok) throw new CoverSourceError(`Google Books could not search (${res.status}).`);
    const items = ((await res.json()) as { items?: GoogleVolume[] }).items ?? [];
    const out: CoverCandidate[] = [];
    for (const v of items) {
      const info = v.volumeInfo ?? {};
      const thumb = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail;
      if (!thumb || !info.title || !isMatch(wanted, { title: info.title, authors: info.authors ?? [] })) continue;
      // fife asks for the same picture 400 wide (the thumbnail is 128); zoom=0, 2 or 3 sometimes send a different
      // picture instead (an inside page, or "image not available").
      const imageUrl = `${thumb.replace(/^http:/, "https:").replace(/&edge=curl/, "")}&fife=w400-h600`;
      if (out.some((c) => c.imageUrl === imageUrl)) continue;
      const ids = info.industryIdentifiers ?? [];
      out.push({
        source: "googlebooks",
        imageUrl,
        // The record's page at Google Books (its canonicalVolumeLink is a Google Play store page).
        pageUrl: `https://books.google.com/books?id=${encodeURIComponent(v.id)}`,
        title: info.title,
        authors: info.authors ?? [],
        isbn: ids.find((i) => i.type === "ISBN_13")?.identifier ?? ids.find((i) => i.type === "ISBN_10")?.identifier ?? null,
      });
    }
    return out;
  }

  async search(words: string): Promise<CoverChoice[]> {
    const params = new URLSearchParams({ q: words, maxResults: String(SEARCH_LIMIT), printType: "books", key: this.key });
    const res = await this.get(`https://www.googleapis.com/books/v1/volumes?${params}`, GOOGLE_SEARCH_TRIES);
    if (!res.ok) throw new CoverSourceError(`Google Books could not search (${res.status}).`);
    const items = ((await res.json()) as { items?: GoogleVolume[] }).items ?? [];
    return Promise.all(
      items
        .filter((v) => GB_CHOICE.test(`gb:${v.id}`) && v.volumeInfo?.title && (v.volumeInfo.imageLinks?.thumbnail ?? v.volumeInfo.imageLinks?.smallThumbnail))
        .map(async (v) => ({
          choice: `gb:${v.id}`,
          source: "googlebooks" as const,
          title: v.volumeInfo!.title!,
          authors: v.volumeInfo!.authors ?? [],
          year: /^\d{4}/.exec(v.volumeInfo!.publishedDate ?? "")?.[0] ?? null,
          // The thumbnail as it is (128 wide): enough to judge by, and quick.
          preview: await preview(this.fetcher, googleImage(v.id).replace(/&fife=[^&]*$/, "")),
        })),
    );
  }

  async download(c: CoverCandidate): Promise<Uint8Array | null> {
    const res = await this.get(c.imageUrl);
    if (res.status === 404) return null;
    if (!res.ok) throw new CoverSourceError(`Google Books could not send the cover (${res.status}).`);
    return readCapped(res, 3 * 1024 * 1024);
  }

  async isbnOf(c: CoverCandidate) {
    return c.isbn;
  }
}

/**
 * Several catalogues in order: all of the first's matches, then the next's. One that cannot be reached does not
 * lose the others' matches; with no match from any, its error is passed on, so the title is asked again later.
 */
export class CoverSources implements CoverSource {
  readonly name: string;
  constructor(private list: CoverSource[]) {
    this.name = list.map((s) => s.name).join("+");
  }
  private of(c: CoverCandidate) {
    const s = this.list.find((x) => x.name === c.source);
    if (!s) throw new CoverSourceError(`No catalogue named ${c.source}.`);
    return s;
  }
  async find(wanted: { title: string; author: string }) {
    const out: CoverCandidate[] = [];
    let unreachable: CoverSourceError | null = null;
    for (const s of this.list) {
      try {
        out.push(...(await s.find(wanted)));
      } catch (e) {
        if (!(e instanceof CoverSourceError)) throw e;
        unreachable ??= e;
      }
    }
    if (!out.length && unreachable) throw unreachable;
    return out;
  }
  /**
   * A reader's search, every catalogue at once (they are waiting): the results of those that answered, and what the
   * others said. A program error is passed on.
   */
  async searchEach(words: string): Promise<{ choices: CoverChoice[]; unreachable: string[] }> {
    const settled = await Promise.allSettled(this.list.map((s) => s.search(words)));
    const choices: CoverChoice[] = [];
    const unreachable: string[] = [];
    for (const r of settled) {
      if (r.status === "fulfilled") choices.push(...r.value);
      else if (r.reason instanceof CoverSourceError) unreachable.push(r.reason.message);
      else throw r.reason;
    }
    return { choices, unreachable };
  }
  async search(words: string) {
    const r = await this.searchEach(words);
    if (!r.choices.length && r.unreachable.length) throw new CoverSourceError(r.unreachable[0]);
    return r.choices;
  }
  download(c: CoverCandidate) {
    return this.of(c).download(c);
  }
  isbnOf(c: CoverCandidate) {
    return this.of(c).isbnOf(c);
  }
}

/** A plain coloured book-shaped PNG, its colour from the address. */
function fakePicture(url: string) {
  let h = 0;
  for (const ch of url) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return bookPng(120, 180, [40 + (h % 160), 40 + ((h >> 8) % 160), 40 + ((h >> 16) % 160)]);
}

/**
 * The fake used in tests: two covers for every title (so "Not this cover" can offer the second), none for a title
 * with "Oil 101" in it (so "no cover found" can be seen), each a plain coloured PNG made here.
 */
export class FakeCovers implements CoverSource {
  readonly name = "fake";
  finds: string[] = [];
  searches: string[] = [];
  downloads: string[] = [];

  async find(wanted: { title: string; author: string }): Promise<CoverCandidate[]> {
    this.finds.push(wanted.title);
    if (/oil 101/i.test(wanted.title)) return [];
    const slug = normalize(wanted.title).replace(/ /g, "-") || "untitled";
    return [1, 2].map((n) => ({
      source: "fake" as const,
      imageUrl: fakeImage(slug, n),
      pageUrl: `https://catalogue.example.org/fake/${slug}`,
      title: wanted.title,
      authors: wanted.author ? [wanted.author] : [],
      isbn: n === 2 ? "9780000000002" : null,
    }));
  }

  /** Three results for any words, none for words with "nothing" in them. */
  async search(words: string): Promise<CoverChoice[]> {
    this.searches.push(words);
    if (/nothing/i.test(words)) return [];
    const slug = normalize(words).replace(/ /g, "-").slice(0, 60).replace(/-+$/, "") || "untitled";
    return [1, 2, 3].map((n) => ({
      choice: `fake:${slug}:${n}`,
      source: "fake" as const,
      title: `${words} (${n})`,
      authors: ["A. Writer"],
      year: String(2000 + n),
      preview: fakePicture(fakeImage(slug, n)),
    }));
  }

  async download(c: CoverCandidate) {
    this.downloads.push(c.imageUrl);
    return fakePicture(c.imageUrl);
  }

  async isbnOf(c: CoverCandidate) {
    return c.isbn;
  }
}

const g = globalThis as unknown as { __neolibraryFakeCovers?: FakeCovers };

export function getCoverSource(env: Record<string, string | undefined> = process.env): CoverSource {
  if (env.AI_FAKE === "1" || env.VITEST) return (g.__neolibraryFakeCovers ??= new FakeCovers());
  const key = env.GOOGLE_BOOKS_API_KEY?.trim();
  return new CoverSources([new OpenLibraryCovers(), ...(key ? [new GoogleBooksCovers(key)] : [])]);
}
