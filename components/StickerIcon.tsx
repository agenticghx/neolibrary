import { STICKERS, type Sticker } from "@/lib/library/stickers";

/** A sticker drawn from its SVG paths (decorative: the button or list item carries the name). */
export function StickerIcon({ sticker, size = 20, className }: { sticker: Sticker; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}>
      {STICKERS[sticker].paths.map((d) => (
        <path key={d} d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}
