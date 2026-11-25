import Link from "next/link";
import type { Annotation } from "@/lib/library/annotations";
import { availabilityLabel } from "@/lib/library/availability";
import { KIND_WORDS, partsWord } from "@/lib/library/path-words";
import type { PathView as PathData, PillarView, SlotView } from "@/lib/library/paths";
import { Cover } from "./Cover";
import { TargetNoteForm, TargetNoteRemove } from "./TargetNoteForm";
import styles from "./PathView.module.css";

const GROUPS: Record<string, string> = {
  main: "The eighteen systems",
  finance: "Money and credit",
  blindspot: "Blindspots",
  suggested: "Suggested additions",
};

const HIDDEN_MACHINERY_ART = new Set([
  "electricity-grid",
  "payments",
  "shipping",
  "food",
  "construction",
  "cables",
  "public-health",
  "courts",
  "water",
  "semiconductors",
  "materials",
  "oil-gas",
  "systems-fail",
  "insurance",
  "waste",
  "precision",
  "land-zoning",
  "drugs",
  "banking",
  "capital-markets",
  "time-gps",
  "legibility",
  "land-transport",
  "aviation",
  "tax-state",
  "maintenance",
  "administrative-state",
  "accounting",
  "housing",
  "from-the-replies",
  "geospatial",
  "more-blindspots",
  "money-markets-dollar",
  "master-key",
]);

function pillarArtUrl(pathSlug: string, pillarSlug: string): string | null {
  return pathSlug === "hidden-machinery" && HIDDEN_MACHINERY_ART.has(pillarSlug)
    ? `/paths/hidden-machinery/${pillarSlug}.jpg`
    : null;
}

const tone = (s: SlotView) => (s.kind === "E" ? "green" : "navy");

