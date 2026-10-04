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
      owned={slot.book.owned}
      size="sm"
      href={`/books/${slot.book.id}`}
      progress={slot.book.progress}
      current={current}
      imageUrl={slot.book.coverUrl}
    />
  );
}

function Pillar({ pillar, here }: { pillar: PillarView; here: boolean }) {
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
                  <a href={`/books/${s.book.id}`}>{s.book.title}</a>
                  <span className={styles.author}> · {s.book.author}</span>
                  {s.book.owned ? null : <span className={styles.notOwned}> · not owned</span>}
                </li>
              ))}
            </ul>
          </details>
        )
      ) : null}
      {pillar.slots.some((s) => s.book.unverified) ? (
        <p className={styles.unverified}>Agent suggestions, not catalog-checked</p>
      ) : null}
    </section>
  );
}

export function PathView({ path }: { path: PathData }) {
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
          {numbered.length} pillars · Read N, then E · {path.owned} owned, {path.wanted} wanted
        </p>
        <p className={styles.description}>{path.description}</p>
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
              <Pillar key={p.id} pillar={p} here={p.id === path.currentPillarId} />
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
