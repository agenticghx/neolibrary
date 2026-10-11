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
  // Import (M14 follow-up V3b): the arrow Home's Import button draws (components/upload/HomeImport.tsx).
  import: "M12 16V4M7 9l5-5 5 5M5 20h14",
  // The mini-player's skips (M14 step 6b; the design's paths): a turning arrow and "15".
  back15: "M5 12a7 7 0 1 0 2.1-5M5 4v4h4M10.2 10v5M15.2 10H13v2.2h2.2V15H13",
  forward15: "M19 12a7 7 0 1 1-2.1-5M19 4v4h-4M9.2 10v5M14.2 10H12v2.2h2.2V15H12",
  // Think aloud (M14 step 6c; the design's path): a microphone.
  mic: "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3",
  // The account menu (M18; Samuel's picks, computer A and phone B): a gear, bars, a stack of disks,
  // a person with a plus, a door with an arrow out, and the arrow beside the name.
  account:
    "M12 9.2a2.8 2.8 0 1 1 0 5.6a2.8 2.8 0 0 1 0-5.6zM10.6 3h2.8l.5 2.3 1.6.9 2.2-.8 1.4 2.4-1.7 1.6v1.8l1.7 1.6-1.4 2.4-2.2-.8-1.6.9-.5 2.3h-2.8l-.5-2.3-1.6-.9-2.2.8-1.4-2.4 1.7-1.6v-1.8L4.9 7.8l1.4-2.4 2.2.8 1.6-.9z",
  stats: "M4 20h16M7 16.5V12M12 16.5V6.5M17 16.5V9.5",
  data: "M12 3.5c4.1 0 7.5 1.2 7.5 2.8S16.1 9 12 9 4.5 7.9 4.5 6.3 7.9 3.5 12 3.5zM4.5 6.3v11.4c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8V6.3M4.5 12c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8",
  invite: "M10 11a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7zM3.5 20v-.5A5.5 5.5 0 0 1 9 14h2M18 14v6M15 17h6",
  signOut: "M9.5 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3.5M15.5 16l4-4-4-4M19.5 12H9.5",
  chevron: "M7 10l5 5 5-5",
  // Daily review (M21): two cards, one behind the other.
  review: "M4 8h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM7 5h12a1 1 0 0 1 1 1v10M7 13h5M7 16h3",
} as const;

/** Solid shapes (the mini-player's Play and Pause), filled with the current text colour. */
const FILLED = {
  play: "M8 5.6v12.8a.8.8 0 0 0 1.2.7l10.2-6.4a.8.8 0 0 0 0-1.4L9.2 4.9a.8.8 0 0 0-1.2.7z",
  pause: "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z",
} as const;

export type FilledIconName = keyof typeof FILLED;

export function FilledIcon({ name, className }: { name: FilledIconName; className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d={FILLED[name]} />
    </svg>
  );
}

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}
