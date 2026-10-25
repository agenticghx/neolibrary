import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Get help" };

/**
 * Get help (M33, Samuel's request of 2026-10-23): how to do the important
 * things in the library, in plain English, for a reader who did not build
 * it. One card per part of the app, each with where to find it and what it
 * does; the owner's own tasks last. No data, so it reads the same for
 * everyone.
 */
export default async function HelpPage() {
  const user = await requireUser();
  const admin = user.role === "admin";
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Get help</p>
      <h1 className={styles.title}>How the library works</h1>
      <p className={styles.lede}>
        Neolibrary is a private library for studying on your own: your books on a shelf, read and listened to together, with AI
        help on every page that always says where it came from. Each part below says where to find it and what it does.
      </p>

      <section className={styles.card} aria-labelledby="help-books">
        <h2 id="help-books" className={styles.cardTitle}>
          Your books
        </h2>
        <p className={styles.cardText}>
          <strong>Home</strong> shows what you are reading and the paths you are on; <strong>Library</strong> shows every title, with a
          search box above for words in any book or note. Add a book on the <Link href="/import">Import</Link> page: an EPUB, a PDF
          (scanned or born digital), a Markdown file, or a Google Drive link. Only files you own, without copy protection. A
          title that is on a path but not yet on your shelf waits as a placeholder until its file arrives.
        </p>
      </section>

      <section className={styles.card} aria-labelledby="help-reading">
        <h2 id="help-reading" className={styles.cardTitle}>
          Reading
        </h2>
        <p className={styles.cardText}>
          Open a book and it opens where you left off, on any device. <strong>Aa</strong> in the top bar sets the type size, the
          theme (light, dark, sepia or your device&apos;s own) and pages or scrolling. To turn a page, use the arrows at its sides, the
          arrow keys, or swipe sideways with two fingers on a trackpad or one on a touch screen; in pages, scrolling down or up
          turns it too. <strong>Contents</strong> is the chapter list.
          <strong> Focus</strong> dims everything but the line or paragraph you are on. The footer shows how far you are and, for a
          scanned book, lets you switch between the scan and its text edition.
        </p>
      </section>

      <section className={styles.card} aria-labelledby="help-notes">
        <h2 id="help-notes" className={styles.cardTitle}>
          Notes
        </h2>
        <p className={styles.cardText}>
          Select any words to highlight them, add a note, a spoken note (your words are written down for you), a sticker or a
          handwritten note, or to share the passage. <strong>Notes</strong> in the top bar lists them all. Nothing you write is ever
          overwritten: an edit keeps the old version, and a removed note can be brought back from Your data.
        </p>
      </section>

      <section className={styles.card} aria-labelledby="help-listen">
        <h2 id="help-listen" className={styles.cardTitle}>
          Listening
        </h2>
        <p className={styles.cardText}>
          <strong>Listen</strong> in the footer reads the page aloud and lights each word as it is spoken; it keeps going while you
          move around the library. If you own an audiobook of a title, add it on the Import page with its script and the book
          reads along with it. A made voice costs money, so the app shows the price first and stops at a spending limit.
        </p>
      </section>

      <section className={styles.card} aria-labelledby="help-study">
        <h2 id="help-study" className={styles.cardTitle}>
          Study: the AI tools
        </h2>
        <p className={styles.cardText}>
          <strong>Study</strong> in the top bar opens five tabs. <strong>Need to know</strong> lists what a chapter takes for granted,
          each idea explained in two lines. <strong>Test yourself</strong> asks questions about it, and tells you which sections to
          read again. <strong>Ask</strong> answers a question of yours from the book&apos;s own passages, with the passages quoted.{" "}
          <strong>Explain it back</strong> takes your own summary of a chapter first, then shows the lines you missed or got wrong.{" "}
          <strong>Rewrite</strong> (from any selected paragraph, or the whole book in the Rewritten view) puts the author&apos;s words in plain
          English or Simplified Technical English, a controlled form of English with one meaning per word. Everything written by AI
          sits on a tinted block with a dashed rule and says which model wrote it and when; the book&apos;s words and your own never
          look like that.
        </p>
      </section>

      <section className={styles.card} aria-labelledby="help-xray">
        <h2 id="help-xray" className={styles.cardTitle}>
          Who &amp; what
        </h2>
        <p className={styles.cardText}>
          The fifth Study tab is the book&apos;s X-ray: the people, places, organisations and terms it names, most mentioned so far
          first, each with a trail showing which chapters it appears in. On the page, a name&apos;s first mention in a paragraph has a
          dotted underline, and a strip at the foot names what is on the screen; tap either for a card. The card knows where you
          are: it shows only what the book has said up to here, with a &ldquo;Show everything&rdquo; switch. The names come from the text
          at no cost. <strong>Build the X-ray</strong> reads the book with Claude for the facts: each fact carries the quote it rests on,
          and a fact whose quote is not in the book is dropped. Under the facts: the same name in your other books, and, on
          request, what the world knows of it, labelled as from outside the book.
        </p>
      </section>

      <section className={styles.card} aria-labelledby="help-review">
        <h2 id="help-review" className={styles.cardTitle}>
          Remembering what you read
        </h2>
        <p className={styles.cardText}>
          <Link href="/review">Daily review</Link> shows you cards made from your highlights, your notes, the questions you got wrong
          and what Explain it back found missing, spaced out over days so they stick. <Link href="/stats">Reading stats</Link> measures
          your reading time and speed by sitting and by chapter. A <strong>focus session</strong> (the timer in the reader&apos;s top
          bar) asks what question you are reading to answer, hides everything but the page for a set time, and keeps your answer.
        </p>
      </section>

      <section className={styles.card} aria-labelledby="help-paths">
        <h2 id="help-paths" className={styles.cardTitle}>
          Paths
        </h2>
        <p className={styles.cardText}>
          A <Link href="/paths">path</Link> is a course you set yourself: pillars (the big ideas) with the books that teach each, in order.
          Make your own, or follow one that came with the library. The books you do not have yet show as placeholders.
        </p>
      </section>

      <section className={styles.card} aria-labelledby="help-data">
        <h2 id="help-data" className={styles.cardTitle}>
          Your data, and agents
        </h2>
        <p className={styles.cardText}>
          <Link href="/data">Your data</Link> downloads everything (books&apos; details, paths, notes, AI answers) as one file you can keep
          or bring back, and holds what you removed, in case you want it again. <Link href="/agents">Agent access</Link> makes tokens so
          your own AI agents can use the library through its API; revoke one at any time.
        </p>
      </section>

      {admin ? (
        <section className={styles.card} aria-labelledby="help-owner">
          <h2 id="help-owner" className={styles.cardTitle}>
            For the owner
          </h2>
          <p className={styles.cardText}>
            <Link href="/admin/invites">Invite</Link> lets a trusted person in; <Link href="/admin/costs">Costs</Link> shows what the AI
            and voice services have spent against their limits. A scanned book can be given a <strong>text edition</strong> (a flowing copy
            read page by page from the pictures) from its book page, or on the laptop with the subscription. Book pictures,{" "}
            <Link href="/covers">Covers</Link>, are found for every title and can be chosen by hand. The AI features need an Anthropic key
            on the server; without it, Who &amp; what shows the names from the text, and the book can be read for X-ray on the laptop
            instead.
          </p>
        </section>
      ) : null}
    </main>
  );
}
