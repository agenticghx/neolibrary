import Link from "next/link";
import { addTargetNoteAction, removeNoteAction } from "@/app/(app)/actions";
import type { Annotation } from "@/lib/library/annotations";
import { availabilityLabel } from "@/lib/library/availability";
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

function SlotCover({ slot, current }: { slot: SlotView; current: boolean }) {
  return (
    <Cover
      title={slot.book.title}
      slot={slot.kind}
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

function Pillar({ pillar, here, notes }: { pillar: PillarView; here: boolean; notes: Annotation[] }) {
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
        <h3 id={`p-${pillar.slug}`} className={styles.pillarTitle}>
          {pillar.title}
        </h3>
        {pillar.question ? <p className={styles.question}>{pillar.question}</p> : null}
      </header>
      {core.length ? (
        <ol className={styles.pair}>
          {core.map((s) => (
            <li key={s.id} className={styles.slot}>
              <span className={styles.kind} aria-label={s.kind === "N" ? "Narrative, read first" : "Engineering, read second"}>
                {s.kind}
              </span>
              <SlotCover slot={s} current={s.id === pillar.currentSlotId && pillar.status !== "not-started"} />
            </li>
          ))}
        </ol>
      ) : null}
      {extras.length ? (
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

export function PathView({ path, notes = new Map() }: { path: PathData; notes?: Map<string, Annotation[]> }) {
  const numbered = path.pillars.filter((p) => p.number > 0);
  const master = path.pillars.filter((p) => p.group === "master");
  const groups = Object.keys(GROUPS)
    .map((g) => ({ key: g, title: GROUPS[g], pillars: path.pillars.filter((p) => p.group === g) }))
    .filter((g) => g.pillars.length);
  const done = numbered.filter((p) => p.status === "done").length;
  const hereIndex = numbered.findIndex((p) => p.id === path.currentPillarId);

  return (
    <div className={styles.path}>
      <header className={styles.head}>
        <h1 className={styles.title}>{path.title}</h1>
        <p className={styles.subtitle}>
          {numbered.length} pillars · Read N, then E · {path.available} available, {path.notYet} not available yet
        </p>
        <p className={styles.description}>{path.description}</p>
        <TargetNotes targetType="path" targetId={path.id} label={`Note on ${path.title}`} notes={notes.get(path.id) ?? []} />
        <ol className={styles.track} aria-label={`${done} of ${numbered.length} pillars finished`}>
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
      </header>

      {groups.map((g) => (
        <section key={g.key} className={styles.group} aria-labelledby={`g-${g.key}`}>
          <h2 id={`g-${g.key}`} className={styles.groupTitle}>
            {g.title}
          </h2>
          <div className={styles.grid}>
            {g.pillars.map((p) => (
              <Pillar key={p.id} pillar={p} here={p.id === path.currentPillarId} notes={notes.get(p.id) ?? []} />
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
