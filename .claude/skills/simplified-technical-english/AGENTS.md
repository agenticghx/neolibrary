# Simplified Technical English (ASD-STE100) — portable instruction file

Drop-in for agent harnesses that read `AGENTS.md` (Codex, Cursor, Aider, Windsurf,
Continue, and others). Self-contained: it repeats the essential rules inline so it
works even without the `references/` directory beside it. For Claude Code, Claude
Cowork, or claude.ai, use `SKILL.md` instead — it loads the reference files on demand
instead of carrying everything at once.

---

## When to apply this

Apply Simplified Technical English when the user asks for STE, ASD-STE100,
"controlled language", "controlled English", or asks you to simplify a procedure,
protocol, SOP, work instruction, manual, safety notice, or README for readers whose
first language is not English.

Do not apply it by default. It is a deliberate register, not a general improvement.

## What the standard is

ASD-STE100 is a controlled language maintained by the AeroSpace and Defence
Industries Association of Europe. Issue 9 (January 2025) is current: 53 writing rules
in 9 sections, about 900 approved words, and about 1,200 non-approved words with
alternatives. The free official copy is at <https://www.asd-ste100.org>.

Its purpose is the removal of ambiguity, not elegance. A technician who reads English
as a second language must get the procedure right the first time. Every word that
could mean two things is a place where that person can make a mistake.

When a rule would make the text less clear or less accurate, clarity and accuracy
win, and you say so in your notes. Compliant text that is operationally wrong has
failed at its own job.

## Choose the strictness level first

The full standard is stringent. It was built for aircraft maintenance, and some of
its rules cost more than they return in a lab protocol, a README or a methods
section. Pick a level before you rewrite.

- The user names it ("strict STE", "light STE") → use that level.
- The user gives a percentage ("80% of the way to STE") → 90% or more is Strict,
  70–89% is Standard, below 70% is Light.
