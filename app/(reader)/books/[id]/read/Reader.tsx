"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as CFI from "foliate-js/epubcfi.js";
import { usePlayer } from "@/components/player/PlayerProvider";
import type { Annotation, Color } from "@/lib/library/annotations";
import { describeRefused } from "@/lib/outbox";
import { downloadBook, downloadedWords } from "@/lib/reader/download";
import type { CrossLink } from "@/lib/library/crosslinks";
import { type Sticker } from "@/lib/library/stickers";
import { CrossLinksPanel } from "./CrossLinksPanel";
import { ExplainPanel } from "./ExplainPanel";
import { useReadingTracker } from "./useReadingTracker";
import { BookFocusLine, EndFocusDialog, FocusStrip, LeaveFocusDialog, StartFocusDialog } from "./FocusSession";
import { useBookFocus } from "./useBookFocus";
import { useFullScreen } from "./useFullScreen";
import { ContentsPanel } from "./ContentsPanel";
import { bindPage } from "./reader-page";
import { bindMarks, bindScroll } from "./reader-view";
import { ReaderBar } from "./ReaderBar";
import { ReaderFoot } from "./ReaderFoot";
import { ReaderNotices } from "./ReaderNotices";
import { ReaderRail } from "./ReaderRail";
import { SettingsPanel } from "./SettingsPanel";
import { useNotes } from "./useNotes";
import { useReadAloud } from "./useReadAloud";
import { useRuler } from "./useRuler";
import { useSittingFocus } from "./useSittingFocus";
import { ImagesPanel } from "./ImagesPanel";
import { PictureCard } from "./PictureCard";
import { type PinnedPicture } from "@/lib/library/pinned";
import { mark } from "@/lib/perf-marks";
import { withCrossed } from "@/lib/reader/crossed-notes";
import { rangeForQuote } from "@/lib/reader/find-quote";
import { spreadForPages, TEXT_LAYER_EVENT } from "@/lib/reader/pdf-book";
import { turnWithSpine, type SpineBook } from "@/lib/reader/spine-fold";
import { scrollsItself, wheelTurner } from "@/lib/reader/swipe-turn";
import { canWrapColumns, spreadPitch, spreadTurn } from "@/lib/reader/spread-scroll";
import type { WhereWereWe } from "@/lib/library/where-were-we";
import { AskPanel } from "./AskPanel";
import { NeedToKnowPanel } from "./NeedToKnowPanel";
import { XrayPanel } from "./XrayPanel";
import { GenealogyPanel } from "./GenealogyPanel";
import { GenealogyView } from "./GenealogyView";
import type { GenealogyTop } from "./genealogy-views";
import type { GenealogyView as GenealogyData } from "@/lib/library/genealogy-view";
import { XrayCard } from "./XrayCard";
import { type DrawnMark } from "./xray-marks";
import { onSidebarChange, sidebarOpen } from "./sidebar";
import type { XrayMark } from "@/lib/library/xray";
import { NotesPanel } from "./NotesPanel";
import { QuestionsPanel } from "./QuestionsPanel";
import { WhereWereWeStrip } from "./WhereWereWe";
import { RewritePanel } from "./RewritePanel";
import { RewrittenPane } from "./RewrittenPane";
import { TURN_OFF, type AsYouTurn } from "@/lib/library/rewritten-turn";
import { SelectionBar, type PendingSelection } from "./SelectionBar";
import { loadSettings, saveSettings, type FigureMode, type FocusMode, type ReaderSettings, type RewrittenMode, type RulerLines, withEink } from "./settings";
import { firstLetter, markLine, setFocusMode, type Spot } from "./focus";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { type TocItem } from "./ReaderControls";
import { FigureView } from "./FigureView";
import { TableView } from "./TableView";
import { type Figure, type TappedTable } from "./figure";
import { filterCitationCfis, type ReaderCitations } from "./citations";
import { showFigures, type ReaderFigure } from "./figure-redraws";
import { EquationView, type EquationAsk } from "./EquationView";
import styles from "./reader.module.css";
import { voiceFetch } from "@/lib/own-keys";
import { OPEN_TIMEOUT_MS, SYNC_EVENT, api, applySettings, clean, isDark, pdfDocsOnScreen, pdfPage, readerClass, saveVisitorPlace, visitorPlace, type DrawFn, type FoliateView, type ReaderPanel, type Relocate } from "./reader-helpers";

type NotSaved = { reason: string; text: string; what?: string };

/**
 * The "not saved" notice after another save or failure. A notice that holds a note's words is the only copy of them:
 * it stays until the reader dismisses it, unless what just happened carried words itself (the note, tried again). So
 * a bookmark or a removal, saved or refused, never takes a failed note's words off the page.
 */
const keepWords = (was: NotSaved | null, text: string, next: NotSaved | null) => (was?.text && !text ? was : next);

