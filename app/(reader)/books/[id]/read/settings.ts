/** Reader preferences, kept on this device (localStorage). */
export type ReaderSettings = {
  flow: "paginated" | "scrolled";
  size: number; // percent of the book's base size
  spacing: "compact" | "normal" | "loose";
  face: "serif" | "sans" | "book";
  theme: "auto" | "paper" | "sepia" | "night";
};

export const DEFAULT_SETTINGS: ReaderSettings = { flow: "paginated", size: 100, spacing: "normal", face: "serif", theme: "auto" };
export const SIZES = [80, 90, 100, 110, 120, 135, 150, 170];
export const SPACING = { compact: 1.4, normal: 1.6, loose: 1.85 } as const;
const KEY = "neolibrary.reader.v1";

export function loadSettings(): ReaderSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return {
      flow: raw.flow === "scrolled" ? "scrolled" : "paginated",
      size: SIZES.includes(raw.size) ? raw.size : 100,
      spacing: raw.spacing in SPACING ? raw.spacing : "normal",
      face: ["serif", "sans", "book"].includes(raw.face) ? raw.face : "serif",
      theme: ["auto", "paper", "sepia", "night"].includes(raw.theme) ? raw.theme : "auto",
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
    @font-face { font-family: "NL Sans"; src: url("${origin}/fonts/source-sans-3-latin-wght-normal.woff2") format("woff2"); font-weight: 200 900; font-style: normal; }`;
  const family = s.face === "serif" ? '"NL Serif", Georgia, serif' : s.face === "sans" ? '"NL Sans", Arial, sans-serif' : null;
  return `
    ${fonts}
    @namespace epub "http://www.idpf.org/2007/ops";
    html { color-scheme: ${colors.scheme}; font-size: ${s.size}% !important; }
    html, body { background: ${colors.paper} !important; color: ${colors.ink} !important; }
    ${family ? `body, p, li, blockquote, dd, div, span, h1, h2, h3, h4, h5, h6 { font-family: ${family} !important; }` : ""}
    p, li, blockquote, dd {
      line-height: ${SPACING[s.spacing]} !important;
      hyphens: auto;
      widows: 2;
      orphans: 2;
    }
    a:link, a:visited { color: ${colors.accent} !important; }
    ::selection { background: ${colors.highlight}; }
    ::highlight(nl-spoken) { background-color: ${colors.spoken}; color: ${colors.ink}; }
    img, svg { max-width: 100%; height: auto; }
    pre { white-space: pre-wrap !important; }
    aside[epub|type~="footnote"], aside[epub|type~="endnote"], aside[epub|type~="note"], aside[epub|type~="rearnote"] { display: none; }
  `;
}