- The user names rules to keep or drop ("STE, but allow passive voice in the
  methods") → Custom: start from Standard, then apply their changes exactly.
- The user says nothing → Strict if they named ASD-STE100 or asked for a compliance
  check or score; otherwise Standard. Do not stop to ask. State the level in the
  notes.

**Core rules — every level:** one instruction per sentence; imperative, active voice
for instructions; conditions before the action and never lost; one term for one
thing; no `since`/`while`/`once`/`as` ambiguity; no telegraphic style; warnings in
danger → consequence → avoidance order; every meaning change flagged.

| Rule | Light | Standard (≈80%) | Strict (full STE) |
|---|---|---|---|
| Sentence length, procedural | Short; split above ~30 words | 20 normally; up to 25 if splitting hurts | 20, hard limit |
| Sentence length, descriptive | Short; split above ~35 words | 25 normally; up to 30 if splitting hurts | 25, hard limit |
| Passive voice, descriptive text | Allowed | Allowed when the actor is unknown or irrelevant (e.g. methods) | Only when the actor is unknown or irrelevant, and kept rare |
| Verb forms | Any clear form | Simple tenses preferred; present perfect and plain modals allowed | Only the forms in the verb table below |
| -ing forms | Allowed | Rewrite when they hide the actor or the order of steps | Rewrite all except technical names |
| Vocabulary | Ordinary words; cut jargon and verbose phrases | Fix verbose phrases and ambiguous words; keep ordinary words | Approved words throughout |
| Noun clusters | Break only confusing ones | 3 words max, except established terms | 3 words max |
| Paragraphs | One topic | One topic, about 6 sentences | One topic, 6 sentences max |
| Checker | Optional; sentence length only | Run; findings within the tolerances above are advisory | Run; fix or defend every finding |

The rules in the rest of this file describe Strict. At Standard and Light, the table
above wins where they conflict.

## Method

Work in this order — meaning, then structure, then vocabulary. Rewriting words before
fixing sentence structure wastes effort on sentences you are about to delete.

1. **Read for meaning.** Find the sequence hidden in the prose. Work out what the
   reader must do, and in what order.
2. **Classify each part.** Procedural text (instructions) has a 20-word sentence
   limit. Descriptive text (explanation) has 25. Most documents mix both.
3. **Split sentences.** One idea per sentence.
4. **Use active voice.** Use the imperative for every instruction.
5. **Fix verb forms.** See the table below.
6. **Replace non-approved words.** One word, one meaning.
7. **Break noun clusters** longer than three words.
8. **Restore omitted words** — articles, relative pronouns, verbs.
9. **Check paragraphs.** One topic, six sentences maximum.
10. **Run the checker** (below), then review each finding.

## Rules, compressed

### Verbs — only these forms

| Allowed | Example |
|---|---|
| infinitive | to install |
| imperative | Install the filter. |
| simple present | The valve opens at 30 bar. |
| simple past | The test showed a leak. |
| simple future | The system will stop. |
| past participle **as adjective** | the damaged seal |

No continuous tenses (`is running` → `runs`). No perfect tenses (`has completed` →
`completed`). No stacked auxiliaries (`must be able to be removed` → `you can
remove`). No `-ing` form as a noun or to open a participial phrase
(`Before starting the pump` → `Before you start the pump`), except inside an
established technical name such as `landing gear` or `sequencing library`.

### Sentences

- Procedural: 20 words maximum. Descriptive: 25. These are ceilings, not targets — do
  not fragment a clear 18-word sentence into three pieces the reader must reassemble.
- One instruction per sentence.
- Put the condition first: `If the pressure is above 30 bar, close the valve.`
- Do not drop articles, relative pronouns, or verbs to save space.

### Words

- One word, one meaning, one part of speech. Do not use synonyms for variety — if it
  is a filter in sentence one, it is a filter in every sentence.
- Replace words with two common senses: `since` → `after` or `because`; `while` →
  `when` or `although`; `as` → `because`, `when`, or `like`; `once` → `when`.
- Replace formal words: `utilize`→`use`, `commence`→`start`, `terminate`→`stop`,
  `ascertain`→`find`, `perform`→`do`, `indicate`→`show`, `facilitate`→`help`,
  `sufficient`→`enough`, `approximately`→`about`, `verify`→`check`,
  `via`→`by`/`through`, `prior to`→`before`, `in order to`→`to`,
  `in the event that`→`if`, `due to the fact that`→`because`.
- No slang, idiom, or figures of speech.
- **Keep technical names** — part names, chemical names, tool names, gene symbols,
  software names. **Keep technical verbs** — `centrifuge`, `anneal`, `titrate`,
  `torque`. **Keep** numbers, units, equations, code and identifiers untouched.
- **Keep modal distinctions.** `must` is a requirement, `should` is a recommendation,
  `can`/`may` is ability or permission. Do not flatten them.

### Noun clusters

Never more than three words. `main landing gear door actuator seal` →
`the seal of the actuator for the main landing gear door`. The unpacked form is
longer. That is the correct trade: length is cheap, ambiguity is not.

### Paragraphs

One topic. Six sentences maximum. Topic sentence first. Use a vertical list for three
or more parallel items, and a table when the content is genuinely two-dimensional.

### Safety text

`WARNING` = risk of injury to a person. `CAUTION` = risk of damage to equipment.
State the command or hazard, then the consequence. Put the warning **before** the step
it applies to. Never soften a warning to satisfy a word count.

## Verify

```bash
python3 scripts/ste_check.py draft.md              # descriptive, 25-word limit
python3 scripts/ste_check.py draft.md --procedural # instructions, 20-word limit
python3 scripts/ste_check.py draft.md --json       # machine-readable
python3 scripts/ste_check.py draft.md --fail-under 90   # exit 1 below 90%
```

Standard library only. It reports sentence-length violations, oversized paragraphs,
likely passive voice, noun clusters, non-approved words, forbidden verb forms and
contractions, then a compliance percentage.

Treat the output as a checklist, not a verdict. It pattern-matches, so it produces
false positives — a technical name can look like a noun cluster, and `is required`
can look like passive voice when it is the clearest available phrasing. Review each
finding and decide. Overriding the tool with a reason is correct practice; obeying it
blindly is not.

The compliance percentage always measures full STE. At Standard or Light, a lower
score is expected; do not chase it. If the user asks for a score, report it as the
full-STE score and name the level the text targets.

## Output format

Give the rewritten text as the main body. Then add a short section, **Notes on the
rewrite**, in ordinary English:

- **Level** — the level you applied and, for Custom, the rules changed.
- **Meaning changes** — where the original was ambiguous and you chose a reading.
  This is the most important item. The author must be able to confirm your choice.
- **Deliberate rule breaks** — any long sentence or non-approved word you kept, and
  why.
- **Terms kept** — the technical names and technical verbs you preserved.

Keep the notes brief. They are a handover, not a report.

## Failure modes to avoid

- **Baby English.** STE is for professionals. "Put the thing in the other thing" is
  vaguer than "Install the filter in the housing", not simpler.
- **Silent disambiguation.** When the source could mean two things you must pick one.
  That is a change of meaning. Record it.
- **Lost conditionals.** `Do X unless Y` must not become `Do X`. Give the condition
  its own sentence.
- **Chopping to hit the word count.** Five fragments cost the reader more than one
  clear sentence.
- **Missing subject.** `Then filtered and dried` has no actor. Say who does it.