export function Reader(props: {
  /** The signed-in reader's account id: notes made offline wait on the device under it (lib/outbox.ts). "" for a visitor. */
  readerId: string;
  bookId: string;
  title: string;
  author: string;
  fileUrl: string;
  fileType: "epub" | "pdf";
  initialCfi: string | null;
  /** The place saved when the page was made (M27 Q2): opened elsewhere (?at=, ?page=), it is not a place to offer. */
  savedCfi?: string | null;
  initialFraction: number;
  /** Open with the Read aloud bar showing (Home's "Listen from here"); the reader still presses Play (Safari needs the click). */
  startListening?: boolean;
  /** M43: open the Genealogy views on a name ("person:Robert Noyce", from "Also in <book>" in another book's views). */
  openGenealogyAt?: string;
  /** The view the book opens in (M17), from the reader's account: the book alone, the rewrite beside it, or the rewrite alone. */
  rewrittenView?: RewrittenMode;
  /** M25: a scanned PDF and its text edition (two books): which one this is, so the footer offers Scan | Text. */
  edition?: { scanId: string; textId: string; current: "scan" | "text" };
  /** M25: open the text edition at the marker of this page of the scan. */
  openPage?: number;
  /** M28 S3: back on a later day, ask what the reader remembers of this chapter (lib/library/where-were-we.ts). */
  recall?: WhereWereWe | null;
  /**
   * M34 S3: a visitor (not signed in) reading a book that is free to read. Nothing is saved on the server: the
   * place is kept in this browser (visitorPlace), and the tools that need an account (notes, AI help, X-ray,
   * listening, focus, search, offline) are not offered. `backHref` is the book's page on the open shelf.
   */
  visitor?: { backHref: string };
  /** M34 S4: this reader pays for AI and voices with their own keys (anyone but the owner): the settings offer them. */
  ownKeys?: boolean;
  /** M41 R5: a paper's citations and reference list (lib/library/citations.ts), for Aa > Citations; null for a book without. */
  citations?: ReaderCitations | null;
  /** M41 R6: a paper's figures redrawn cleanly (lib/library/figure-redraws.ts), for Aa > Figures; empty for most books. */
  figures?: ReaderFigure[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  // Dimmed PDF pages (M19 P2): each page document as it loads, and whether pages are dimmed now.
  const pageDocs = useRef(new Set<Document>());
  const dimRef = useRef(false);
  const view = useRef<FoliateView | null>(null);
  /** The open PDF, when this book is one, so a fold can draw a page that is not on screen yet. */
  const bookRef = useRef<SpineBook | null>(null);
  const turnRef = useRef<(dir: "next" | "prev") => void>(() => {});
  /** Two pages in Scroll: the distance between two stacked spreads (one screen), or 0 for one column. */
  const spreadRef = useRef(0);
  // A click, an arrow key, or Previous/Next. Read aloud turns with goTo and does not come through here.
  useEffect(() => {
    turnRef.current = (dir) => {
      const v = view.current;
      if (!v) return;
      const pitch = spreadRef.current;
      if (pitch && props.fileType !== "pdf") {
        // Stacked spreads: scroll to the next (or previous) spread's top, so it shows whole.
        const distance = spreadTurn(v.renderer?.start ?? 0, pitch, dir);
        void (dir === "next" ? v.next(distance) : v.prev(distance));
        return;
      }
      void turnWithSpine(v, bookRef.current, dir, props.fileType === "pdf");
    };
  });
  /**
   * The spread the open PDF renderer was given. Foliate reads the spread only
   * when that renderer opens, so this is written after the reopen has opened.
   * The book's own spread is the choice just made: it changes before the
   * reopen works, and a failed reopen leaves it ahead of this, so the same
   * choice can be tried again.
   */
  const openSpread = useRef<string | null>(null);
  /** One reopen at a time. The next choice waits, then opens with the spread the book has then. */
  const reopenTask = useRef(Promise.resolve());
  /** Set while a reopen is putting a page back. A relocate for any other page is ignored. */
  const heldCfi = useRef<{ cfi: string | null } | null>(null);
  const [settings, setSettings] = useState<ReaderSettings | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  // The first load of notes got an error answer: said over the page, so it does not look like "no notes".
  const [notesFailed, setNotesFailed] = useState(false);
  // A PDF's number of pages (each page is a section), for "Go to page" (M20); 0 for an EPUB.
  const [pageCount, setPageCount] = useState(0);
  const [panel, setPanel] = useState<ReaderPanel>("none");
  // X-ray on the page (M32 X2): the name whose card is open, the names on the screen, and each chapter's marks
  // (fetched once, drawn on its overlay).
  const [xrayCard, setXrayCard] = useState<string | null>(null);
  // M43 S3: the Genealogy views over the whole screen, opened from the Genealogy tab.
  const [genealogy, setGenealogy] = useState<{ data: GenealogyData; view: GenealogyTop; focus?: string } | null>(null);
  const [onPage, setOnPage] = useState<{ id: string; name: string }[]>([]);
  const xrayMarks = useRef(new Map<number, Promise<XrayMark[]>>());
  const xrayDrawn = useRef(new Map<number, DrawnMark[]>());
  // The keyboard follows the panel (M19 P1b), as in the account menu: focus moves into a panel when it opens, and
  // back to the button that opened it when it closes, if the focus went away with the panel.
  const opener = useRef<HTMLElement | null>(null);
  const shownPanel = useRef<typeof panel>("none");
  useEffect(() => {
    const was = shownPanel.current;
    shownPanel.current = panel;
    if (panel === "none") {
      const back = opener.current;
      opener.current = null;
      const lost = document.activeElement === null || document.activeElement === document.body;
      if (was !== "none" && back?.isConnected && lost) back.focus();
      return;
    }
    if (was === "none") {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    const box = stage.current?.querySelector<HTMLElement>(`:scope > .${CSS.escape(styles.panel)}`);
    if (!box || box.contains(document.activeElement)) return; // a panel that put focus on its own field keeps it
    box.tabIndex = -1;
    box.focus({ preventScroll: true });
  }, [panel]);
  const [imagesFor, setImagesFor] = useState("");
  const [imagesAt, setImagesAt] = useState<PendingSelection | null>(null);
  const [links, setLinks] = useState<CrossLink[]>([]);
  const player = usePlayer();
  // The bar shows when asked for, or when this book is still being read aloud (the reader was left and is back).
  const [listening, setListening] = useState(!!props.startListening || player.bookId === props.bookId);
  // ?listen=1 (Home's Listen from here) opens the Read aloud bar once: take it out of the
  // address, so a reload after closing the bar does not open it again.
  useEffect(() => {
    if (!props.startListening) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("listen");
    window.history.replaceState(window.history.state, "", url);
  }, [props.startListening]);
  /** The other version's notes (a scan and its text edition) found on this one: their places here, by note id. */
  const crossedAt = useRef(new Map<string, string>());
  /** Places the other version's notes on the pages already shown (set once the book is open). */
  const placeShown = useRef<() => void>(() => {});
  const { notes, setNotes, notesRef, reload, create, forget, refused, dismissRefused, saveNote, removeNote, removed, undoRemove, addBookNote } = useNotes({
    bookId: props.bookId,
    readerId: props.readerId,
    visitor: !!props.visitor,
    view,
    crossedAt,
    placeShown,
  });
  const { focusSession, focusStart, setFocusStart, focusEnding, focusLeaving, setFocusLeaving, focusWaitMinutes, focusReport, beginFocus, finishFocus, focusWait, answerFocus } = useSittingFocus({
    bookId: props.bookId,
    visitor: !!props.visitor,
    closePanels: () => setPanel("none"),
    reload,
  });
  const tracker = useReadingTracker(props.bookId, listening, focusReport, !props.visitor);
  const trackerRef = useRef(tracker);
  useEffect(() => {
    trackerRef.current = tracker;
  });
  const whereCfi = useRef<string | null>(props.initialCfi);
  /** M25: the page of the scan being read (in the text edition, the last page marker passed), for Scan | Text. */
  const [scanPage, setScanPage] = useState<number | null>(null);
  const editionNow = props.edition?.current;
  /** Read aloud asked for the next page and it has not arrived yet. */
  const turning = useRef(false);
  /** Where the word lit by read aloud is (its CFI): going on after a pause returns to its page. */
  const litCfi = useRef<string | null>(null);
  /** The word lit in a PDF page (M13 (e)), lit again when the page's text layer is complete or laid out for a new size. */
  const spokenPdf = useRef<{ page: number; at: [number, number] } | null>(null);
  /** The Read aloud bar's element, on which each lit word is recorded (recordLit). */
  const listenBar = useRef<HTMLDivElement>(null);
  const linkedText = useRef("");
  const [rewriteAt, setRewriteAt] = useState<string | null>(null);
  /** Read it rewritten (M17): the view, from the account, and the last one that showed the rewrite (the top bar's button goes back to it). */
  const [rewritten, setRewritten] = useState<{ mode: RewrittenMode; last: Exclude<RewrittenMode, "original"> }>(() => {
    const mode = props.rewrittenView ?? "original";
    return { mode, last: mode === "rewritten" ? "rewritten" : "side" };
  });
  /** The place on screen for the rewritten view: an EPUB's visible range, or a PDF's first and last page shown. */
  const [screen, setScreen] = useState<{ from: string; to: string } | null>(null);
  /** Rewriting each page as it is turned to (M17 R3): for this visit only, never remembered. */
  const [turn, setTurn] = useState<AsYouTurn>(TURN_OFF);
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const selectionDoc = useRef<Document | null>(null);
  // The selected-text bar (M27 Q1) closes on a tap or click outside it, or on Escape, as its × does; not while a
  // note, voice note or drawing is open in it (SelectionBar's onBusy). Not when the book's own selection goes away:
  // Safari clears a frame's selection when a button outside the frame is pressed, and the bar must stay for it.
  const selectionBar = useRef<HTMLDivElement>(null);
  const selectionOpen = useRef(false);
  const selectionBusy = useRef(false);
  useEffect(() => {
    selectionOpen.current = !!selection;
  }, [selection]);
  const dismissSelection = useCallback(() => {
    if (!selectionOpen.current || selectionBusy.current) return false;
    selectionOpen.current = false;
    selectionDoc.current?.getSelection()?.removeAllRanges();
    setSelection(null);
    return true;
  }, []);
  const onSelectionBusy = useCallback((busy: boolean) => {
    selectionBusy.current = busy;
  }, []);
  const [activeId, setActiveId] = useState<string | null>(null);
  const visibleText = useRef("");
  const [where, setWhere] = useState<{ cfi: string | null; fraction: number; chapter: string }>({
    cfi: props.initialCfi,
    fraction: props.initialFraction,
    chapter: "",
  });
  // From a name in Who & what (its card in the list or over the page): the views open on that name, from where the
  // reader is. Not for a visitor, whose Study has no Genealogy.
  const openGenealogy = props.visitor
    ? undefined
    : (name: string, v: GenealogyTop) =>
        void fetch(`/api/books/${props.bookId}/genealogy?${new URLSearchParams(where.cfi ? { cfi: where.cfi } : {})}`)
          .then(async (res) => (res.ok ? ((await res.json()) as GenealogyData | { none: true }) : null))
          .then((d) => d && !("none" in d) && setGenealogy({ data: d, view: v, focus: name }))
          .catch(() => undefined);
  // "Also in <book>" (M43): the same name in the reader's other books, each opening that book's views on it (in the
  // view it is in, or "Inside a company" when that book gives the organisation no family tree).
  const alsoIn = (name: string, kind: "person" | "organisation", v: GenealogyTop) =>
    fetch(`/api/books/${props.bookId}/genealogy?${new URLSearchParams({ also: name, kind })}`)
      .then(async (res) => (res.ok ? ((await res.json()) as { also: { bookId: string; title: string; name: string; links: number; tree: boolean }[] }).also : []))
      .then((list) => list.map((a) => ({ title: a.title, name: a.name, links: a.links, href: `/books/${a.bookId}/read?${new URLSearchParams({ genealogy: `${v === "tree" && !a.tree ? "org" : v}:${a.name}` })}` })));
  // Opened from another book's "Also in": the views on that name, once the book is open.
  const askedGenealogy = useRef(false);
  useEffect(() => {
    const m = /^(tree|org|person):(.+)$/.exec(props.openGenealogyAt ?? "");
    if (!m || askedGenealogy.current || props.visitor) return;
    askedGenealogy.current = true;
    void fetch(`/api/books/${props.bookId}/genealogy?${new URLSearchParams(props.initialCfi ? { cfi: props.initialCfi } : {})}`)
      .then(async (res) => (res.ok ? ((await res.json()) as GenealogyData | { none: true }) : null))
      .then((d) => d && !("none" in d) && setGenealogy({ data: d, view: m[1] as GenealogyTop, focus: m[2] }))
      .catch(() => undefined);
  }, [props.openGenealogyAt, props.bookId, props.initialCfi, props.visitor]);
  // Whole-book focus (M26 R5): one book only, for days; a line above the page. Answering it reloads the notes.
  const bookAnswered = useRef<() => void>(() => {});
  const bookFocus = useBookFocus(props.bookId, where, () => bookAnswered.current(), !props.visitor);
  // M28 S3: "Where were we?" has a row of its own (not in a focus session), shared with the whole-book focus line. The
  // theme class is also set on the element directly (when the book opens, when settings change), so those places add
  // this class too, or the strip would take the book's row.
  const withRecall = (props.recall || bookFocus.focus) && !focusSession ? ` ${styles.withRecall}` : "";
  const recallClass = useRef(withRecall);
  useEffect(() => {
    recallClass.current = withRecall;
  }, [withRecall]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  // While a large file downloads: "12 of 80 MB" (M20).
  const [downloaded, setDownloaded] = useState<string | null>(null);
  // Focus (M21, EPUBs): the mode now, the paragraph read aloud, and where the mouse rests (in the reader's coordinates).
  const focusRef = useRef<FocusMode>("off");
  // M42 S1: E-ink on, read where highlights are drawn (they are underlined in ink, not tinted).
  const einkRef = useRef(false);
  const rulerLinesRef = useRef<RulerLines>(1);
  // M41 R5: fixed for the page's life (it comes with the page), read where the book is opened.
  const citationsRef = useRef(props.citations);
  // M41 R6: the redrawn figures (fixed for the page's life) and the mode now, read as each chapter loads.
  const figuresRef = useRef(props.figures ?? []);
  const figureModeRef = useRef<FigureMode>("redrawn");
  // Each redraw fetched once from this page (with the sign-in cookie) and kept as a blob: address for the book's pages.
  const redrawBlobs = useRef(new Map<string, Promise<string>>());
  const loadRedraw = useCallback((url: string) => {
    const known = redrawBlobs.current.get(url);
    if (known) return known;
    const p = fetch(url, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`${r.status}`))))
      .then((b) => URL.createObjectURL(b));
    redrawBlobs.current.set(url, p);
    p.catch(() => redrawBlobs.current.delete(url));
    return p;
  }, []);
  useEffect(() => {
    const blobs = redrawBlobs.current;
    return () => {
      for (const p of blobs.values()) p.then((u) => URL.revokeObjectURL(u), () => undefined);
      blobs.clear();
    };
  }, []);
  const { spokenBlock, pointer, lensEl, lens, lensLine, lensPlace, shownOf, showLens, showLensOn, holdLens, refocus } = useRuler({ view, focusRef });
  // The layout last laid out (Pages or Scroll, One or Two pages), and the place to mark once a switch has settled.
  const laidOut = useRef<string | null>(null);
  const placeToMark = useRef<Spot | null>(null);
  // The Keyboard shortcuts dialog (M21): "?" or the link in Reading settings.
  const [shortcuts, setShortcuts] = useState(false);
  // M41: the picture a tap on the page opened full screen.
  const [figure, setFigure] = useState<Figure | null>(null);
  const [wholeTable, setWholeTable] = useState<TappedTable | null>(null);
  // M41 R4b: the equation a tap asked to have explained.
  const [equation, setEquation] = useState<EquationAsk | null>(null);
  const shortcutsOpen = useRef(false);
  useEffect(() => {
    shortcutsOpen.current = shortcuts;
  }, [shortcuts]);
  const sidebarChosen = useSyncExternalStore(onSidebarChange, sidebarOpen, () => false);
  // A focus session shows only the page (M26 R3): the rail goes with the bars, and comes back after.
  const sidebar = sidebarChosen && !focusSession;
  const rail = useRef<HTMLElement | null>(null);
  const { canFull, full, idle, wake, toggleFull } = useFullScreen({ panel, setPanel, setXrayCard, sidebar });
  const pending = useRef<Relocate | null>(null);
  // M27 Q2 (like Kindle's Whispersync): the places this tab saved itself, the one it opened at and the one saved
  // when it opened (a search result or a shared link opens elsewhere, and the page has not been saved yet). A saved place
  // that is none of them was put there by another device, or by listening away from this page: coming back to the
  // tab, the reader is offered it.
  const ownPlaces = useRef(new Set<string>([props.initialCfi, props.savedCfi].filter((c): c is string => !!c)));
  const [elsewhere, setElsewhere] = useState<{ cfi: string; fraction: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(
    (keepalive = false) => {
      const loc = pending.current;
      if (!loc) return;
      pending.current = null;
      ownPlaces.current.add(loc.cfi);
      if (props.visitor) {
        saveVisitorPlace(props.bookId, loc.cfi);
        return;
      }
      void fetch(`/api/books/${props.bookId}/position`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cfi: loc.cfi, fraction: loc.fraction }),
        keepalive,
      }).catch(() => {});
    },
    [props.bookId, props.visitor],
  );

  // Coming back to this tab or window (M27 Q2): has the place moved elsewhere?
  useEffect(() => {
    if (props.visitor) return;
    let asking = false;
    const check = async () => {
      if (document.visibilityState !== "visible" || asking) return;
      asking = true;
      try {
        const r = await fetch(`/api/books/${props.bookId}/position`, { cache: "no-store" });
        if (!r.ok) return;
        const at = (await r.json()) as { cfi: string | null; fraction: number };
        if (at.cfi && !ownPlaces.current.has(at.cfi) && at.cfi !== whereCfi.current) setElsewhere({ cfi: at.cfi, fraction: at.fraction });
      } catch {
        // Offline: nothing to offer.
      } finally {
        asking = false;
      }
    };
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [props.bookId, props.visitor]);

  // Highlights in other books that share this page's ideas (cross-book links).
  const lookForLinks = useCallback(
    (text: string) => {
      if (props.visitor || !text || text === linkedText.current) return;
      linkedText.current = text;
      void fetch(`/api/books/${props.bookId}/crosslinks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      })
        .then((r) => (r.ok ? r.json() : { links: [] }))
        .then((b: { links: CrossLink[] }) => {
          if (linkedText.current === text) setLinks(b.links);
        })
        .catch(() => {});
    },
    [props.bookId, props.visitor],
  );

  // Every key here is listed in the Keyboard shortcuts dialog (ShortcutsDialog.tsx): change both together.
  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    // The shortcuts dialog has the keyboard while it is open (and handles Escape itself).
    if (shortcutsOpen.current) return;
    const target = e.target as HTMLElement | null;
    if (target && (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName.toUpperCase()) || target.isContentEditable)) return;
    // "?" lists the shortcuts (M21), even with a button focused: it is not a key a button uses.
    if (e.key === "?") {
      e.preventDefault();
      setShortcuts(true);
      return;
    }
    // A focused button keeps its own keys (Enter, Space, arrows), but Escape still closes the panel (M19 P1b).
    if (target?.tagName === "BUTTON" && e.key !== "Escape") return;
    // In Pages, and on a PDF's pages, Up and Down turn the page too (issue #257, in one page or two); in Scroll they
    // scroll the text a little, as the browser does.
    // Space turns to the next page and Shift+Space back, in Pages only (issue #267), as most e-book readers do; in
    // Scroll it scrolls, as the browser does. A focused link, anything acting as a button, and the selected-text bar
    // (role "toolbar") keep Space. (Buttons, text boxes and the shortcuts dialog have already returned above.)
    const space =
      e.key === " " && !target?.closest?.("a, [role='button'], [role='link'], [role='menuitem'], [role='toolbar'], summary");
    const paged =
      (e.key === "ArrowDown" || e.key === "ArrowUp" || space) && view.current?.renderer?.getAttribute("flow") !== "scrolled";
    if (paged) e.preventDefault();
    if (e.key === "ArrowRight" || e.key === "PageDown" || (paged && (e.key === "ArrowDown" || (space && !e.shiftKey))))
      turnRef.current("next");
    else if (e.key === "ArrowLeft" || e.key === "PageUp" || (paged && (e.key === "ArrowUp" || (space && e.shiftKey))))
      turnRef.current("prev");
    else if (e.key === "f" || e.key === "F") toggleFull();
    else if (e.key === "Escape") {
      // The selected-text bar first (M27 Q1), then the panel.
      if (!dismissSelection()) {
        setXrayCard(null);
        setPanel("none");
      }
    }
  }, [dismissSelection, toggleFull]);

  // A sideways swipe on a trackpad turns the page (#235), in Pages and in Scroll; in Pages (and a PDF), so does
  // scrolling up and down. One turner serves the book's frames and the margins around them, so a swipe that crosses
  // from one to the other is still one swipe.
  const wheelTurn = useRef<ReturnType<typeof wheelTurner> | null>(null);
  const onWheel = useCallback((e: WheelEvent) => {
    // A pinch on a trackpad arrives as a wheel event with Ctrl held: that is the browser's zoom.
    if (e.ctrlKey || shortcutsOpen.current) return;
    wheelTurn.current ??= wheelTurner((dir) => turnRef.current(dir));
    const path = e.composedPath();
    const upDown = view.current?.renderer?.getAttribute("flow") !== "scrolled";
    if (wheelTurn.current(e, upDown, (axis, px) => scrollsItself(path, axis, px))) e.preventDefault();
  }, []);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  // Open the book once. Settings live on this device (localStorage).
  useEffect(() => {
    if (view.current) return;
    let cancelled = false;
    // Never wait forever: some failures inside the book's frames are thrown
    // where this code cannot catch them (this hid a Safari problem, 2026-10-04).
    // The clock starts once the file has arrived; the download has its own (M20).
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        const initial = loadSettings();
        focusRef.current = props.fileType === "pdf" ? "off" : initial.focus;
        rulerLinesRef.current = initial.rulerLines;
        await import("foliate-js/view.js");
        const blob = await downloadBook(props.fileUrl, {
          stallMs: OPEN_TIMEOUT_MS,
          onProgress: (got, total) => {
            if (!cancelled) setDownloaded(downloadedWords(got, total));
          },
        });
        giveUp = setTimeout(() => {
          if (!cancelled) setStatus((s) => (s === "loading" ? "error" : s));
        }, OPEN_TIMEOUT_MS);
        const book =
          props.fileType === "pdf"
            ? await (await import("@/lib/reader/pdf-book")).makePdfBook(blob, initial.pages)
            : new File([blob], "book.epub", { type: "application/epub+zip" });
        bookRef.current = props.fileType === "pdf" ? (book as SpineBook) : null;
        if (cancelled) return;
        openSpread.current = props.fileType === "pdf" ? (book as { rendition: { spread: string } }).rendition.spread : null;
        const v = document.createElement("foliate-view") as FoliateView;
        v.className = styles.view;
        host.current!.append(v);
        view.current = v;
        await v.open(book);
        // M41 R5: places are counted as if a paper's citation spans were not there (citations.ts).
        if (citationsRef.current) filterCitationCfis(v as never);
        // Highlights: load them, and draw each one when its page is rendered.
        const { Overlayer } = (await import("foliate-js/overlayer.js")) as { Overlayer: { highlight: DrawFn } };
        // An error answer must not look like "this book has no notes": say so (the notes are safe on the server).
        const answer = props.visitor ? null : await fetch(`/api/books/${props.bookId}/annotations`);
        if (answer && !answer.ok) setNotesFailed(true);
        const loaded = answer?.ok ? withCrossed(await answer.json(), crossedAt.current) : [];
        notesRef.current = loaded;
        setNotes(loaded);
        // Send anything made offline earlier, and show what is still waiting (see the sync effect below).
        window.dispatchEvent(new Event(SYNC_EVENT));
        const { marksOf, showOnPage } = bindMarks({
          v,
          props: { bookId: props.bookId, fileType: props.fileType, visitor: !!props.visitor },
          Overlayer,
          xrayMarks,
          xrayDrawn,
          notesRef,
          root,
          einkRef,
          setOnPage,
          setXrayCard,
          setActiveId,
          setPanel,
        });
        root.current!.className = readerClass(initial) + recallClass.current;
        spreadRef.current = applySettings(v, initial, root.current!);
        setSettings(initial);
        bindScroll({ v, focusRef, lensLine, lens, pointer, spreadRef, showLensOn, shownOf, refocus, holdLens });
        v.addEventListener("relocate", (e: Event) => {
          const d = (e as CustomEvent<Relocate>).detail;
          // A page shown: the other version's notes on it are placed (also when its frame was not reported loading).
          placeShown.current();
          let pages: number[] = [];
          if (props.fileType === "pdf") {
            const shown = pdfDocsOnScreen(v)
              .map((doc) => Number(doc.documentElement.dataset.page))
              .filter((n) => Number.isInteger(n) && n >= 0);
            pages = shown;
            const reported = pdfPage(d.cfi);
            // The patched viewer names the page on screen. Drop an address for a page that is not showing.
            if (shown.length > 0 && reported >= 0 && !shown.includes(reported)) return;
            const held = heldCfi.current?.cfi;
            if (held && pdfPage(d.cfi) !== pdfPage(held)) return;
          }
          const cfi = d.cfi;
          mark("nl:relocate", { cfi });
          if (editionNow) {
            const page = editionNow === "scan" ? pdfPage(cfi) + 1 : Number(d.pageItem?.label);
            setScanPage(Number.isInteger(page) && page > 0 ? page : null);
          }
          setWhere({ cfi, fraction: d.fraction, chapter: d.tocItem?.label?.trim() ?? "" });
          if (props.fileType === "pdf") {
            // A page's names, from its marks (no underlines on a page picture).
            if (pages.length) void marksOf(pages[0]).then((marks) => setOnPage(marks.filter((m, i) => marks.findIndex((x) => x.entryId === m.entryId) === i).map((m) => ({ id: m.entryId, name: m.name }))));
          } else {
            let index = -1;
            try {
              index = v.resolveCFI(cfi).index;
            } catch {
              // Not a place in the book: nothing on the screen to name.
            }
            showOnPage(index, d.range);
          }
          // The page on screen (data-cfi, read by the tests) is recorded now, in the same step as foliate
          // shows it, as recordLit does for the lit word. Left to React it was written up to 22 ms later,
          // after the next page's first word had already been lit there by its text layer, so on a loaded
          // CI runner a screen frame showed the word lit with the page before still recorded
          // (docs/ci-flakes.md). React's own render writes the same value, so it changes nothing.
          root.current?.setAttribute("data-cfi", cfi);
          // A PDF's pages on screen (two side by side bring both); an EPUB's visible range.
          const pageCfi = (n: number) => `epubcfi(/6/${(n + 1) * 2})`;
          setScreen(pages.length ? { from: pageCfi(Math.min(...pages)), to: pageCfi(Math.max(...pages)) } : { from: cfi, to: cfi });
          whereCfi.current = cfi;
          turning.current = false;
          visibleText.current = clean(d.range?.toString() ?? "");
          const label = d.tocItem?.label?.trim() ?? "";
          const chapterKey = d.tocItem?.href ?? label;
          trackerRef.current.onPage(
            CFI.collapse(cfi),
            visibleText.current,
            chapterKey ? { key: chapterKey, label, position: d.fraction } : undefined,
          );
          pending.current = { ...d, cfi };
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            flush();
            lookForLinks(visibleText.current);
          }, 600);
          // Focus (M21) on the page now in front of the reader.
          if (props.fileType !== "pdf") refocus(d.range ?? null, cfi);
        });
        /**
         * The other version's notes on the page just shown (a scan's page, with its text drawn; or a chapter of the
         * text edition): found by their quoted words on their printed page (lib/reader/find-quote.ts), given a place
         * here and drawn. One whose words are not here (read too differently) stays in Notes with "Go to" its page.
         */
        const placeCrossed = (doc: Document, index: number) => {
          const found: Annotation[] = [];
          for (const a of notesRef.current) {
            if (!a.crossed || crossedAt.current.has(a.id) || !a.quote.exact) continue;
            let range: Range | null = null;
            if (props.fileType === "pdf") {
              const layer = doc.documentElement.dataset.page === String(a.crossed.page - 1) ? doc.querySelector(".textLayer") : null;
              range = layer ? rangeForQuote(layer, a.quote) : null;
            } else if (doc.getElementById(`page-${a.crossed.page}`)) range = rangeForQuote(doc.body, a.quote, a.crossed.page);
            if (!range) continue;
            const cfi = v.getCFI(index, range);
            crossedAt.current.set(a.id, cfi);
            found.push({ ...a, cfi });
          }
          if (!found.length) return;
          notesRef.current = notesRef.current.map((a) => found.find((f) => f.id === a.id) ?? a);
          setNotes(notesRef.current);
          for (const a of found) if (["highlight", "sticker", "drawing", "image"].includes(a.kind)) void v.addAnnotation({ value: a.cfi! });
        };
        // Pages shown before these listeners were set (the notes are fetched first, and a slow fetch lets the first
        // page open meanwhile: CI run 40412619634), or before a reload brought a note: a scan's page whose text is
        // drawn (its end marker is there) now, one still drawing when its text is.
        placeShown.current = () => {
          for (const c of v.renderer?.getContents() ?? []) {
            const doc = c.doc;
            if (!doc) continue;
            const index = (c as { index?: number }).index ?? Number(doc.documentElement.dataset.page);
            if (!Number.isInteger(index)) continue;
            if (props.fileType !== "pdf" || doc.querySelector(".textLayer .endOfContent")) placeCrossed(doc, index);
            else doc.addEventListener(TEXT_LAYER_EVENT, () => placeCrossed(doc, index), { once: true });
          }
        };
        v.addEventListener("load", (e: Event) =>
          bindPage(e, {
            v,
            props: { bookId: props.bookId, fileType: props.fileType },
            citationsRef,
            figuresRef,
            figureModeRef,
            loadRedraw,
            spokenPdf,
            listenBar,
            placeCrossed,
            onKey,
            onWheel,
            turnRef,
            trackerRef,
            wake,
            dismissSelection,
            setEquation,
            setWholeTable,
            setFigure,
            focusRef,
            rulerLinesRef,
            pointer,
            spokenBlock,
            showLensOn,
            lensPlace,
            whereCfi,
            pageDocs,
            dimRef,
            selectionDoc,
            setSelection,
          }),
        );
        setToc(v.book.toc ?? []);
        placeShown.current();
        setPageCount(props.fileType === "pdf" ? (v.book.sections?.length ?? 0) : 0);
        const opensAt = props.visitor ? visitorPlace(props.bookId) : props.initialCfi;
        await v.init({ lastLocation: opensAt, showTextStart: !opensAt && !props.openPage });
        // M25: from the scan's page n to the same page in the text edition (its page marker, in the page list).
        const opening = props.openPage ? v.book.pageList?.find((item) => item.label === String(props.openPage)) : undefined;
        if (opening) await v.goTo(opening.href);
        // The book's own typeface (NL Serif, fetched by the book's frame) can arrive after the first page is laid
        // out; the text is blank until then, and foliate lays the page out again when it lands, which moves the
        // page's start by a paragraph or more. "Ready" waits for it (at most 3 s, the browser's own wait for a
        // font), and then a frame for foliate's new layout, so the page a reader sees first is the one recorded
        // (docs/ci-flakes.md, shell.spec.ts:469 on e97bc8f).
        const fonts = (v.renderer?.getContents() ?? []).map(({ doc }) => doc.fonts?.ready);
        await Promise.race([Promise.all(fonts), new Promise((r) => setTimeout(r, 3000))]);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        if (cancelled) return;
        clearTimeout(giveUp);
        setStatus("ready");
      } catch (err) {
        console.error(err);
        clearTimeout(giveUp);
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      bookRef.current = null;
      clearTimeout(giveUp);
    };
  }, [props.bookId, props.fileUrl, props.fileType, props.initialCfi, props.openPage, props.visitor, editionNow, flush, onKey, onWheel, lookForLinks, refocus, holdLens, showLens, showLensOn, dismissSelection, loadRedraw, notesRef, setNotes, lens, lensLine, lensPlace, pointer, spokenBlock, shownOf, wake]);

  // Focus (M21): the book's area changed size or place (the device turned, full screen, a side pane): the ruler's
  // band, drawn over the book, is put back on its line, or on the first line if its place is gone.
  useEffect(() => {
    const clip = lensEl.current?.parentElement;
    if (!clip) return;
    let frame = 0;
    const sizes = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (focusRef.current === "ruler" && lens.current) refocus();
      });
    });
    sizes.observe(clip);
    return () => {
      sizes.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [refocus, lens, lensEl]);

  // Two pages in Scroll: a spread is one screen tall, so a new window size lays the spreads out again (or goes to
  // one column, in a window taller than wide).
  useEffect(() => {
    if (!settings || props.fileType === "pdf" || settings.flow !== "scrolled" || settings.pages !== "two") return;
    const el = host.current;
    if (!el) return;
    let frame = 0;
    const sizes = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const v = view.current;
        if (!v?.renderer || !root.current) return;
        if (spreadPitch(settings, v.renderer.getBoundingClientRect(), canWrapColumns()) !== spreadRef.current)
          spreadRef.current = applySettings(v, settings, root.current);
      });
    });
    sizes.observe(el);
    return () => {
      sizes.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [settings, props.fileType]);

  // Re-style when settings or the colour scheme change. A PDF's spread is read only when its renderer opens, so a new page choice reopens on the same page.
  useEffect(() => {
    if (!settings) return;
    saveSettings(settings);
    // The theme class must be on the element before colours are read from it.
    if (root.current) root.current.className = readerClass(settings) + recallClass.current;
    const v = view.current;
    // A switch of layout moves the words read last (in Two pages, maybe to the right column): note where the text on
    // screen starts, and mark that line once the new layout has settled. A second switch before then keeps the first
    // place.
    const layout = `${settings.flow} ${settings.pages}`;
    if (laidOut.current !== null && laidOut.current !== layout && props.fileType !== "pdf" && !placeToMark.current) {
      const onScreen = (v as { lastLocation?: { range?: Range | null } | null } | null)?.lastLocation?.range;
      placeToMark.current = onScreen ? firstLetter(onScreen) : null;
    }
    laidOut.current = layout;
    if (v && root.current) spreadRef.current = applySettings(v, settings, root.current);
    // M42 S1: E-ink switched: draw the notes on the pages again, as underlines or as tints (their colours changed too).
    if (einkRef.current !== settings.eink) {
      einkRef.current = settings.eink;
      if (v && props.fileType !== "pdf")
        for (const a of notesRef.current) if (["highlight", "sticker", "drawing", "image"].includes(a.kind) && a.cfi) void v.addAnnotation({ value: a.cfi });
    }
    // M41 R6: Figures, redrawn or as printed, on the pages already open (a page opened later reads the ref).
    figureModeRef.current = settings.figures;
    if (v && figuresRef.current.length) for (const { doc } of v.renderer?.getContents() ?? []) showFigures(doc, settings.figures);
    const marking = placeToMark.current
      ? setTimeout(() => {
          const spot = placeToMark.current;
          placeToMark.current = null;
          const doc = spot?.node.ownerDocument;
          if (spot && doc) markLine(doc, spot);
        }, 400)
      : undefined;
    // Focus (M21): EPUBs only. A new mode is set on every page shown; a new size or layout moves the lines, so the
    // band and the dimming are put back once the page is laid out again.
    const focus: FocusMode = props.fileType === "pdf" ? "off" : settings.focus;
    if (focusRef.current !== focus || rulerLinesRef.current !== settings.rulerLines) {
      focusRef.current = focus;
      rulerLinesRef.current = settings.rulerLines;
      if (focus !== "ruler") showLens(null);
      try {
        for (const { doc } of v?.renderer?.getContents() ?? []) if (doc?.documentElement) setFocusMode(doc, focus, settings.rulerLines);
      } catch {
        // No pages yet: each page sets its mode as it loads.
      }
    }
    const relaid = requestAnimationFrame(() => refocus());
    const spread = spreadForPages(settings.pages);
    const book = v?.book;
    // The latest choice, including when this run does not itself reopen (a theme change, or a choice that is already open).
    // The spread lives on Foliate's book, which it reads when the renderer opens. It is not React state.
    if (book?.rendition && openSpread.current !== null) {
      // eslint-disable-next-line react-hooks/immutability -- Foliate's book object, not a value owned by React
      book.rendition.spread = spread;
    }
    let stop = false;
    if (v && book?.rendition && openSpread.current !== null && openSpread.current !== spread) {
      reopenTask.current = reopenTask.current.then(async () => {
        if (stop) return;
        const place = whereCfi.current;
        const pin = { cfi: place };
        heldCfi.current = pin;
        // True once this task has closed the renderer, so it must open one again even if the choice changed back.
        let opened = false;
        try {
          for (let attempt = 0; attempt < 4; attempt++) {
            const opening = book.rendition?.spread;
            if (!opening) return;
            if (!opened && opening === openSpread.current) return;
            const old = v.renderer;
            if (old) {
              const dispatch = old.dispatchEvent.bind(old);
              // A turn that is still loading on this renderer must not report a page after it is closed.
              old.dispatchEvent = (event: Event) => (event.type === "relocate" ? true : dispatch(event));
            }
            v.close();
            opened = true;
            await v.open(book);
            if (book.rendition?.spread !== opening) continue;
            await v.init({ lastLocation: place, showTextStart: !place });
            // Record the spread only once this renderer has opened, so a failure can be tried again.
            openSpread.current = opening;
            opened = false;
            if (book.rendition?.spread !== opening) continue;
            if (!stop) setStatus((s) => (s === "error" ? "ready" : s));
            return;
          }
          if (!stop) setStatus("error");
        } catch (err) {
          console.error(err);
          if (!stop) setStatus("error");
        } finally {
          if (heldCfi.current === pin) heldCfi.current = null;
        }
      });
    }
    // PDF pages are dimmed in the dark themes unless turned off (M19 P2); pages that load later read dimRef.
    const dimPages = () => {
      dimRef.current = props.fileType === "pdf" && settings.dimPdf && isDark(settings);
      for (const doc of pageDocs.current) {
        if (!doc.defaultView) pageDocs.current.delete(doc); // a page no longer shown
        else doc.documentElement.toggleAttribute("data-dim", dimRef.current);
      }
    };
    dimPages();
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (view.current && root.current) spreadRef.current = applySettings(view.current, settings, root.current);
      dimPages();
    };
    mq.addEventListener("change", onChange);
    return () => {
      stop = true;
      clearTimeout(marking);
      cancelAnimationFrame(relaid);
      mq.removeEventListener("change", onChange);
    };
  }, [settings, props.fileType, refocus, showLens, notesRef]);

  // Save on leaving; keyboard paging.
  useEffect(() => {
    const onHide = () => flush(true);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("keydown", onKey);
      flush(true);
    };
  }, [flush, onKey]);

  const clearSelection = () => {
    selectionDoc.current?.getSelection()?.removeAllRanges();
    setSelection(null);
  };

  // A save the library refused or that failed part-way (not "no connection": those wait on the device). Shown over
  // the page with what the reader typed, so the words are not lost with the selection bar that held them.
  const [notSaved, setNotSaved] = useState<NotSaved | null>(null);
  /** Runs a save; if the library refuses it, says so. `what` names what did not happen when it is not a save ("Not removed"). */
  const orSay = async (work: () => Promise<void>, text = "", what?: string) => {
    try {
      await work();
      setNotSaved((was) => keepWords(was, text, null));
    } catch (e) {
      const reason = e instanceof Error && e.message ? e.message : "Not saved";
      setNotSaved((was) => keepWords(was, text, { reason, text, what }));
    }
  };

  const highlight = async (color: Color, body: string) => {
    if (!selection) return;
    // Take the selection and clear it first: the reader may select something
    // new while this is being saved, and that must not be wiped.
    const picked = selection;
    clearSelection();
    const a: Annotation = await create({
      kind: "highlight",
      cfi: picked.cfi,
      quote: { exact: picked.exact, prefix: picked.prefix, suffix: picked.suffix },
      color,
      body,
    });
    await reload();
    await view.current?.addAnnotation({ value: a.cfi! });
  };

  const addSticker = async (sticker: Sticker) => {
    if (!selection) return;
    const picked = selection;
    clearSelection();
    const a: Annotation = await create({
      kind: "sticker",
      cfi: picked.cfi,
      quote: { exact: picked.exact, prefix: picked.prefix, suffix: picked.suffix },
      sticker,
    });
    await reload();
    await view.current?.addAnnotation({ value: a.cfi! });
  };

  const pinPicture = async (picture: PinnedPicture) => {
    if (!imagesAt) return;
    const a: Annotation = await api(`/api/books/${props.bookId}/annotations`, "POST", {
      kind: "image",
      cfi: imagesAt.cfi,
      quote: { exact: imagesAt.exact, prefix: imagesAt.prefix, suffix: imagesAt.suffix },
      picture,
    });
    await reload();
    await view.current?.addAnnotation({ value: a.cfi! });
  };

  const activePicture = notes.find((a) => a.id === activeId && a.kind === "image") as (Annotation & { pictureUrl?: string }) | undefined;

  const saveDrawing = async (strokes: number[][]) => {
    if (!selection) return;
    const picked = selection;
    const a: Annotation = await api(`/api/books/${props.bookId}/annotations`, "POST", {
      kind: "drawing",
      cfi: picked.cfi,
      quote: { exact: picked.exact, prefix: picked.prefix, suffix: picked.suffix },
      drawing: { strokes },
    });
    clearSelection();
    await reload();
    await view.current?.addAnnotation({ value: a.cfi! });
    setActiveId(a.id);
    setPanel("notes");
  };

  const saveVoiceNote = async (audio: Blob, durationMs: number) => {
    if (!selection) return;
    const picked = selection;
    const form = new FormData();
    form.set("audio", audio, "voice-note");
    form.set("cfi", picked.cfi);
    form.set("quote", JSON.stringify({ exact: picked.exact, prefix: picked.prefix, suffix: picked.suffix }));
    form.set("durationMs", String(Math.round(durationMs)));
    const res = await voiceFetch(`/api/books/${props.bookId}/voice-notes`, { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? "The voice note was not saved.");
    clearSelection();
    await reload();
    setActiveId(body.annotation.id);
    setPanel("notes");
  };

  const bookmarkHere = where.cfi
    ? notes.find(
        (a) =>
          a.kind === "bookmark" &&
          a.cfi &&
          CFI.compare(a.cfi, CFI.collapse(where.cfi!)) >= 0 &&
          CFI.compare(a.cfi, CFI.collapse(where.cfi!, true)) <= 0,
      )
    : undefined;

  // Two pages in Scroll needs CSS column wrapping (spread-scroll.ts); where the browser has none, the choice is greyed
  // out in Scroll and says why. Settings exist only in the browser, so the check never runs on the server.
  const twoPagesOff = settings?.flow === "scrolled" && props.fileType !== "pdf" && !canWrapColumns();

  // One press at a time: a second press before the first was saved made a second bookmark of the same page.
  const bookmarking = useRef(false);
  const toggleBookmark = async () => {
    if (!where.cfi || bookmarking.current) return;
    bookmarking.current = true;
    const here = where.cfi;
    // A bookmark the library refuses says so: the button used to stay as it was, with no word of why.
    await orSay(
      async () => {
        if (bookmarkHere) await forget(bookmarkHere);
        else
          await create({
            kind: "bookmark",
            cfi: CFI.collapse(here),
            quote: { exact: visibleText.current.slice(0, 160) || where.chapter },
          });
        await reload();
      },
      "",
      bookmarkHere ? "The bookmark was not removed" : "The bookmark was not saved",
    );
    bookmarking.current = false;
  };

  // The app's read-aloud player (components/player): while the bar shows, this
  // page lights its words, turns its pages and draws its bar. Leaving the
  // reader takes the page away; the audio goes on.
  const listenSlot = useRef<HTMLDivElement>(null);
  const showsBar = listening && !!where.cfi;
  // On a phone the sidebar's rail is a row under the book, and a panel is a card over the page: the card must end
  // above the rail, or it covers the tools (a tap on Study with Rewrite open did nothing, 2026-11-01). --below-rail is
  // how far the rail's top is from the bottom of the screen.
  useEffect(() => {
    const el = root.current;
    if (!sidebar || !el) return;
    const measure = () => {
      const top = rail.current?.getBoundingClientRect().top;
      if (top === undefined) el.style.removeProperty("--below-rail");
      else el.style.setProperty("--below-rail", `${Math.max(0, window.innerHeight - top)}px`);
    };
    measure();
    const sizes = new ResizeObserver(measure);
    if (host.current) sizes.observe(host.current);
    if (rail.current) sizes.observe(rail.current);
    window.addEventListener("resize", measure);
    return () => {
      sizes.disconnect();
      window.removeEventListener("resize", measure);
      el.style.removeProperty("--below-rail");
    };
  }, [sidebar]);
  // A tap or click outside the selected-text bar closes it (M27 Q1); taps inside the book are caught in its frames.
  // While the Read aloud bar shows (a note open in the selected-text bar, or text selected while listening), the
  // selected-text bar sits above it instead of over it.
  const selecting = !!selection;
  useEffect(() => {
    if (!selecting) return;
    const outside = (e: PointerEvent) => {
      if (!selectionBar.current?.contains(e.target as Node)) dismissSelection();
    };
    document.addEventListener("pointerdown", outside, true);
    const bar = selectionBar.current;
    const lift = () => {
      // The player draws the Read aloud bar into its slot a moment after the slot appears.
      const top = showsBar ? listenSlot.current?.firstElementChild?.getBoundingClientRect().top : undefined;
      if (top === undefined) bar?.style.removeProperty("--above-listen");
      else bar?.style.setProperty("--above-listen", `${Math.max(0, window.innerHeight - top)}px`);
    };
    lift();
    // The Read aloud bar is a row of the reader's grid: it appearing, or wrapping on a phone, resizes the book's box.
    const sizes = new ResizeObserver(lift);
    if (host.current) sizes.observe(host.current);
    window.addEventListener("resize", lift);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      sizes.disconnect();
      window.removeEventListener("resize", lift);
    };
  }, [selecting, showsBar, dismissSelection]);
  // Only once the book is open: before that the page can neither turn nor light a word (coming back
  // to a book still read aloud, the bar would show while the book opens, and its calls would fail).
  // (Opened or failed: a book that could not open still shows the bar, so × can stop its audio.)
  const ready = status !== "loading";
  const { stopListening } = useReadAloud({
    bookId: props.bookId,
    fileType: props.fileType,
    startListening: props.startListening,
    player,
    setListening,
    showsBar,
    ready,
    refocus,
    view,
    whereCfi,
    turning,
    litCfi,
    spokenPdf,
    spokenBlock,
    focusRef,
    listenBar,
    listenSlot,
  });


  const update = (patch: Partial<ReaderSettings>) => setSettings((s) => (s ? withEink({ ...s, ...patch }) : s));

  // Read it rewritten (M17): a change here is the account's view too (also on the Account page), so every
  // book and device opens in it. Shown at once; if it cannot be saved, it still holds in this reader.
  const showRewritten = (mode: RewrittenMode) => {
    setRewritten((r) => ({ mode, last: mode === "original" ? r.last : mode }));
    if (props.visitor) return;
    void fetch("/api/account/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rewrittenView: mode }),
    }).catch(() => {});
  };
  const paneMode = rewritten.mode !== "original" && screen ? rewritten.mode : null;
  const percent = Math.round(where.fraction * 100);
  // A panel beside the book on a computer (M19): the same conditions that draw each panel below. Contents is not
  // one of them: it stays over the page on the left and closes once a chapter is picked.
  const panelBeside =
    panel === "notes" ||
    panel === "links" ||
    panel === "images" ||
    panel === "ask" ||
    ((panel === "know" || panel === "questions" || panel === "explain" || panel === "xray" || panel === "genealogy") && Boolean(where.cfi)) ||
    (panel === "picture" && Boolean(activePicture?.picture)) ||
    (panel === "rewrite" && Boolean(rewriteAt)) ||
    (panel === "settings" && Boolean(settings));
  const recallRow = Boolean(withRecall);
  // Full screen with nothing open: the book fills the screen and the bars lie over it (reader.module.css, the end).
  const bare = full && panel === "none" && !sidebar && !focusSession;
  // Answering a whole-book focus saves a note: show it (M26 R5).
  useEffect(() => {
    bookAnswered.current = () => void reload();
  });
  const stageClass = [
    styles.stage,
    paneMode === "side" ? styles.stageSide : "",
    panelBeside ? styles.stagePanel : "",
    sidebar ? styles.stageRail : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={root}
      className={(settings ? readerClass(settings) : styles.reader) + withRecall}
      data-testid="reader"
      data-cfi={where.cfi ?? ""}
      data-status={status}
      data-focus-session={focusSession ? "" : undefined}
      data-fullscreen={full ? "" : undefined}
      data-bare={bare ? "" : undefined}
      data-idle={bare && idle ? "" : undefined}
    >
      {focusSession ? (
        <FocusStrip session={focusSession} onLeave={() => setFocusLeaving(true)} onStay={() => focusWait("DELETE")} />
      ) : (
      <ReaderBar title={props.title} author={props.author} visitor={props.visitor} panel={panel} setPanel={setPanel} canFull={canFull} full={full} toggleFull={toggleFull} sidebar={sidebar} />
      )}

      {/* M28 S3: a row of its own between the bar and the book, so the strip never covers the page's first lines. */}
      {recallRow ? (
        <div className={styles.recallSlot}>
          {bookFocus.focus ? (
            <BookFocusLine session={bookFocus.focus} onLeave={() => bookFocus.setLeaving(true)} onStay={() => bookFocus.wait("DELETE")} />
          ) : null}
          {props.recall && status === "ready" && !elsewhere ? (
            <WhereWereWeStrip bookId={props.bookId} recall={props.recall!} onSeeMissed={() => setPanel("explain")} onSaved={() => void reload()} />
          ) : null}
        </div>
      ) : null}
      {genealogy ? (
        <GenealogyView
          data={genealogy.data}
          view={genealogy.view}
          focus={genealogy.focus}
          onClose={() => setGenealogy(null)}
          onGo={(cfi) => void view.current?.goTo(cfi)}
          also={props.visitor ? undefined : alsoIn}
        />
      ) : null}
      {xrayCard ? (
        <XrayCard
          bookId={props.bookId}
          cfi={where.cfi}
          entryId={xrayCard}
          onClose={() => setXrayCard(null)}
          onGo={(cfi) => void view.current?.goTo(cfi)}
          onGenealogy={openGenealogy}
          onAll={() => {
            setXrayCard(null);
            setPanel("xray");
          }}
        />
      ) : null}
      {/* With Focus on, the X-ray's dotted underlines are quieter too (xray-marks.ts): a custom highlight cannot dim them (.stage[data-focus]). */}
      <div ref={stage} className={stageClass} data-focus={settings && settings.focus !== "off" ? "" : undefined}>
        <button type="button" className={`${styles.turn} ${styles.turnPrev}`} aria-label="Previous page" onClick={() => turnRef.current("prev")}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M11 3 5 9l6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        {/* Covered by the rewrite alone: kept open (and its turns working) but out of reach. */}
        <div ref={host} className={styles.host} inert={paneMode === "rewritten"} />
        {/* Focus (M21): the ruler's band, over the book and taking no clicks (Reader.module.css, .lens). */}
        <div className={styles.lensClip} aria-hidden="true" hidden={paneMode === "rewritten"}>
          <div ref={lensEl} className={styles.lens} data-testid="ruler" />
        </div>
        <button type="button" className={`${styles.turn} ${styles.turnNext}`} aria-label="Next page" onClick={() => turnRef.current("next")}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="m7 3 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <ReaderNotices
          status={status}
          downloaded={downloaded}
          elsewhere={elsewhere}
          setElsewhere={setElsewhere}
          ownPlaces={ownPlaces}
          view={view}
          notSaved={notSaved}
          setNotSaved={setNotSaved}
          notesFailed={notesFailed}
          setNotesFailed={setNotesFailed}
        />
        {paneMode && screen ? (
          <RewrittenPane bookId={props.bookId} from={screen.from} to={screen.to} mode={paneMode} onMode={showRewritten} turn={turn} setTurn={setTurn} />
        ) : null}

        {/* The sidebar (sidebar.ts): the reading tools in a rail on the right; a panel opens beside it. */}
        {sidebar ? (
          <ReaderRail
            rail={rail}
            visitor={!!props.visitor}
            panel={panel}
            setPanel={setPanel}
            notes={notes}
            rewritten={rewritten}
            showRewritten={showRewritten}
            bookmarkHere={bookmarkHere}
            toggleBookmark={toggleBookmark}
            bookFocus={bookFocus}
            setFocusStart={setFocusStart}
          />
        ) : null}

        {/* One panel at a time. On a computer it sits in a column beside the book (M19), never over it. */}
        {panel === "notes" ? (
          <NotesPanel
            bookId={props.bookId}
            title={props.title}
            author={props.author}
            themeEl={() => root.current}
            items={notes}
            activeId={activeId}
            onGo={(a) => {
              const v = view.current;
              if (a.cfi) void v?.goTo(a.cfi);
              // A note from the other version not found here yet: its printed page (it is found when the page is shown).
              else if (a.crossed && props.fileType === "pdf") void v?.goTo(`epubcfi(/6/${a.crossed.page * 2})`);
              else if (a.crossed) {
                const href = v?.book.pageList?.find((item) => item.label === String(a.crossed!.page))?.href;
                if (href) void v?.goTo(href);
              }
            }}
            onSave={saveNote}
            onDelete={(a) => orSay(() => removeNote(a), "", "Not removed")}
            removed={removed?.note ?? null}
            onUndo={() => void orSay(undoRemove, "", "Not brought back")}
            notSaved={refused.map((w) => describeRefused(w, notes))}
            onDismiss={(id) => void dismissRefused(id)}
            onAddBookNote={addBookNote}
          />
        ) : null}

        {panel === "know" && where.cfi ? (
          <NeedToKnowPanel key={where.chapter} bookId={props.bookId} cfi={where.cfi} onTab={setPanel} visitor={Boolean(props.visitor)} />
        ) : null}
        {panel === "questions" && where.cfi ? (
          <QuestionsPanel key={where.chapter} bookId={props.bookId} cfi={where.cfi} onTab={setPanel} visitor={Boolean(props.visitor)} />
        ) : null}
        {panel === "ask" ? (
          <AskPanel
            bookId={props.bookId}
            onTab={setPanel}
            onGo={(cfi, close) => {
              void view.current?.goTo(cfi);
              if (close) setPanel("none");
            }}
          />
        ) : null}

        {panel === "explain" && where.cfi ? (
          <ExplainPanel
            key={where.chapter}
            bookId={props.bookId}
            cfi={where.cfi}
            onTab={setPanel}
            onGo={(cfi, close) => {
              void view.current?.goTo(cfi);
              if (close) setPanel("none");
            }}
            onSaved={() => void reload()}
          />
        ) : null}

        {panel === "xray" && where.cfi ? (
          <XrayPanel bookId={props.bookId} cfi={where.cfi} onPage={onPage} onTab={setPanel} onGo={(cfi) => void view.current?.goTo(cfi)} onGenealogy={openGenealogy} />
        ) : null}

        {panel === "genealogy" && where.cfi ? (
          <GenealogyPanel bookId={props.bookId} cfi={where.cfi} onTab={setPanel} onOpen={(data, v, focus) => setGenealogy({ data, view: v, focus })} />
        ) : null}

        {panel === "links" ? <CrossLinksPanel links={links} /> : null}

        {panel === "images" ? (
          <ImagesPanel key={imagesFor} bookId={props.bookId} initialQuery={imagesFor} onPin={imagesAt ? pinPicture : undefined} />
        ) : null}

        {panel === "picture" && activePicture?.picture ? (
          <PictureCard picture={activePicture.picture} url={activePicture.pictureUrl} quote={activePicture.quote.exact} />
        ) : null}

        {panel === "rewrite" && rewriteAt ? <RewritePanel key={rewriteAt} bookId={props.bookId} cfi={rewriteAt} /> : null}

        {panel === "contents" ? (
          <ContentsPanel bookId={props.bookId} visitor={!!props.visitor} view={view} toc={toc} pageCount={pageCount} where={where} percent={percent} setPanel={setPanel} />
        ) : null}

        {panel === "settings" && settings ? (
          <SettingsPanel
            bookId={props.bookId}
            fileUrl={props.fileUrl}
            fileType={props.fileType}
            settings={settings}
            setSettings={setSettings}
            update={update}
            twoPagesOff={twoPagesOff}
            setShortcuts={setShortcuts}
            figures={props.figures}
            citations={props.citations}
            ownKeys={props.ownKeys}
            visitor={!!props.visitor}
          />
        ) : null}
      </div>

      {/* Between the book and the foot, so it never covers the page's last lines. */}
      {showsBar ? <div ref={listenSlot} className={styles.listenSlot} /> : null}

      <ReaderFoot
        where={where}
        percent={percent}
        links={links}
        panel={panel}
        setPanel={setPanel}
        edition={props.edition}
        scanPage={scanPage}
        visitor={!!props.visitor}
        listening={listening}
        setListening={setListening}
        stopListening={stopListening}
        dismissSelection={dismissSelection}
      />

      {selection && !props.visitor ? (
        <SelectionBar
          ref={selectionBar}
          bookId={props.bookId}
          selection={selection}
          title={props.title}
          author={props.author}
          themeEl={() => root.current}
          onHighlight={(color, body) => orSay(() => highlight(color, body), body)}
          onVoiceNote={saveVoiceNote}
          onSticker={(sticker) => orSay(() => addSticker(sticker))}
          onDrawing={saveDrawing}
          onImages={() => {
            setImagesFor(selection.exact.slice(0, 80));
            setImagesAt(selection);
            clearSelection();
            setPanel("images");
          }}
          onRewrite={() => {
            setRewriteAt(selection.cfi);
            clearSelection();
            setPanel("rewrite");
          }}
          onClose={clearSelection}
          onBusy={onSelectionBusy}
        />
      ) : null}

      <ShortcutsDialog open={shortcuts} onClose={() => setShortcuts(false)} />
      <FigureView figure={figure} onClose={() => setFigure(null)} />
      <TableView table={wholeTable} onClose={() => setWholeTable(null)} />
      <EquationView bookId={props.bookId} equation={equation} onClose={() => setEquation(null)} />
      <StartFocusDialog
        open={focusStart}
        onStart={beginFocus}
        onStartBook={async (question, days) => {
          await bookFocus.start(question, days);
          setFocusStart(false);
        }}
        onCancel={() => setFocusStart(false)}
      />
      <LeaveFocusDialog
        key={`leave-${focusSession?.id ?? ""}`}
        session={focusSession}
        open={Boolean(focusSession) && focusLeaving && !focusEnding}
        waitMinutes={focusWaitMinutes}
        onAnswer={answerFocus}
        onWait={() => focusWait("POST")}
        onCancel={() => setFocusLeaving(false)}
      />
      <EndFocusDialog key={focusSession?.id ?? ""} session={focusSession} open={Boolean(focusSession) && focusEnding} onSave={answerFocus} onSkip={() => finishFocus()} />
      {/* Whole-book focus (M26 R5): the same two dialogs, with the whole book's ways out (150 words, or 24 hours). */}
      <LeaveFocusDialog
        key={`leave-book-${bookFocus.focus?.id ?? ""}`}
        session={bookFocus.focus}
        open={Boolean(bookFocus.focus) && bookFocus.leaving && !bookFocus.ending}
        waitMinutes={bookFocus.waitMinutes}
        minWords={bookFocus.minWords}
        testId="book-focus-leave"
        onAnswer={bookFocus.answer}
        onWait={() => bookFocus.wait("POST")}
        onCancel={() => bookFocus.setLeaving(false)}
      />
      <EndFocusDialog
        key={`end-book-${bookFocus.focus?.id ?? ""}`}
        session={bookFocus.focus}
        open={Boolean(bookFocus.focus) && bookFocus.ending}
        heading={bookFocus.heading}
        testId="book-focus-end"
        onSave={bookFocus.answer}
        onSkip={bookFocus.skip}
      />
    </div>
  );
}
