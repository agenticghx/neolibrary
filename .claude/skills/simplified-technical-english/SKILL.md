---
name: "simplified-technical-english"
description: "Rewrite text into ASD-STE100 Simplified Technical English (the aerospace controlled-language standard) so that non-native English speakers and safety-critical readers can understand it without ambiguity. Use this skill whenever the user asks for STE, Simplified Technical English, ASD-STE100, \"controlled language\", \"controlled English\", \"plain technical English\", or asks you to simplify, clarify, or de-jargon a procedure, SOP, protocol, work instruction, manual, safety notice, or README for an international or ESL audience. Also use it when the user asks you to check or score existing text for STE compliance, or says something like \"make this readable for people whose first language isn't English\", or \"simplify this for the lab handbook\". Supports a strictness dial — strict, standard (\"80% STE\"), light, or custom rule picks. Prefer this skill over generic \"make it simpler\" rewriting whenever the target is technical instructions rather than marketing or narrative prose."
---

# Simplified Technical English (ASD-STE100)

## What this standard is, and why it exists

ASD-STE100 is a controlled language. The AeroSpace and Defence Industries
Association of Europe maintains it. Issue 9 (January 2025) is current. It contains
53 writing rules in 9 sections, a dictionary of roughly 900 approved words, and about
1,200 non-approved words with approved alternatives.

The purpose is not elegance. It is **removal of ambiguity**. A maintenance technician
in a country where English is a second language reads a procedure and has to get it
right the first time, sometimes with the aircraft on the ground and a clock running.
Every word that could mean two things is a place where that person can make a mistake.

Understanding this purpose matters more than memorising the rules, because it tells
you what to do when the rules conflict. When a rule would make the text less clear or
less accurate, clarity and accuracy win, and you say so. STE that is technically
compliant and operationally wrong has failed at its own job.

## Choose the strictness level first

The full standard is stringent. It was built for aircraft maintenance, and some of
its rules cost more than they return in a lab protocol, a README or a methods
section. So pick a level before you rewrite. The level changes which rules are
hard limits, which are targets, and which you skip.

**How to pick the level:**

- The user names it ("strict STE", "light STE") → use that level.
- The user gives a percentage ("80% of the way to STE") → 90% or more is Strict,
  70–89% is Standard, below 70% is Light.
