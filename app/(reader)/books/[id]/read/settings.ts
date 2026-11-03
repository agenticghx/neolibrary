/** Reader preferences, kept on this device (localStorage). */
/** Theme names stored on this device. The second column is the label Aa shows. */
export const READER_THEMES = [
  ["auto", "Auto"],
  ["paper", "Paper"],
  ["sepia", "Sepia"],
  ["night", "Night"],
  ["north", "North Window"],
  ["press", "Private Press"],
  ["calfskin", "Calfskin"],
] as const;
export type ReaderTheme = (typeof READER_THEMES)[number][0];
const THEME_IDS: readonly string[] = READER_THEMES.map(([id]) => id);
function isTheme(v: unknown): v is ReaderTheme {
  return typeof v === "string" && THEME_IDS.includes(v);
}

export type ReaderSettings = {
  flow: "paginated" | "scrolled";
  pages: "one" | "two";
  size: number; // percent of the book's base size
  spacing: "compact" | "normal" | "loose";
  face: "serif" | "sans" | "book";
  theme: ReaderTheme;
  /** PDFs only: in the Night theme (or Auto while the device is dark), show the page dimmed: dark paper, light ink (M19). */
  dimPdf: boolean;
  /**
   * EPUBs only (M21): help to keep your place. "ruler" puts a soft band behind the line under the pointer (or the line
   * last tapped) and dims the rest; "paragraph" dims every paragraph but the one you are on.
   */
  focus: FocusMode;
};

export type FocusMode = "off" | "ruler" | "paragraph";
export const FOCUS_MODES: readonly FocusMode[] = ["off", "ruler", "paragraph"];

export const DEFAULT_SETTINGS: ReaderSettings = {
  flow: "paginated",
  pages: "one",
  size: 100,
  spacing: "normal",
  face: "serif",
  theme: "auto",
  dimPdf: true,
  focus: "off",
};
export const SIZES = [80, 90, 100, 110, 120, 135, 150, 170];
export const SPACING = { compact: 1.4, normal: 1.6, loose: 1.85 } as const;
const KEY = "neolibrary.reader.v1";

export function loadSettings(): ReaderSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return {
      flow: raw.flow === "scrolled" ? "scrolled" : "paginated",
      pages: raw.pages === "two" ? "two" : "one",
      size: SIZES.includes(raw.size) ? raw.size : 100,
      spacing: raw.spacing in SPACING ? raw.spacing : "normal",
      face: ["serif", "sans", "book"].includes(raw.face) ? raw.face : "serif",
      theme: isTheme(raw.theme) ? raw.theme : "auto",
      dimPdf: raw.dimPdf !== false, // on unless turned off; settings saved before it existed get it on
      focus: FOCUS_MODES.includes(raw.focus) ? raw.focus : "off", // off for settings saved before it existed
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: ReaderSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode or storage full: settings just won't persist.
  }
}

/**
 * CSS injected into each book page. Colours come from the app's design tokens
 * (read from the page at run time), fonts from /public/fonts.
 */
