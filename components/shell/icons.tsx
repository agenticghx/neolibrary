/** Line icons for the sidebar and tabs (24 x 24, drawn with the current text colour). Decorative: labels carry the meaning. */
const PATHS = {
  home: "M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z",
  library: "M4 5h3v14H4zM9 5h3v14H9zM14.5 5.6l2.9-.8 3.6 13.6-2.9.8z",
  want: "M7 4h10v16l-5-3.5L7 20z",
  finished: "M12 3a9 9 0 1 1 0 18a9 9 0 0 1 0-18zM8 12.5l2.6 2.6L16 9.5",
  book: "M12 6.5C9.8 5 7.3 4.6 4 5v13c3.3-.4 5.8 0 8 1.5 2.2-1.5 4.7-1.9 8-1.5V5c-3.3-.4-5.8 0-8 1.5zM12 6.5V19",
  audio: "M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H5a1 1 0 0 1-1-1zM20 15h-3v5h2a1 1 0 0 0 1-1z",
  pdf: "M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5",
  path: "M6 21a2 2 0 1 1 0-4a2 2 0 0 1 0 4zM18 7a2 2 0 1 1 0-4a2 2 0 0 1 0 4zM8 19h8a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h8",
  collection: "M4 7h16M4 12h16M4 17h10",
  plus: "M12 5v14M5 12h14",
  search: "M11 5a6 6 0 1 1 0 12a6 6 0 0 1 0-12zM20 20l-4.5-4.5",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}