- The user names rules to keep or drop ("STE, but allow passive voice in the
  methods") → Custom: start from Standard, then apply their changes exactly.
- The user says nothing → Strict if they named ASD-STE100 or asked for a compliance
  check or score; otherwise Standard. Do not stop to ask. State the level you
  chose in the notes so they can change it on the next turn.

**The core rules apply at every level.** These carry most of the clarity gain, and
dropping them is how the text becomes ambiguous:

- One instruction per sentence. Split sentences that join two complete ideas.
- Instructions in the imperative, active voice.
- Conditions before the action, and never lost when you split a sentence.
- One term for one thing. Use the same word for the same thing every time.
- No ambiguous connectors: *since*, *while*, *once*, *as* → the specific meaning.
- No telegraphic style: keep articles, subjects and verbs.
- Warnings and cautions in the danger → consequence → avoidance structure.
- Flag every meaning change in the notes.

**What changes by level:**

| Rule | Light | Standard (≈80%) | Strict (full STE) |
|---|---|---|---|
| Sentence length, procedural | Short; split above ~30 words | 20 normally; up to 25 if splitting hurts | 20, hard limit |
| Sentence length, descriptive | Short; split above ~35 words | 25 normally; up to 30 if splitting hurts | 25, hard limit |
| Passive voice, descriptive text | Allowed | Allowed when the actor is unknown or irrelevant (e.g. methods) | Only when the actor is unknown or irrelevant, and kept rare |
| Verb forms | Any clear form | Simple tenses preferred; present perfect and plain modals (*should*, *may*) allowed | STE forms only: no continuous, perfect or stacked auxiliaries |
| -ing forms (gerunds, participial phrases) | Allowed | Rewrite when they hide the actor or the order of steps | Rewrite all except technical names |
| Vocabulary | Ordinary words; cut jargon and verbose phrases | Fix verbose phrases and ambiguous words; keep ordinary words | Approved words; use `references/substitutions.md` throughout |
| Noun clusters | Break only confusing ones | 3 words max, except established terms | 3 words max |
| Paragraphs | One topic | One topic, about 6 sentences | One topic, 6 sentences max |
| Checker | Optional; use for sentence length | Run; non-approved-word and length findings within the tolerance above are advisory | Run; iterate until every finding is fixed or defended |

Where a step in the method below conflicts with this table, the table wins for Standard and Light.

## The method

Work in this order. Meaning first, then structure, then vocabulary — because
rewriting vocabulary before you have fixed the sentence structure wastes effort on
sentences you are about to delete.

**1. Read for meaning and find the hidden steps.**
Long technical prose usually hides a sequence. Before rewriting a word, work out what
the reader must actually *do*, and in what order. Ambiguity often lives in the
structure, not the words.

**2. Classify the text.** The rules differ:

| Type | What it is | Sentence limit (Strict) |
|---|---|---|
| **Procedural** | Instructions the reader performs | 20 words |
| **Descriptive** | Explanation, theory, background | 25 words |

Most real documents mix both. Handle each part by its own type. At Standard and
Light, use the limits in the strictness table.

**3. Split the sentences.** One idea per sentence. Cut conjunctions that join two
complete thoughts. If a sentence has a subordinate clause carrying a second
instruction, that clause becomes its own sentence.

**4. Convert to active voice, imperative for instructions.**
"The valve must be closed by the operator" → "Close the valve."
The imperative names the actor, which the passive hides.

**5. Fix the verbs.** Only these forms are permitted: infinitive, imperative, simple
present, simple past, simple future, and the past participle used as an adjective.
No continuous tenses, no perfect tenses, no auxiliary stacks.
"has been operating" → "operates". "will have completed" → "completes".

**6. Replace non-approved words.** One word, one meaning. Read
`references/substitutions.md` for the common cases and the reasoning behind them.

**7. Break up noun clusters.** Never more than three words in a compound noun.
"main landing gear door actuator seal" → "the seal of the actuator for the main
landing gear door".

**8. Restore what was omitted.** Put back articles, relative pronouns and verbs that
were dropped for brevity. Telegraphic style is faster to write and slower to read.
"Remove filter, install new" → "Remove the filter. Then install a new filter."

**9. Check paragraphs.** One topic each, six sentences maximum.

**10. Run the checker.** See below. Read its findings through the chosen level.

## Verify with the checker

`scripts/ste_check.py` measures the parts of STE that can be measured. Run it on your
draft rather than trusting your own reading, because sentence length and passive voice
are exactly the things a fluent writer stops noticing.

```bash
python3 scripts/ste_check.py draft.md                    # descriptive limits (25 words)
python3 scripts/ste_check.py draft.md --procedural       # instruction limits (20 words)
python3 scripts/ste_check.py draft.md --json             # machine-readable
python3 scripts/ste_check.py --text "Close the valve."   # inline
```

It needs only the Python standard library, so it runs anywhere.

It reports sentence-length violations, oversized paragraphs, likely passive voice,
noun clusters longer than three words, non-approved words with suggested
replacements, forbidden verb forms, and contractions. It ends with a compliance
percentage.

**Treat the output as a checklist, not a verdict.** The checker uses pattern
matching, so it produces false positives — a technical name can look like a noun
cluster, and "is required" can look like passive voice when it is the clearest
available phrasing. Review each finding and decide. A skilled STE writer overrides
the tool with a reason; an unskilled one either ignores it or obeys it blindly.

Iterate until the remaining findings are ones you can defend.

The checker always measures against full STE, so its compliance percentage is a
Strict score. At Standard or Light, a lower score is expected. Do not chase it.
Fix the findings the level requires, and leave the rest. If the user asked for a
score, report it as the full-STE score and say which level the text targets.

## Output

Deliver the rewritten text as the main body of the response. Then add a short section
titled "Notes on the rewrite" that covers only what the reader needs:

- **Level.** One line: the level you applied and, for Custom, the rules changed.
- **Meaning changes.** Any place where the original was ambiguous and you had to
  choose a reading. This is the most important item. Flag it so the author can
  confirm you chose correctly.
- **Deliberate rule breaks.** Any place where you kept a long sentence or a
  non-approved word, and why.
- **Terms you kept.** Technical names and technical verbs are permitted and should be
  kept. Say which ones you treated that way.

Keep these notes brief. They are a handover, not a report. Write the notes in ordinary
English unless the user asks for the whole response in STE.

## Things that are permitted, and are often wrongly removed

Writers new to STE tend to over-strip. These stay:

- **Technical names.** Official part names, chemical names, tool names, gene symbols,
  software names. "Isobologram", "combination index", "HDAC inhibitor" are all fine.
- **Technical verbs.** Verbs specific to a discipline, where no approved word carries
  the same meaning. "Centrifuge the sample" is correct STE.
- **Numbers, units, equations, code, identifiers.** Untouched.
- **Warnings and cautions.** These have their own conventions: state the danger first,
  then the consequence, then the avoidance. Do not soften them.

The point of STE is that a reader can follow the text, not that the text uses a small
vocabulary at the cost of precision.

## Common failures to avoid

**Rewriting into baby English.** STE is for professionals. "Put the thing in the
other thing" is not simpler than "Install the filter in the housing"; it is vaguer.
Simplicity is about one-meaning-per-word, not about a low reading age.

**Silently resolving ambiguity.** When the original could mean two things, you must
pick one to write a clear sentence. That choice is a change to the document's meaning
and it belongs in the notes. Burying it is the most damaging thing this skill can do.

**Losing a conditional.** "Do X unless Y" often becomes "Do X" when a writer splits
sentences carelessly. Conditions are safety information. Give them their own sentence:
"Do X. If Y occurs, do not do X. Do Z instead."

**Chopping every sentence to five words.** The limits are ceilings, not targets. A
17-word sentence that reads naturally beats three 6-word fragments the reader must
reassemble.

**Deleting the subject.** "Then filtered and dried" has no actor. Say who or what
does it.

## Reference files

Read these when the task calls for them; there is no need to load them for a short
rewrite.

- `references/rules.md` — the 53 writing rules, grouped by section, with the reasoning
  behind the ones that are easy to misapply. Read this for a long or high-stakes
  document, or when you need to justify a decision to the author.
- `references/substitutions.md` — non-approved words with approved replacements, and
  the "one word one meaning" traps. Read this during step 6.

## The official standard

The full specification, including the complete dictionary, is available at no cost
from <https://www.asd-ste100.org>. The dictionary is copyrighted, so the substitution
list bundled here is a practical working subset, not a replacement for it. For
regulated or contractual deliverables, obtain the official copy and verify against it.