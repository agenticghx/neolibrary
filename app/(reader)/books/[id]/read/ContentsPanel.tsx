"use client";

import { type RefObject } from "react";
import { FindInBook } from "./FindInBook";
import { JumpTo, TocList, type TocItem } from "./ReaderControls";
import { pdfPage, type FoliateView, type ReaderPanel } from "./reader-helpers";
import styles from "./reader.module.css";

/**
 * The Contents panel: go to a page or a percentage, find words in the book, and the table of contents. Each choice
 * goes there and closes the panel. Moved out of Reader.tsx as it was (the version 2 split).
 */
export function ContentsPanel(props: {
  bookId: string;
  /** A visitor cannot search the book (M34). */
  visitor?: boolean;
  view: RefObject<FoliateView | null>;
  toc: TocItem[];
  /** A PDF's number of pages; 0 for an EPUB, which is jumped through by percentage. */
  pageCount: number;
  where: { cfi: string | null; chapter: string };
  percent: number;
  setPanel: (panel: ReaderPanel) => void;
}) {
  const { view, toc, pageCount, where, percent, setPanel } = props;
  return (
    <nav className={`${styles.panel} ${styles.panelLeft}`} aria-label="Contents">
      <p className={styles.panelTitle}>Contents</p>
      <JumpTo
        pages={pageCount}
        current={pageCount ? Math.max(pdfPage(where.cfi ?? ""), 0) + 1 : percent}
        onGo={(n) => {
          // A PDF's page n is section n - 1, whose address is epubcfi(/6/2n); an EPUB goes to n% of the book.
          void (pageCount ? view.current?.goTo(`epubcfi(/6/${n * 2})`) : view.current?.goToFraction(n / 100));
          setPanel("none");
        }}
      />
      {props.visitor ? null : (
        <FindInBook
          bookId={props.bookId}
          onGo={(cfi) => {
            void view.current?.goTo(cfi);
            setPanel("none");
          }}
        />
      )}
      <TocList
        items={toc}
        current={where.chapter}
        onPick={(href) => {
          void view.current?.goTo(href);
          setPanel("none");
        }}
      />
    </nav>
  );
}
