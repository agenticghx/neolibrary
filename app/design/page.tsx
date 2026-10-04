import type { Metadata } from "next";
import { Cover } from "@/components/Cover";
import { Mark } from "@/components/Mark";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Design system" };

// Each swatch's class name matches its token in app/tokens.css.
const swatches = [
  ["paper", "Paper"],
  ["paperRaised", "Paper raised"],
  ["paperSunken", "Paper sunken"],
  ["ink900", "Ink"],
  ["ink700", "Ink secondary"],
  ["ink500", "Ink quiet"],
  ["accent", "Accent"],
  ["highlightSwatch", "Highlight"],
  ["machineBg", "Machine-written"],
] as const;

const scale = [
  ["text3xl", "Display", "--text-3xl"],
  ["text2xl", "Page title", "--text-2xl"],
  ["textXl", "Heading", "--text-xl"],
  ["textLg", "Section title", "--text-lg"],
  ["textRead", "Book text", "--text-read"],
  ["textMd", "Interface text", "--text-md"],
  ["textSm", "Label and caption", "--text-sm"],
] as const;

export default function DesignPage() {
  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <span className={styles.brand}>
          <Mark size={26} />
          <span className={styles.wordmark}>Neolibrary</span>
        </span>
        <nav aria-label="Main" className={styles.nav}>
          <span>Paths</span>
          <span>Notes</span>
        </nav>
      </header>

      <main className={styles.main}>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>Design system</p>
          <h1 className={styles.title}>A quiet reading room</h1>
          <p className={styles.lede}>
            Warm paper, deep ink, one oxidised teal. Every value on this page comes from the tokens in{" "}
            <code>app/tokens.css</code>, described in <code>docs/design.md</code>.
          </p>
        </div>

        <section className={styles.section} aria-labelledby="reading">
          <h2 id="reading" className={styles.sectionTitle}>
            Reading
          </h2>
          <div className={styles.readingGrid}>
            <article className={styles.reading}>
              <p className={styles.chapterLabel}>Meditation I · Public-domain text</p>
              <h3 className={styles.chapterTitle}>Of the things of which we may doubt</h3>
              <p>
                Several years have now elapsed since I first became aware that I had accepted, even from my youth,
                many false opinions for true, and that consequently what I afterward based on such principles was
                highly doubtful; and from that time I was convinced of the{" "}
                <mark className={styles.highlight}>necessity of undertaking once in my life</mark> to rid myself of
                all the opinions I had adopted, and of commencing anew the work of building from the foundation.
              </p>
              <p>
                But as this enterprise appeared to me to be one of great magnitude, I waited until I had attained an
                age so mature as to leave me no hope that at any stage of life more advanced I should be better able
                to execute my <span className={styles.spoken}>design</span>.
              </p>
              <aside className={styles.machine} aria-label="Machine-written rewrite">
                <p className={styles.machineLabel}>Rewrite · Plain English · written by AI</p>
                <p>
                  For years I have known that many things I believed when young were false, so anything I built on
                  them is shaky. I decided I must, once in my life, clear out every opinion and start again from the
                  ground up.
                </p>
              </aside>
            </article>
            <aside className={styles.margin} aria-label="Margin notes">
              <p className={styles.marginLabel}>Highlights</p>
              <p className={styles.marginChip}>necessity of undertaking once in my life</p>
              <p className={styles.marginNote}>Doubt as a method, not a mood.</p>
            </aside>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="shelf">
          <h2 id="shelf" className={styles.sectionTitle}>
            Shelf
          </h2>
          <div className={styles.shelf}>
            <Cover title="Meditations" slot="N" tone="navy" />
            <Cover title="Discourse on Method" slot="E" tone="green" />
            <Cover title="The Principles" slot="E" owned={false} />
          </div>
        </section>

        <section className={styles.section} aria-labelledby="type">
          <h2 id="type" className={styles.sectionTitle}>
            Type
          </h2>
          <p className={styles.sectionNote}>Source Serif 4 for books and titles; Source Sans 3 for the interface.</p>
          <ul className={styles.scale}>
            {scale.map(([cls, label, token]) => (
              <li key={cls} className={styles.scaleRow}>
                <span className={`${styles.scaleSample} ${styles[cls]}`}>{label}</span>
                <code className={styles.token}>{token}</code>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="colour">
          <h2 id="colour" className={styles.sectionTitle}>
            Colour
          </h2>
          <ul className={styles.swatches}>
            {swatches.map(([cls, label]) => (
              <li key={cls} className={styles.swatch}>
                <span className={`${styles.chip} ${styles[cls]}`} />
                <span className={styles.swatchLabel}>{label}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="controls">
          <h2 id="controls" className={styles.sectionTitle}>
            Controls
          </h2>
          <div className={styles.controls}>
            <button type="button" className={styles.primary}>
              Read now
            </button>
            <button type="button" className={styles.secondary}>
              Listen
            </button>
            <a href="#reading">A quiet link</a>
          </div>
        </section>
      </main>
    </div>
  );
}
