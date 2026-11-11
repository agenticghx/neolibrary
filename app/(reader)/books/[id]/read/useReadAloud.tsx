"use client";

import { type RefObject, useEffect, useRef } from "react";
import * as CFI from "foliate-js/epubcfi.js";
import { type usePlayer } from "@/components/player/PlayerProvider";
import { mark } from "@/lib/perf-marks";
import { rangeForOffsets } from "@/lib/reader/text-range";
import { focusBlock, FOCUS_BLOCKS } from "./focus";
import { ListenBar } from "./ListenBar";
import { lightPdfWord, pageOpening, pdfDocsOnScreen, pdfPage, recordLit, type FoliateView } from "./reader-helpers";

/**
 * Read aloud, on the page: lights the word being spoken, turns the page when the voice reaches its end, shows a
 * paragraph the voice jumps to, and joins this page to the app's player while the Read aloud bar shows. Moved out of
 * Reader.tsx as it was (the version 2 split). The audio itself is the player's (components/player).
 */
export function useReadAloud(props: {
  bookId: string;
  fileType: string;
  startListening?: boolean;
  player: ReturnType<typeof usePlayer>;
  setListening: (on: boolean) => void;
  /** The Read aloud bar shows (asked for, and the place in the book is known). */
  showsBar: boolean;
  /** The book has opened, or failed to: before that the page can neither turn nor light a word. */
  ready: boolean;
  /** Puts paragraph focus back on the pointer, or the top of the page. */
  refocus: (range?: Range | null, cfi?: string | null) => void;
  view: RefObject<FoliateView | null>;
  whereCfi: RefObject<string | null>;
  turning: RefObject<boolean>;
  litCfi: RefObject<string | null>;
  spokenPdf: RefObject<{ page: number; at: [number, number] } | null>;
  spokenBlock: RefObject<Element | null>;
  focusRef: RefObject<string>;
  listenBar: RefObject<HTMLDivElement | null>;
  listenSlot: RefObject<HTMLDivElement | null>;
}) {
  const { player, setListening, showsBar, ready, refocus, view, whereCfi, turning: turningRef, litCfi: litCfiRef, spokenPdf: spokenPdfRef, spokenBlock: spokenBlockRef, focusRef, listenBar, listenSlot } = props;

  // Read aloud: highlight the word being spoken, inside the book's own frame
  // (CSS Custom Highlight API, so the book's text is not touched), and turn
  // the page when the voice reaches the end of it.
  const highlightWord = (passageCfi: string, from: number, to: number, inPage?: [number, number] | null): string | null => {
    const v = view.current;
    // Not before the book is open (foliate sets its renderer last), nor in a book that failed to open.
    if (!v?.renderer) return null;
    // A PDF (M13 (e)): the word's place on its page in non-space characters,
    // in the page's text layer; its page is turned to by the player.
    if (props.fileType === "pdf") {
      const page = pdfPage(passageCfi);
      // A word with no place on its page (a scan read aloud from its text edition, where the page's own text has
      // nothing like it): nothing is lit, rather than the wrong word.
      if (inPage === null && page >= 0) {
        spokenPdfRef.current = null;
        litCfiRef.current = passageCfi;
        for (const d of pdfDocsOnScreen(v)) (d.defaultView as (Window & { CSS: typeof CSS }) | null)?.CSS.highlights?.delete("nl-spoken");
        return recordLit(listenBar.current, "");
      }
      if (!inPage || page < 0) return null;
      spokenPdfRef.current = { page, at: inPage };
      // Going on after a pause returns to this page.
      litCfiRef.current = passageCfi;
      const doc = pdfDocsOnScreen(v).find((d) => d.documentElement.dataset.page === String(page));
      if (doc) return recordLit(listenBar.current, lightPdfWord(v, doc, inPage, "word"));
      // Not shown: the reader turned back from it while it is read. Turn to it
      // again, as an EPUB's pages follow the voice (a page turned to ahead is
      // left alone). Not while a turn is on its way: foliate shows one page at
      // a time, and asking again for a page still opening fails.
      if (!turningRef.current && pageOpening(v) !== page && page > pdfPage(whereCfi.current ?? "")) {
        turningRef.current = true;
        mark("nl:turn-request", { page, by: "word" });
        void v
          .goTo(passageCfi)
          .catch(() => undefined)
          .finally(() => {
            turningRef.current = false;
          });
      }
      return null;
    }
    const { index, anchor } = v.resolveCFI(passageCfi);
    const doc = v.renderer.getContents().find((c) => c.index === index)?.doc;
    if (!doc) return null;
    let range: Range | null = null;
    let el: Element | null = null;
    try {
      const start = anchor(doc).startContainer;
      el = start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement;
      range = el ? rangeForOffsets(el, from, to) : null;
    } catch {
      // A chapter that is still opening has an empty document for a moment: not there yet.
      return null;
    }
    if (!range) return null;
    // Paragraph focus (M21) follows the paragraph read aloud.
    if (el && focusRef.current === "paragraph") {
      spokenBlockRef.current = el.closest(FOCUS_BLOCKS) ?? el;
      focusBlock(doc, spokenBlockRef.current);
    }
    const win = doc.defaultView as (Window & { CSS: typeof CSS; Highlight: typeof Highlight }) | null;
    win?.CSS.highlights?.set("nl-spoken", new win.Highlight(range));
    const text = range.toString();
    mark("nl:lit", { index, at: from, text, via: "word" });
    recordLit(listenBar.current, text);
    const wordCfi = v.getCFI(index, range);
    litCfiRef.current = wordCfi;
    const visible = whereCfi.current;
    if (visible && !turningRef.current && CFI.compare(wordCfi, CFI.collapse(visible, true)) > 0) {
      // On to the word's page, however many pages on (after a jump in the
      // audio it may be several). foliate ignores a turn asked for while it
      // finishes the last one (about 0.1 s), and then sends no "relocate":
      // so the flag clears when this request is done or ignored, and the
      // next word asks again.
      turningRef.current = true;
      void v.goTo(wordCfi).finally(() => {
        turningRef.current = false;
      });
    }
    return text;
  };

  /**
   * Shows a paragraph read aloud, unless it is already on screen. Going on
   * after a pause (`resume`), it shows the word that was being read instead:
   * in a long paragraph that may be on a later page than the paragraph's
   * start, and turning back to the start would only turn forward again.
   */
  const showPassage = (passageCfi: string, opts: { resume?: boolean } = {}) => {
    const v = view.current;
    const visible = whereCfi.current;
    if (!v?.renderer) return;
    const target = opts.resume && litCfiRef.current ? litCfiRef.current : passageCfi;
    const at = CFI.collapse(target);
    if (visible && CFI.compare(at, CFI.collapse(visible)) >= 0 && CFI.compare(at, CFI.collapse(visible, true)) <= 0) return;
    if (props.fileType !== "pdf") {
      void v.goTo(target);
      return;
    }
    // A PDF page opens in its own frame. Not asked for again while it opens
    // (foliate fails on that); and until it is open, the word being read does
    // not ask for it either (see highlightWord).
    if (pageOpening(v) === pdfPage(target)) return;
    turningRef.current = true;
    mark("nl:turn-request", { page: pdfPage(target), by: "passage" });
    void v
      .goTo(target)
      .catch(() => undefined)
      .finally(() => {
        turningRef.current = false;
      });
  };

  const stopListening = () => {
    litCfiRef.current = null;
    spokenPdfRef.current = null;
    // Paragraph focus goes back to the pointer, or the top of the page.
    spokenBlockRef.current = null;
    refocus();
    // The book may still be opening (no renderer yet): stop all the same.
    for (const { doc } of view.current?.renderer?.getContents() ?? []) {
      (doc.defaultView as (Window & { CSS: typeof CSS }) | null)?.CSS.highlights?.delete("nl-spoken");
    }
    player.stop();
    setListening(false);
  };
  const forPlayer = useRef({ highlightWord, showPassage, stopListening });
  useEffect(() => {
    forPlayer.current = { highlightWord, showPassage, stopListening };
  });
  const { attach, stop } = player;
  useEffect(() => {
    const slot = listenSlot.current;
    if (!showsBar || !ready || !slot) return;
    return attach(
      {
        slot,
        onWord: (passageCfi, from, to, inPage) => forPlayer.current.highlightWord(passageCfi, from, to, inPage),
        onPassage: (passageCfi, opts) => forPlayer.current.showPassage(passageCfi, opts),
        renderBar: (view) => <ListenBar view={view} ref={listenBar} onClose={() => forPlayer.current.stopListening()} />,
      },
      props.bookId,
      // Where the reader is now: reading aloud starts here (unless this book is already being read aloud).
      whereCfi.current!,
      // Home's "Listen from here" means from the reading position, even if this book was being read aloud.
      !!props.startListening,
    );
  }, [showsBar, ready, attach, props.bookId, props.startListening, listenBar, listenSlot, whereCfi]);
  // Another book is being read aloud: opening this one stops it, as leaving the reader did before
  // reading aloud went on from page to page (this reader has no bar for another book).
  const playingBook = player.bookId;
  useEffect(() => {
    if (playingBook && playingBook !== props.bookId) stop();
  }, [playingBook, props.bookId, stop]);

  return { stopListening };
}
