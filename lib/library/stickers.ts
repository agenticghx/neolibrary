/**
 * Stickers (M8): a small fixed set of marks for passages. Drawn as SVG
 * shapes on a 24×24 grid (not emoji), so they look the same on every device
 * and in screenshots. Shared by the server and the reader.
 */
export const STICKERS = {
  star: { label: "Important", color: "amber", paths: ["M12 3.2l2.6 5.5 6 .7-4.5 4.1 1.2 5.9L12 16.4l-5.3 3 1.2-5.9-4.5-4.1 6-.7z"] },
  question: { label: "Question", color: "sky", paths: ["M9.3 9.2a2.8 2.8 0 1 1 3.9 2.6c-.8.4-1.2 1-1.2 1.8v.7", "M12 17.6v.1"] },
  exclaim: { label: "Surprising", color: "rose", paths: ["M12 6.2v7.6", "M12 17.6v.1"] },
  check: { label: "Agree", color: "sage", paths: ["M6.2 12.6l3.8 3.8 7.8-8.6"] },
  flag: { label: "Come back to this", color: "amber", paths: ["M7 20.5V4.5", "M7 5h9.5l-2 3.5 2 3.5H7"] },
} as const;

export type Sticker = keyof typeof STICKERS;
export const isSticker = (v: unknown): v is Sticker => typeof v === "string" && Object.hasOwn(STICKERS, v);
