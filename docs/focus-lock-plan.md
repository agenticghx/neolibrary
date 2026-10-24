# A focus you cannot walk away from, then a whole book (M26 R4 and R5)

Written 2026-10-18 for Samuel, and for the Claude session that builds it.
Asked for by Samuel on 2026-10-18 ("the block is not enough … can focused
session be extended to full book?"). Nothing is built yet.

## Why, and what is possible

The focus session (M26 R3, live since 2026-10-18) hides everything but the
page, but one click on **End now** ends it. The running session is also
stored only in the browser that started it (`lib/reader/focus-session.ts`,
`localStorage`), so opening the site on a phone shows the whole library.

A web page can never make quitting impossible. Closing the tab, opening
another browser or picking up another device always works. What the app can
do is:

1. know about the running session on the server, so **every** page on
   **every** device sends you back to the focused book;
2. make the way out slow or earned, never a single click;
3. record how each session ended, so quitting leaves a mark.

A real device lock has to come from the phone or computer itself. On an
iPhone, *Guided Access* (Settings → Accessibility) keeps the phone in one app
until someone types a passcode. If a trusted person sets that passcode, the
lock is close to unbreakable. The app can explain how to turn it on, but it
cannot turn it on for you.

**One safety rule for everything below:** you can never be trapped. Every
lock has a way out that needs nobody else (the wait), and every session has
an upper limit (180 minutes for a sitting, 30 days for a whole book).

## The ways out (Samuel's choice; defaults until he says otherwise)

On 2026-10-18 Claude suggested a mix of 1 and 2 below, and Samuel said to plan
it. Options 3 and 4 are written down for later.

| # | Way out | Default |
|---|---|---|
| 1 | **Wait.** End now starts a countdown; the page stays readable meanwhile, and you can cancel the countdown and keep reading. | 10 minutes for a sitting, 24 hours for a whole book |
| 2 | **Earn it.** Write your answer to the question (at least 40 words); the session ends at once as "answered". | on |
| 3 | **A trusted person releases you.** Someone you invited approves the request when they next sign in. The site sends no email, so you tell them yourself. | later, at Samuel's word |
| 4 | **It shows.** Reading stats shows how each session ended: on time, answered, after a wait, or left open. | on (cheap, part of R4b) |

## R4 · A focus session you cannot walk away from

**R4a · The running session lives on the server.**
- New table `focus_sessions`: the reader, the book, the question, its kind
  (`sitting` or `book`), when it started, when it ends, when a wait ends if
  one was asked for, when it actually ended, and how it ended (`time`,
  `answered`, `waited`, `released`). Migration `0029_focus_sessions_live`,
  with its reverse step and a production backup before it runs.
- Routes: start a session, read the current one, ask to end, cancel a wait,
  end. A reader can run only one session at a time (enforced by the
  database, not just the page).
- The reader takes the session from the server. `localStorage` stays as a
  copy, so a moment offline does not lose the timer.
- While a session runs, every page under the signed-in app (Home, Library,
  Search, Paths, Review, Stats, another book's reader) sends you to the
  focused book. The check is one database read in `app/(app)/layout.tsx` and
  the reader's layout. The routes that serve another book's file answer
  "423 Locked", so an old open tab cannot keep reading. Account and Sign out
  still work, and signing out does not end the session.
- The sittings and the answer note work as they do now (R3), keyed by the
  server's session id.
- **As built (2026-10-18, branch `m26-r4a-focus-server`):** the table also
  keeps the minutes and the answer note's id (chosen at the start, so a retried
  save makes one note). A fifth way a session ends, `early`, records R4a's
  one-click End now (R4b removes it). Each route that serves a book's file
  (`/api/files`, the file link, both audio routes) answers 423; covers and
  pictures are not locked. The redirect is checked in `app/(app)/layout.tsx`
  and in the reader's page (not its layout: a layout is not run again when the
  command palette opens another book), and a small `FocusGuard` asks again
  when a link inside the app is followed. While a session runs, Account shows
  it with a link back and a Sign out button, because on a phone the account
  menu is on Home. Ask-to-end and cancel-a-wait are R4b's routes.