/** Compact icons so N (Narrative) and E (Engineering) tuck onto cover corners instead of taking a row above. */
function KindIcon({ kind }: { kind: SlotView["kind"] }) {
  if (kind === "E") {
    return (
      <svg className={styles.kindSvg} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    );
  }
  return (
    <svg className={styles.kindSvg} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg className={styles.noteSvg} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/** A title's cover; the N or E letter sits cleanly above the cover in PathView so it never blocks cover artwork. */
function SlotCover({ slot, current }: { slot: SlotView; current: boolean }) {
  return (
    <Cover
      title={slot.book.title}
      tone={tone(slot)}
      available={slot.book.available}
      size="sm"
      href={`/books/${slot.book.id}`}
      progress={slot.book.progress}
      current={current}
      imageUrl={slot.book.coverUrl}
    />
  );
}

/** Notes on a pillar or the whole path: a quiet disclosure with the notes and a box to add one. */
function TargetNotes({
  targetType,
  targetId,
  label,
  notes,
  iconOnly = false,
}: {
  targetType: "pillar" | "path";
  targetId: string;
  label: string;
  notes: Annotation[];
  iconOnly?: boolean;
}) {
  const summaryText = notes.length ? `Notes (${notes.length})` : "Add note";
  return (
    <details className={iconOnly ? `${styles.notes} ${styles.notesIcon}` : styles.notes} open={notes.length > 0 || undefined}>
      <summary className={iconOnly ? styles.notesIconSummary : styles.notesSummary} title={summaryText}>
        {iconOnly ? (
          <>
            <NoteIcon />
            {notes.length ? (
              <span className={styles.noteCount} aria-hidden="true">
                {notes.length}
              </span>
            ) : null}
            <span className={styles.notesIconLabel}>{summaryText}</span>
          </>
        ) : (
          summaryText
        )}
      </summary>
      {notes.length ? (
        <ul className={styles.noteList}>
          {notes.map((n) => (
            <li key={n.id} className={styles.note}>
              <p className={styles.noteText}>{n.body}</p>
              <TargetNoteRemove id={n.id} body={n.body} />
            </li>
          ))}
        </ul>
      ) : null}
      <TargetNoteForm targetType={targetType} targetId={targetId} label={label} />
    </details>
  );
}

function Pillar({
  pillar,
  here,
  notes,
  readingList,
  artUrl,
}: {
  pillar: PillarView;
  here: boolean;
  notes: Annotation[];
  readingList: boolean;
  artUrl: string | null;
}) {
  const core = pillar.slots.filter((s) => s.kind === "N" || s.kind === "E");
  const extras = pillar.slots.filter((s) => s.kind === "extra");
  const showExtrasAsCovers = core.length === 0;
  return (
    <section
      className={artUrl ? `${styles.pillar} ${styles.pillarWithArt}` : styles.pillar}
      aria-labelledby={`p-${pillar.slug}`}
      data-testid="pillar"
    >
      {artUrl ? (
        <header className={styles.banner}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={artUrl} alt="" className={styles.bannerImg} decoding="async" />
          {here ? (
            <p className={styles.herePill}>
              <span className={styles.dot} aria-hidden="true" />
              You are here
            </p>
          ) : null}
          <div className={styles.bannerOverlay}>
            {pillar.number ? <span className={styles.bannerNumber}>{String(pillar.number).padStart(2, "0")}</span> : null}
            <h3 id={`p-${pillar.slug}`} className={styles.bannerTitle}>
              {pillar.title}
            </h3>
          </div>
        </header>
      ) : (
        <>
          {here ? (
            <p className={styles.here}>
              <span className={styles.dot} aria-hidden="true" />
              You are here
            </p>
          ) : null}
          <header className={styles.pillarHead}>
            {pillar.number ? <span className={styles.number}>{String(pillar.number).padStart(2, "0")}</span> : null}
            <h3 id={`p-${pillar.slug}`} className={readingList ? styles.pillarTitle : `${styles.pillarTitle} ${styles.ownPillarTitle}`}>
              {pillar.title}
            </h3>
            {pillar.question ? <p className={styles.question}>{pillar.question}</p> : null}
          </header>
        </>
      )}
      <div className={artUrl ? styles.pillarBody : styles.pillarFlow}>
        {artUrl && pillar.question ? <p className={styles.question}>{pillar.question}</p> : null}
        {readingList ? null : pillar.slots.length ? (
          // Your own Path: every title in the order you gave it, each with how to read it (M14 step 5).
          <ol className={styles.ownTitles} role="list">
            {pillar.slots.map((s) => (
              <li key={s.id} className={styles.slot}>
                <span className={styles.how}>{KIND_WORDS[s.kind]}</span>
                <SlotCover slot={s} current={s.id === pillar.currentSlotId && pillar.status !== "not-started"} />
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.noTitles}>No titles yet. Edit the path to add some.</p>
        )}
        {readingList && core.length ? (
          <ol className={artUrl ? `${styles.pair} ${styles.pairCentered}` : styles.pair}>
            {core.map((s) => (
              <li key={s.id} className={styles.slot}>
                {/* The reading list's N/E badge: compact corner icon on the cover, keeping "N"/"E" as first-child text for tests and screen readers. */}
                <span
                  className={styles.kindBadge}
                  aria-hidden="true"
                  title={s.kind === "N" ? "N · Narrative, read first" : "E · Engineering, read second"}
                >
                  <KindIcon kind={s.kind} />
                  <span className="visually-hidden">{s.kind}</span>
                </span>
                <span className="visually-hidden">{s.kind === "N" ? "Narrative, read first" : "Engineering, read second"}</span>
                <SlotCover slot={s} current={s.id === pillar.currentSlotId && pillar.status !== "not-started"} />
              </li>
            ))}
          </ol>
        ) : null}
        {readingList && extras.length ? (
          showExtrasAsCovers ? (
            <ul className={styles.extraCovers}>
              {extras.map((s) => (
                <li key={s.id}>
                  <SlotCover slot={s} current={false} />
                </li>
              ))}
            </ul>
          ) : (
            <details className={styles.extras}>
              <summary>
                {extras.length} more {extras.length === 1 ? "book" : "books"}
              </summary>
              <ul>
                {extras.map((s) => (
                  <li key={s.id}>
                    <Link href={`/books/${s.book.id}`}>{s.book.title}</Link>
                    <span className={styles.author}> · {s.book.author}</span>
                    <span className={styles.label}> · {availabilityLabel(s.book.available)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )
        ) : null}
        {pillar.slots.some((s) => s.book.unverified) ? (
          <p className={styles.unverified}>Agent suggestions, not catalog-checked</p>
        ) : null}
        <TargetNotes
          targetType="pillar"
          targetId={pillar.id}
          label={`Note on ${pillar.title}`}
          notes={notes}
          iconOnly={Boolean(artUrl)}
        />
      </div>
    </section>
  );
}

export function PathView({ path, notes = new Map(), editHref }: { path: PathData; notes?: Map<string, Annotation[]>; editHref?: string }) {
  // A built-in reading list keeps its own words (pillars, the eighteen systems,
  // the master key) and cannot be edited; a Path the reader made has sections (M14 step 5, D10).
  const readingList = path.readingList;
  const numbered = path.pillars.filter((p) => p.number > 0);
  const master = path.pillars.filter((p) => p.group === "master");
  const groups = readingList
    ? Object.keys(GROUPS)
        .map((g) => ({ key: g, title: GROUPS[g], pillars: path.pillars.filter((p) => p.group === g) }))
        .filter((g) => g.pillars.length)
    : [{ key: "sections", title: "Sections", pillars: path.pillars.filter((p) => p.group !== "master") }].filter((g) => g.pillars.length);
  const done = numbered.filter((p) => p.status === "done").length;
  const hereIndex = numbered.findIndex((p) => p.id === path.currentPillarId);

  return (
    <div className={styles.path}>
      <header className={styles.head}>
        {editHref && !readingList ? (
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{path.title}</h1>
            <Link href={editHref} className={styles.edit}>
              Edit path
            </Link>
          </div>
        ) : (
          <h1 className={styles.title}>{path.title}</h1>
        )}
        <p className={styles.subtitle}>
          {readingList
            ? `${numbered.length} pillars · Read N, then E · `
            : `${numbered.length} ${numbered.length === 1 ? "section" : "sections"} · `}
          {path.available} available, {path.notYet} not available yet
        </p>
        {path.description ? <p className={styles.description}>{path.description}</p> : null}
        <TargetNotes targetType="path" targetId={path.id} label={`Note on ${path.title}`} notes={notes.get(path.id) ?? []} />
        {numbered.length ? (
          <ol className={styles.track} aria-label={`${done} of ${numbered.length} ${partsWord(readingList, numbered.length)} finished`}>
            {numbered.map((p, i) => {
              const prevGroup = i > 0 ? numbered[i - 1]!.group : p.group;
              const groupStart = i > 0 && p.group !== prevGroup;
              const tip = `${String(p.number).padStart(2, "0")} · ${p.title}`;
              return (
                <li
                  key={p.id}
                  data-group-start={groupStart || undefined}
                  className={[
                    styles.stop,
                    p.status === "done" ? styles.stopDone : "",
                    p.status === "reading" ? styles.stopStarted : "",
                    i === hereIndex ? styles.stopHere : "",
                  ].join(" ")}
                >
                  {/* Each stop goes to its part of the page (M20): the page is long, 29 pillars on a reading list. */}
                  <a
                    href={`#p-${p.slug}`}
                    className={styles.stopLink}
                    title={tip}
                    data-tip={tip}
                    aria-label={[p.title, p.status === "done" ? "finished" : "", i === hereIndex ? "you are here" : ""].filter(Boolean).join(", ")}
                    aria-current={i === hereIndex ? "location" : undefined}
                  />
                </li>
              );
            })}
          </ol>
        ) : null}
      </header>

      {!path.pillars.length ? <p className={styles.description}>No sections yet. Edit the path to add some.</p> : null}

      {groups.map((g) => (
        <section key={g.key} className={styles.group} aria-labelledby={`g-${g.key}`}>
          <h2 id={`g-${g.key}`} className={styles.groupTitle}>
            {g.title}
          </h2>
          <div className={styles.grid}>
            {g.pillars.map((p) => (
              <Pillar
                key={p.id}
                pillar={p}
                here={p.id === path.currentPillarId}
                notes={notes.get(p.id) ?? []}
                readingList={readingList}
                artUrl={pillarArtUrl(path.slug, p.slug)}
              />
            ))}
          </div>
        </section>
      ))}

      {master.map((m) => {
        const masterArt = pillarArtUrl(path.slug, m.slug);
        return (
          <section key={m.id} className={masterArt ? `${styles.master} ${styles.masterWithArt}` : styles.master} aria-labelledby="master-key">
            {masterArt ? (
              <div className={styles.masterBanner}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={masterArt} alt="" className={styles.bannerImg} decoding="async" />
              </div>
            ) : null}
            <div className={styles.masterContent}>
              <div>
                <h2 id="master-key" className={styles.masterTitle}>
                  Master key
                </h2>
                <p className={styles.masterLede}>Read last. {m.question}</p>
              </div>
              {m.slots.map((s) => (
                <SlotCover key={s.id} slot={s} current={false} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