export function bookCss(s: ReaderSettings, colors: Record<string, string>, origin: string): string {
  const fonts = `
    @font-face { font-family: "NL Serif"; src: url("${origin}/fonts/source-serif-4-latin-opsz-normal.woff2") format("woff2"); font-weight: 200 900; font-style: normal; }
    @font-face { font-family: "NL Serif"; src: url("${origin}/fonts/source-serif-4-latin-opsz-italic.woff2") format("woff2"); font-weight: 200 900; font-style: italic; }
    @font-face { font-family: "NL Sans"; src: url("${origin}/fonts/source-sans-3-latin-wght-normal.woff2") format("woff2"); font-weight: 200 900; font-style: normal; }
    @font-face { font-family: "NL Math"; src: url("${origin}/fonts/stix-two-math.woff2") format("woff2"); font-weight: 400; font-style: normal; }`;
  const family = s.face === "serif" ? '"NL Serif", Georgia, serif' : s.face === "sans" ? '"NL Sans", Arial, sans-serif' : null;
  return `
    ${fonts}
    @namespace epub "http://www.idpf.org/2007/ops";
    html { color-scheme: ${colors.scheme}; font-size: ${s.size}% !important; --theme-bg-color: ${colors.paper}; }
    html, body { background: ${colors.paper} !important; color: ${colors.ink} !important; }
    ${family ? `body, p, li, blockquote, dd, div, span, h1, h2, h3, h4, h5, h6 { font-family: ${family} !important; }` : ""}
    /* M41: formulas in a font made for mathematics, so brackets and roots stretch to fit (Chrome uses no system math
       font; Android and Windows have none). The browser downloads it only for a page that has a formula. */
    math { font-family: "NL Math", math !important; }
    p, li, blockquote, dd {
      line-height: ${SPACING[s.spacing]} !important;
      ${s.focus === "off" ? "hyphens: auto;" : "hyphens: manual !important; /* Focus dims text, not the hyphens a browser adds at line ends */"}
      widows: 2;
      orphans: 2;
    }
    a:link, a:visited { color: ${colors.accent} !important; }
    ::selection { background: ${colors.highlight}; }
    ::highlight(nl-spoken) { background-color: ${colors.spoken}; color: ${colors.ink}; }
    ${focusCss(colors)}
    img, svg { max-width: 100%; height: auto; }
    /* M41: a tap on a picture shows it full screen (FigureView.tsx); a linked picture is the link's. */
    img { cursor: zoom-in; }
    /* M41 R4b: a tap on a displayed equation opens Explain this equation (EquationView.tsx). */
    math[display="block"][alttext] { cursor: help; }
    a img { cursor: pointer; }
    /* A table wider than the column (The Pay Off's 9-column table, 2026-10-17) spilled over the text beside it: it
       stays within the column. Clipped, not scrolled (M41): a box that scrolls cannot be split across pages, so a
       table taller than a page lost every row past the page's foot (Greco's Table 3 showed 21 of its 40 rows), and on
       a phone the page's own swipe left it no way to scroll anyway. A row is never split; a caption keeps to its table.
       A table wider than the column is marked by the reader (data-nl-wide, markWideTables in figure.ts): its cut edge
       fades, it says so, and a tap shows the whole table (TableView.tsx). */
    table { display: block; width: max-content; max-width: 100%; overflow-x: clip; }
    tr { break-inside: avoid; }
    p:has(+ table) { break-after: avoid; }
    table[data-nl-wide] { cursor: zoom-in; mask-image: linear-gradient(to left, transparent, #000 2.5em); }
    table[data-nl-wide]::before {
      content: "Wider than the page \\2014  tap to see the whole table";
      display: block; margin: 0.3em 0 0.5em; font: 600 0.75rem/1.3 "NL Sans", Arial, sans-serif; letter-spacing: 0.02em;
      color: ${colors.accent};
    }
    pre { white-space: pre-wrap !important; }
    aside[epub|type~="footnote"], aside[epub|type~="endnote"], aside[epub|type~="note"], aside[epub|type~="rearnote"] { display: none; }
  `;
}

/**
 * Focus (M21), inside the book's frames. Reader.tsx sets data-nl-focus on the page's root element and does the rest
 * from where the pointer is (focus.ts): the text outside the line or paragraph in front of the reader is painted in a
 * dimmer ink with a custom highlight (no element is added around the text, so clicks, selection and notes are
 * untouched), and the ruler is a band drawn behind the text. Under it, the body is see-through so the band shows.
 */
function focusCss(colors: Record<string, string>): string {
  return `
    ::highlight(nl-dim) { color: color-mix(in srgb, ${colors.ink} 45%, ${colors.paper}); }
    html[data-nl-focus="ruler"] body { background: transparent !important; }
    [data-nl-ruler] {
      position: fixed; left: 0; top: 0; z-index: -1; display: none;
      pointer-events: none; user-select: none; -webkit-user-select: none;
      border-radius: 4px;
      background: color-mix(in srgb, ${colors.ink} 9%, transparent);
      box-shadow: 0 0 6px 2px color-mix(in srgb, ${colors.ink} 5%, transparent);
    }
    html[data-nl-focus="ruler"] [data-nl-ruler][data-shown] { display: block; }
    [data-nl-ruler][data-glide] { transition: transform 120ms cubic-bezier(0.2, 0.7, 0.2, 1), width 120ms, height 120ms; }
    @media (prefers-reduced-motion: reduce) { [data-nl-ruler] { transition: none !important; } }
    [data-nl-place] {
      position: fixed; left: 0; top: 0; z-index: 1;
      pointer-events: none; user-select: none; -webkit-user-select: none;
      border-radius: 4px;
      background: color-mix(in srgb, ${colors.accent} 22%, transparent);
      animation: nl-place 2.4s ease-out forwards;
    }
    @keyframes nl-place { 0% { opacity: 0; } 8% { opacity: 1; } 70% { opacity: 1; } 100% { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { [data-nl-place] { animation: none; } }
  `;
}

/** The rewritten view (M17): saved on the reader's account (lib/library/preferences.ts), not on this device. */
export type { RewrittenView as RewrittenMode } from "@/lib/library/levels";
