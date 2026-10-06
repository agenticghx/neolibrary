import Link from "next/link";
import { addTargetNoteAction, removeNoteAction } from "@/app/(app)/actions";
import type { Annotation } from "@/lib/library/annotations";
import { availabilityLabel } from "@/lib/library/availability";
import { KIND_WORDS, partsWord } from "@/lib/library/path-words";
import type { PathView as PathData, PillarView, SlotView } from "@/lib/library/paths";
import { Cover } from "./Cover";
import styles from "./PathView.module.css";

const GROUPS: Record<string, string> = {
  main: "The eighteen systems",
  finance: "Money and credit",
  blindspot: "Blindspots",
  suggested: "Suggested additions",
};

const tone = (s: SlotView) => (s.kind === "E" ? "green" : "navy");

/** A title's cover; the N or E letter on it belongs to the reading list only (your own Paths say the words). */
function SlotCover({ slot, current, letter = true }: { slot: SlotView; current: boolean; letter?: boolean }) {
  return (
    <Cover
      title={slot.book.title}
      slot={letter ? slot.kind : undefined}
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
function TargetNotes({ targetType, targetId, label, notes }: { targetType: "pillar" | "path"; targetId: string; label: string; notes: Annotation[] }) {
  return (
    <details className={styles.notes} open={notes.length > 0 || undefined}>
      <summary className={styles.notesSummary}>{notes.length ? `Notes (${notes.length})` : "Add note"}</summary>
      {notes.length ? (
        <ul className={styles.noteList}>
          {notes.map((n) => (
            <li key={n.id} className={styles.note}>
              <p className={styles.noteText}>{n.body}</p>
              <form action={removeNoteAction}>
                <input type="hidden" name="id" value={n.id} />
                <button type="submit" className={styles.noteRemove} aria-label={`Remove note: ${n.body.slice(0, 40)}`}>
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
      <form action={addTargetNoteAction} className={styles.noteForm}>
        <input type="hidden" name="targetType" value={targetType} />
        <input type="hidden" name="targetId" value={targetId} />
        <label className="visually-hidden" htmlFor={`note-${targetId}`}>
          {label}
        </label>
        <textarea id={`note-${targetId}`} name="body" rows={2} className={styles.noteInput} placeholder="A thought, a pairing, a question…" required />
        <button type="submit" className={styles.noteSave}>
          Save note
        </button>
      </form>
    </details>
  );
}

function Pillar({ pillar, here, notes, readingList }: { pillar: PillarView; here: boolean; notes: Annotation[]; readingList: boolean }) {
  const core = pillar.slots.filter((s) => s.kind === "N" || s.kind === "E");
  const extras = pillar.slots.filter((s) => s.kind === "extra");
  const showExtrasAsCovers = core.length === 0;
  return (
    <section className={styles.pillar} aria-labelledby={`p-${pillar.slug}`} data-testid="pillar">
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
      {readingList ? null : pillar.slots.length ? (
        // Your own Path: every title in the order you gave it, each with how to read it (M14 step 5).
        <ol className={styles.ownTitles} role="list">
          {pillar.slots.map((s) => (
            <li key={s.id} className={styles.slot}>
              <span className={styles.how}>{KIND_WORDS[s.kind]}</span>
              <SlotCover slot={s} current={s.id === pillar.currentSlotId && pillar.status !== "not-started"} letter={false} />
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.noTitles}>No titles yet. Edit the path to add some.</p>
      )}
      {readingList && core.length ? (
        <ol className={styles.pair}>
          {core.map((s) => (
            <li key={s.id} className={styles.slot}>
              {/* The reading list's letter, read out as its words (a label on a plain span may be skipped). */}
              <span className={styles.kind} aria-hidden="true">
                {s.kind}
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
      <TargetNotes targetType="pillar" targetId={pillar.id} label={`Note on ${pillar.title}`} notes={notes} />
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
            {numbered.map((p, i) => (
              <li
                key={p.id}
                className={[
                  styles.stop,
                  p.status === "done" ? styles.stopDone : "",
                  i === hereIndex ? styles.stopHere : "",
                ].join(" ")}
                title={p.title}
              />
            ))}
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
              <Pillar key={p.id} pillar={p} here={p.id === path.currentPillarId} notes={notes.get(p.id) ?? []} readingList={readingList} />
            ))}
          </div>
        </section>
      ))}

      {master.map((m) => (
        <section key={m.id} className={styles.master} aria-labelledby="master-key">
          <div>
            <h2 id="master-key" className={styles.masterTitle}>
              Master key
            </h2>
            <p className={styles.masterLede}>Read last. {m.question}</p>
          </div>
          {m.slots.map((s) => (
            <SlotCover key={s.id} slot={s} current={false} />
          ))}
        </section>
      ))}
    </div>
  );
}