- **Done when:** a browser test starts a 2-minute session; visiting Library,
  Search and another book lands back on the focused book; a second browser
  signed in as the same reader lands there too; a reload keeps the time left;
  once the time is up, every page opens normally. The R3 tests still pass.
  Unit tests cover the one-session-at-a-time rule and the redirect rule.

**R4b · The ways out, and the mark they leave.**
- **End now** is replaced by **Leave early…**, which opens a dialog with two
  choices: *Write my answer now* (option 2; the Save button stays off until
  the answer has 40 words) and *Start the 10-minute wait* (option 1). While
  the wait runs, the strip shows "Leaving in 9:12 · Keep reading", and Keep
  reading cancels it. The wait's end is stored on the server, so a reload or
  another device does not skip it.
- When the wait reaches zero, the usual "Did you answer it?" dialog opens
  (an answer is optional then, as today).
- Reading stats shows how each session ended, next to its question.
- The start dialog gets a line "Lock this phone to the page too", which
  opens short steps for Guided Access (iPhone) and screen pinning (Android).
  It only explains; the app changes no setting.
- **Done when:** browser tests: (1) a 30-word answer cannot leave and a
  40-word answer can, and the note is saved; (2) the wait (shortened to
  seconds in tests) survives a reload, Keep reading cancels it, and at zero
  the answer dialog opens; (3) Reading stats shows "answered" and "after a
  wait". Screenshots: phone and desktop, light and dark.
- **As built (2026-10-19, branch `m26-r4b-ways-out`; Samuel asked for it
  before giving a verdict on R4a):** no migration (R4a's table already had
  `wait_ends_at`). The server decides every ending, so no single request can
  skip a way out: `/api/focus/end` without an answer is refused (409) until
  the time is up or the wait has run out, and an answer saved before then
  needs 40 words (checked before the note is saved; words are runs of letters
  or digits, so "don't" and "1890s" count once). New routes: `POST
  /api/focus/wait` starts the wait (asking again keeps the first one) and
  `DELETE /api/focus/wait` is Keep reading. Once the wait runs out the session
  stops locking other pages, as when the time is up, and ends as `waited`;
  an answer saved after the wait also ends it as `waited` (that was the way
  out). A wait that ran out with no device open is closed as `waited` when
  the next session starts. Reading stats says "On time", "Answered early",
  "Left after a wait", or "Ended early" (R3/R4a sessions). The reader asks
  the server again each time its tab comes back to the front, so a wait
  started or a session ended on another device shows up. If this device's
  clock runs ahead and the server refuses the end, the strip comes back with
  the server's time. `FOCUS_WAIT_MS` (30 seconds in the browser tests) changes
  the wait's length; unset, it is 10 minutes.

## R5 · Whole-book focus

Pick one book and read only it, for days or until its last page.

- **Start:** from the book's page or the reader, *Focus on this book*: the
  question you are reading the whole book to answer, and how long: until the
  last page, or until a date (at most 30 days; "until the last page" also
  stops at 30 days).
- **While it runs:**
  - Home, Library, Search, Shelf and the command palette show only that
    book, with one line: "Focusing on *The Grid* until 12 November · Leave
    early…".
  - Opening any other book shows a short page saying the same, with a link
    back to your book (the R4a redirect, for every book but this one).
  - Daily review shows only this book's cards. Ask, rewrites and Explain it
    back already work one book at a time.
  - Import and Paths stay reachable but cannot open another book.
  - Each time you open the book, the reader offers an optional sitting
    session (R3/R4) with the book's question shown above it.
- **The end:** when you reach the last page, or the date arrives, the app
  asks the book's question again and saves your answer as a note (a Daily
  review card). Leaving early uses R4b's ways out with the whole-book
  defaults: a 24-hour wait, or an answer of at least 150 words.
- **Reading stats:** a card for each whole-book focus: dates, days read,
  minutes, sittings, how it ended, and the answer.
- **Built on R4a:** the same table, with kind `book` and no per-minute timer.
  No second migration unless R4a's columns fall short.
- **Done when:** a browser test starts a whole-book focus on a public-domain
  book; Home and Library show only that book; another book's reader shows the
  "focusing on" page; Daily review holds only that book's cards; jumping to
  the last page brings up the question; the answer appears as a note, a
  review card and a card on Reading stats. Leaving early with a short answer
  is refused, and the 24-hour wait (shortened in tests) works. Screenshots:
  phone and desktop, light and dark.
