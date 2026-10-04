# The ASD-STE100 writing rules

Issue 9 (January 2025) has 53 writing rules in 9 sections. This file summarises them
in working form and explains the ones that are commonly misapplied. It is a working
aid, not the standard. Get the official text free from <https://www.asd-ste100.org>.

## Contents

1. [Words](#1-words)
2. [Noun clusters](#2-noun-clusters)
3. [Verbs](#3-verbs)
4. [Sentences](#4-sentences)
5. [Procedures](#5-procedures)
6. [Descriptive writing](#6-descriptive-writing)
7. [Safety instructions: warnings and cautions](#7-safety-instructions-warnings-and-cautions)
8. [Punctuation and word counts](#8-punctuation-and-word-counts)
9. [Writing practices that cause trouble](#9-writing-practices-that-cause-trouble)

---

## 1. Words

**Use only approved words.** Each approved word has one meaning and one part of
speech. `close` is a verb meaning "to shut". It is not an adjective meaning "near".
Use `near` for that.

**Use the approved word in its approved part of speech only.** `test` is a noun in
the dictionary. To express the action, use `do a test` rather than `test the unit`,
unless `test` is also approved as a verb in your issue. When in doubt, rephrase with
`do a`, `make a`, or `give a` plus the noun.

**Keep technical names.** A technical name is an official name for a thing: a part, a
material, a chemical, a tool, a location, a piece of software, a gene. These are not
restricted, and stripping them destroys precision. The test is whether a specialist
reader would recognise it as the name of something.

**Keep technical verbs.** A technical verb is a discipline-specific action with no
approved equivalent: `centrifuge`, `anneal`, `torque`, `autoclave`, `titrate`. Keep
them. Inventing a paraphrase for a term of art makes the text longer and less exact.

**Do not use a word as more than one part of speech.** If you write `the oil` as a
noun, do not also write `oil the bearing` as a verb. Choose one and rephrase the
other: `apply oil to the bearing`.

**Do not use synonyms for variety.** English style teaching encourages varying your
words. STE forbids it. If it is a filter in sentence one, it is a filter in every
sentence. Variation forces the reader to decide whether two words mean the same
thing.

**Avoid words that carry more than one common sense.** `since` (time or cause),
`while` (time or contrast), `as` (many), `once` (time or number). Replace each with
the unambiguous word: `after`, `although`, `because`, `when`.

**Do not use slang, idiom, jargon, or figures of speech.** "Back off the nut",
"a ballpark figure", "run into a problem" all fail. Non-native readers translate
them literally.

## 2. Noun clusters

**Do not write a compound noun of more than three words.** Long noun strings hide the
grammatical relationships between the parts, and readers must guess which noun
modifies which.

`main landing gear door actuator seal` (6) is ambiguous. Unpack it with prepositions:
`the seal of the actuator for the main landing gear door`.

The unpacked version is longer. That is the correct trade: length is cheap, ambiguity
is not.

**Establish an abbreviation when a cluster repeats.** If the unpacked form appears
many times, define a short technical name once and use it consistently.

## 3. Verbs

**Use only these verb forms:**

| Form | Example |
|---|---|
| Infinitive | to install |
| Imperative | Install the filter. |
| Simple present | The valve opens at 30 bar. |
| Simple past | The test showed a leak. |
| Simple future | The system will stop. |
| Past participle **as an adjective** | the damaged seal |

**Do not use continuous or perfect tenses.** No `is operating`, `has completed`,
`had been removed`, `will have finished`.

- `The pump is operating` → `The pump operates`
- `has been contaminated` → `is contaminated` (participle as adjective), or state the
  event in simple past: `contamination occurred`

**Do not stack auxiliary verbs.** `must be able to be removed` → `you can remove`.

**Use the active voice in procedures, always.** The passive hides who acts, and in an
instruction the actor is the reader.

- `The switch must be turned to OFF` → `Turn the switch to OFF.`
- `Care should be taken` → `Be careful.` — better: state the specific hazard.

**In descriptive text, use the passive only when the actor is unknown or irrelevant.**
`The sample was collected in 2019` is acceptable if who collected it does not matter.
If it matters, name them.

**Do not use the -ing form as a noun (gerund) or in a participial phrase.**

- `Before starting the pump, check the oil` → `Before you start the pump, check the
  oil.`
- `Cleaning is necessary` → `You must clean the unit.`

The exception is an -ing word that is part of an established technical name, such as
`landing gear` or `sequencing library`.

## 4. Sentences

**One instruction per sentence.** If a sentence contains two things to do, split it.

**Sentence length ceilings:** 20 words for procedural text, 25 for descriptive.
These are limits, not targets. Do not fragment a clear 18-word sentence.

**Do not omit words to save space.** Keep articles (`the`, `a`), relative pronouns
(`that`, `which`), and the verb. `Remove filter, install new` is faster to write and
slower to read than `Remove the filter. Then install a new filter.`

**Put the condition before the action.** The reader needs to know whether the
instruction applies before they start doing it.

- Poor: `Close the valve if the pressure is above 30 bar.`
- Better: `If the pressure is above 30 bar, close the valve.`

**Keep related words together.** Do not separate a subject from its verb, or a verb
from its object, with a long intervening clause.

## 5. Procedures

**Use the imperative for every instruction.** Start with the verb.

**One step, one action.** If a step has three actions, it is three steps.

**Number sequential steps.** Use a bulleted list only when order does not matter.

**State the purpose before a long or non-obvious sequence**, so the reader knows what
success looks like.

**Put a condition in its own sentence when it changes the outcome.**
`Do X. If Y occurs, do not do X. Do Z instead.` A conditional buried in a compound
sentence is the classic place where safety information gets lost in rewriting.

## 6. Descriptive writing

**One topic per paragraph.** If the topic changes, start a new paragraph.

**Six sentences per paragraph maximum.**

**Use a topic sentence.** Put the main point in the first sentence of the paragraph.

**Use vertical lists for three or more parallel items**, rather than a long sentence
with commas and `and`.

**Use tables** when the content is genuinely two-dimensional. A table removes the
need for the reader to hold several conditions in memory at once.

## 7. Safety instructions: warnings and cautions

STE distinguishes them, and the distinction is not cosmetic:

- **WARNING** — risk of injury or death to a person.
- **CAUTION** — risk of damage to equipment.

**Structure a warning in this order:** the command or the hazard, then the
consequence.

```
WARNING: DO NOT TOUCH THE HEATER DURING OPERATION.
THE SURFACE IS HOT. YOU CAN GET BURNS.
```

**Put the warning before the step it applies to**, never after. A warning that
follows the step it protects has already failed.

**Do not soften a warning to meet a rule.** If the clearest possible statement of the
danger takes 23 words in a procedure, use 23 words and note the exception.

## 8. Punctuation and word counts

**Use simple punctuation.** Full stops, commas, colons, hyphens in established
compounds. Avoid semicolons and parentheses — a semicolon nearly always marks a
sentence that should be two sentences.

**Do not use `/` to mean `and` or `or`.** Write the word.

**Write numbers as numerals** for quantities and measurements.

**Define an abbreviation at first use**, then use it consistently. Do not alternate
between the abbreviation and the full form.

## 9. Writing practices that cause trouble

These are not numbered rules in the standard. They are the failure patterns that
appear most often when a fluent writer first applies STE.

**Over-simplification.** Replacing a precise technical term with a vague approved word
makes the text worse. STE constrains general vocabulary so that technical vocabulary
can carry the meaning. Keep the technical terms.

**Silent disambiguation.** When the source is ambiguous you must choose a reading to
write a clear sentence. That is a change of meaning. Record it and tell the author.

**Losing modality.** `should`, `may`, and `must` mean different things.
`should` is a recommendation, `must` is a requirement, `may` is permission. Do not
flatten them all into `must`, and do not drop them.

**Rewriting a warning into a statement.** `Ensure the power is off` is a statement of
a desired state. `Set the power switch to OFF. Confirm that the indicator is dark.`
is an instruction with a verification. In safety text, prefer the instruction.

**Chopping for the sake of the word count.** A reader reassembling five fragments
does more work than a reader following one clear sentence. Check that each sentence
still stands on its own.
