"use client";

import { type Dispatch, type SetStateAction } from "react";
import { OwnKeysSetting } from "@/components/own-keys/OwnKeysSetting";
import { AiStyleSetting } from "./AiStyleSetting";
import { type ReaderCitations } from "./citations";
import { type ReaderFigure } from "./figure-redraws";
import { OfflineSetting } from "./OfflineSetting";
import { Segment } from "./ReaderControls";
import { READER_THEMES, SIZES, type ReaderSettings, type RulerLines, withWidth } from "./settings";
import styles from "./reader.module.css";

/**
 * The reader's "Reading settings" panel (Aa): pages, layout, width, text, focus, figures, citations, screen, theme,
 * and the account's own settings below them. Moved out of Reader.tsx as it was (the version 2 split): it shows the
 * settings and reports each change; the reader keeps and applies them.
 */
export function SettingsPanel(props: {
  bookId: string;
  fileUrl: string;
  fileType: "epub" | "pdf";
  settings: ReaderSettings;
  setSettings: Dispatch<SetStateAction<ReaderSettings | null>>;
  /** Changes some settings (the reader applies the e-ink rules on top). */
  update: (patch: Partial<ReaderSettings>) => void;
  /** Two pages cannot be shown in Scroll in this browser. */
  twoPagesOff: boolean;
  setShortcuts: (open: boolean) => void;
  figures?: ReaderFigure[];
  citations?: ReaderCitations | null;
  ownKeys?: boolean;
  visitor?: boolean;
}) {
  const { settings, setSettings, update, twoPagesOff, setShortcuts } = props;
  return (
    <section className={styles.panel} aria-label="Reading settings">
      <p className={styles.panelTitle}>Reading settings</p>
      <fieldset className={styles.group}>
        <legend>Pages</legend>
        <Segment
          value={settings.pages}
          options={[
            ["one", "One page"],
            ["two", "Two pages", twoPagesOff],
          ]}
          onChange={(pages) => update({ pages })}
        />
        {twoPagesOff ? (
          <p className={styles.hint} data-testid="two-pages-note">
            Two pages in Scroll needs Chrome or Edge. In this browser, it works with the Pages layout.
          </p>
        ) : null}
      </fieldset>
      {props.fileType === "pdf" ? (
        <p className={styles.hint}>This is a PDF: its pages keep their own layout, so text settings do not apply.</p>
      ) : (
        <>
      <fieldset className={styles.group}>
        <legend>Layout</legend>
        <Segment
          value={settings.flow}
          options={[
            ["paginated", "Pages"],
            ["scrolled", "Scroll", settings.eink],
          ]}
          onChange={(flow) => update({ flow })}
        />
        {settings.eink ? (
          <p className={styles.hint} data-testid="eink-scroll-note">
            E-ink screens smear while scrolling, so E-ink reads in Pages.
          </p>
        ) : null}
      </fieldset>
      <fieldset className={styles.group}>
        <legend>Width</legend>
        <Segment
          value={settings.width}
          options={[["comfortable", "Comfortable"], ["wide", "Wide"], ["full", "Full"]]}
          onChange={(width) => setSettings((s) => (s ? withWidth(s, width) : s))}
        />
        <label className={styles.check}>
          <input type="checkbox" checked={settings.justify} onChange={(e) => update({ justify: e.target.checked })} />
          Justify (straight edges on both sides)
        </label>
        <p className={styles.hint}>
          Wide and Full use more of a big screen, with bigger text; each width keeps its own text size. On a phone the text
          already fills the screen.
        </p>
      </fieldset>
      <fieldset className={styles.group}>
        <legend>Text size</legend>
        <div className={styles.sizeRow}>
          <button
            type="button"
            className={styles.step}
            aria-label="Smaller text"
            disabled={settings.size === SIZES[0]}
            onClick={() => update({ size: SIZES[Math.max(0, SIZES.indexOf(settings.size) - 1)] })}
          >
            A−
          </button>
          <span className={styles.sizeValue} data-testid="text-size">
            {settings.size}%
          </span>
          <button
            type="button"
            className={styles.step}
            aria-label="Larger text"
            disabled={settings.size === SIZES.at(-1)}
            onClick={() => update({ size: SIZES[Math.min(SIZES.length - 1, SIZES.indexOf(settings.size) + 1)] })}
          >
            A+
          </button>
        </div>
      </fieldset>
      <fieldset className={styles.group}>
        <legend>Line spacing</legend>
        <Segment
          value={settings.spacing}
          options={[["compact", "Compact"], ["normal", "Normal"], ["loose", "Loose"]]}
          onChange={(spacing) => update({ spacing })}
        />
      </fieldset>
      <fieldset className={styles.group}>
        <legend>Typeface</legend>
        <Segment
          value={settings.face}
          options={[["serif", "Serif"], ["sans", "Sans"], ["book", "Book's own"]]}
          onChange={(face) => update({ face })}
        />
      </fieldset>
      <fieldset className={styles.group}>
        <legend>Focus</legend>
        <Segment
          value={settings.focus}
          options={[["off", "Off"], ["ruler", "Ruler"], ["paragraph", "Paragraph"]]}
          onChange={(focus) => update({ focus })}
        />
        <p className={styles.hint}>
          Ruler: a soft band sits on the line under your pointer, or the line you tap; in Scroll it stays put and the
          text moves under it. Paragraph: the paragraph you are on stays clear and the rest dims.
        </p>
      </fieldset>
      {settings.focus === "ruler" ? (
        <fieldset className={styles.group}>
          <legend>Ruler height</legend>
          <Segment
            value={String(settings.rulerLines) as "1" | "2" | "3"}
            options={[["1", "1 line"], ["2", "2 lines"], ["3", "3 lines"]]}
            onChange={(n) => update({ rulerLines: Number(n) as RulerLines })}
          />
          <p className={styles.hint}>Two or three lines in the band at once: the line you tap and the ones after it.</p>
        </fieldset>
      ) : null}
      {props.figures?.length ? (
        <fieldset className={styles.group}>
          <legend>Figures</legend>
          <Segment
            value={settings.figures}
            options={[["redrawn", "Redrawn"], ["printed", "As printed"]]}
            onChange={(figures) => update({ figures })}
          />
          <p className={styles.hint}>
            {props.figures.length === 1 ? "One figure is" : `${props.figures.length} figures are`} drawn again cleanly by AI from the
            paper&apos;s own, and checked to match it line for line and word for word. Tap a figure to compare it with the printed one.
          </p>
        </fieldset>
      ) : null}
      {props.citations?.cites.length ? (
        <fieldset className={styles.group}>
          <legend>Citations</legend>
          <Segment
            value={settings.citations}
            options={[["as-written", "As written"], ["numbered", "Numbered"], ["hidden", "Hidden"]]}
            onChange={(citations) => update({ citations })}
          />
          <p className={styles.hint}>
            Numbered shows each work by its place in the reference list, counted from the top: [12]. On a computer, point at a
            number to see the work.
            {props.citations.unmatched
              ? ` ${props.citations.unmatched} ${props.citations.unmatched === 1 ? "citation names" : "citations name"} a work the list does not hold exactly once, and ${props.citations.unmatched === 1 ? "stays" : "stay"} as written.`
              : ""}
          </p>
        </fieldset>
      ) : null}
        </>
      )}
      <fieldset className={styles.group}>
        <legend>Screen</legend>
        <label className={styles.check}>
          <input type="checkbox" checked={settings.eink} onChange={(e) => update({ eink: e.target.checked })} />
          E-ink (a paper-like screen, such as a Boox or a Kindle)
        </label>
        <p className={styles.hint}>
          Black on white, nothing that moves or fades, and highlights drawn as lines under the words. Kept on this device
          only.
        </p>
      </fieldset>
      <fieldset className={styles.group}>
        <legend>Theme</legend>
        <Segment
          className={styles.themeChoices}
          value={settings.theme}
          options={[...READER_THEMES]}
          onChange={(theme) => update({ theme })}
        />
        <p className={styles.hint}>
          {settings.eink
            ? "With E-ink on, every theme is black on white, and Night is white on black."
            : "North Window is cool daylight with a teal mark. Private Press is bright paper with a red mark. Calfskin is warm hide with a gold mark."}
        </p>
      </fieldset>
      {props.fileType === "pdf" ? (
      <fieldset className={styles.group}>
        <legend>PDF pages at night</legend>
        <Segment
          value={settings.dimPdf ? "dim" : "printed"}
          options={[
            ["dim", "Dimmed"],
            ["printed", "As printed"],
          ]}
          onChange={(v) => update({ dimPdf: v === "dim" })}
        />
      </fieldset>
    ) : null}
    <p className={styles.hint}>Auto follows your device&apos;s light or dark setting. Arrow keys turn pages.</p>
      <button type="button" className={styles.linkButton} onClick={() => setShortcuts(true)}>
        Keyboard shortcuts
      </button>
      {props.ownKeys || props.visitor ? <OwnKeysSetting /> : null}
      {props.visitor ? null : (
        <>
          <AiStyleSetting bookId={props.bookId} />
          <p className={styles.hint}>
            STE is Simplified Technical English: one meaning per word, short sentences. The style is used by the rewritten view,
            Study and Rewrite; the Account page sets it for every book.
          </p>
          <OfflineSetting bookId={props.bookId} fileUrl={props.fileUrl} fileType={props.fileType} />
        </>
      )}
    </section>
  );
}