- **As built, part one (R5a, 2026-10-24, branch `m26-r5-whole-book-focus`;
  Samuel tried R4 on *The Pay Off* and said "we can go ahead"):** R5 is split
  in two pull requests: R5a (this) is the focus itself; R5b is Daily review
  showing only the focused book's cards, and the card on Reading stats.
  - **Start:** the reader's clock button opens Focus session, which now asks
    first: *This sitting* or *The whole book*. The whole book takes a question
    and a number of days (1 to 30, 14 by default). There is no separate "until
    the last page" choice: reaching the last page always ends it, so "until the
    last page" is simply 30 days.
  - **One session at a time still:** no timed sitting inside a whole-book
    focus (the clock button is hidden while one runs). Allowing both at once
    needs the database's one-open-session rule changed; left for later.
  - **What locks:** Home, Library, Search, Shelf, Covers and any other book's
    page or reader go to the focused book's own page (not a filtered list:
    simpler and harder to get wrong, and the page shows only that book). Review,
    Stats, Paths, Import, Account and the rest open, with a one-line banner
    naming the book and the day the focus ends. Other books' files answer 423
    Locked, as in R4a. A scanned book and its text edition count as one book
    throughout (both open; the banner and redirects use the scan's page). On a
    phone, Daily review, Reading stats and Account are reached from the menu on
    Home, which now goes to the book's page, so the banner links all three.
  - **Known gap (fixed in R5b):** a book whose last page was reached but whose
    question was not answered (the tab was closed) kept the lock until the days
    ran out. Since R5b it stops locking as soon as the last page is reached; the
    question still waits in the reader, and the next session started closes it
    as finished.
  - **In the reader:** it reads as usual (top bar, panels, "Where were we?"),
    with one line above the page: the question, "Only this book until 7
    November", and Leave early…. The ways out are R4b's with the whole-book
    numbers: an answer of at least 150 words, or a 24-hour wait
    (`FOCUS_BOOK_WAIT_MS` shortens it in tests), cancelled by Keep reading.
  - **The end:** when the reader's place reaches 98 % of the book
    (`FINISHED_AT`), the reader saves the place, asks the server, and the server
    (reading the saved place, on either edition) says the book is finished; the
    question comes back ("You reached the end. Did you answer it?") and the
    answer is a note on the book. The session ends as `finished`, a new way to
    end, added by migration 0033 (with its reverse step: a finished focus becomes
    "time"). When the days run out the same question comes, as "The days are up".

- **As built, part two (R5b, 2026-10-24, branch `m26-r5b-review-stats`):**
  - **Daily review** holds only the focused book's cards (either edition)
    while a whole-book focus runs; the sidebar's "due today" counts the same.
    The other cards keep their dates and come back when the focus ends. A
    sitting does not narrow the review (it locks every other page anyway).
  - **Reading stats** has a "Whole-book focus" section (only once there is one):
    for each, the book, its dates ("to 7 Nov (running)" while it runs), how it
    ended ("Finished the book", "Answered early", "Left after a wait", "On
    time"), the days read, the time and the sittings in it (any sitting on
    either edition that began between its start and its end; a sitting with
    nothing read is not counted), the question and the answer.
  - A book read to its end stops locking at once (Samuel, 2026-10-24: "go for
    it", to the open questions), even before its question is answered.

## Order

R4a, then R4b, then R5. Each is one pull request. R4a and R5 change what you
see on every page, so each needs Samuel's verdict on the live site before the
next one ships.

## Decisions with defaults (none blocks the work)

1. Ways out: wait plus earned answer (as above). Trusted person later.
2. The wait: 10 minutes for a sitting, 24 hours for a whole book.
3. The earned answer: at least 40 words for a sitting, 150 for a book. Words
   are counted, not judged; asking Claude to judge the answer (as Explain it
   back does) would cost money for every exit.
4. Whole-book upper limit: 30 days.
5. During a whole-book focus, Import stays open (new books are added but stay
   hidden until the focus ends).
