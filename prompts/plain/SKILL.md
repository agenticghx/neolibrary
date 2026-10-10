---
name: plain-english
description: "Rewrite or explain text in plain English for a curious, intelligent non-specialist (for example a scientist reading a hard book outside their field: philosophy of science, physics, statistics, history of ideas). Use this skill whenever the user asks to make something plain, simpler, clearer, less dense, 'in plain English', 'explain like I'm smart but new to this', 'unpack this paragraph', or 'de-jargon' prose, and whenever Neolibrary's AI explanation level is set to 'Plain'. Also use it to check or score a text for plainness (long sentences, long words, passive voice, unexplained abbreviations, reading ease) with scripts/plain_check.py. Prefer simplified-technical-english instead when the target is a procedure or instructions that must follow ASD-STE100."
---

# Plain English

Written for: Claude, when it rewrites or explains text for a reader who is
intelligent and curious but not a specialist in the subject. The model reader
is Samuel: a scientist who reads hard books (science, philosophy of science)
and wants to understand them, not to be talked down to.

## Why this exists

Dense prose hides its point. The reader spends effort decoding sentences
instead of thinking about ideas. A plain rewrite moves that effort off the
reader, while keeping every claim the author made. Plain is not dumbed down:
the ideas stay as hard as they are; only the wording gets easier.

## The method

1. **Find the point first.** Before you rewrite, say to yourself in one
   sentence what the passage claims. Put that point first in your rewrite.
2. **One idea per sentence.** Split long sentences. Aim for 15 to 20 words on
   average; go over 25 only when splitting would break the logic.
3. **Everyday words.** Use "use" not "utilise", "show" not "demonstrate",
   "about" not "approximately" (unless the precision matters).
4. **Define a technical term the first time** with a few words, then keep
   the term. Readers will meet "paradigm" or "p-value" again in the book, so
   teach the name; do not hide it. Example: "a paradigm (the shared set of
   problems, methods and examples a field takes for granted)".
5. **Spell out abbreviations** on first use: "enzyme-linked immunosorbent
   assay (ELISA)".
6. **Active voice.** Say who does what: "the researchers measured", not "it
   was measured". Passive is fine when the actor is unknown or unimportant.
7. **Concrete examples.** When an idea is abstract, add one short example,
   and mark it as yours ("For example, ...") if the author did not give it.
8. **Numbers and units exactly as written.** Never round, convert or drop a
   number, unit, confidence interval or sample size.
9. **Never change the meaning.** Keep every claim, caveat and hedge
   ("may", "suggests", "in most cases"). Do not add claims. If the original
   is ambiguous, say so rather than guessing.
10. **No padding.** Cut "It is important to note that", "In order to",
    "basically". Do not add a summary that repeats the rewrite.

## Examples

**1. Philosophy of science (paradigms)** (author's own illustrative text)

Before: "The incommensurability of successive paradigms, insofar as it
precludes the formulation of a neutral observational language through which
competing theoretical frameworks might be adjudicated, renders the
rationality of theory choice problematic."

After: "Scientists working in different paradigms (shared sets of problems,
methods and model examples) see the world in ways that cannot be fully
translated into each other. This is called incommensurability. Because of it,
there is no neutral language of observation that both sides accept. So it is
hard to say how choosing between the two theories can be fully rational."

**2. Assay description**

Before: "Interferon-gamma secretion was quantified by ELISPOT following
overnight stimulation of PBMCs with peptide pools at 2 ug/mL."

After: "We stimulated white blood cells from blood (peripheral blood
mononuclear cells, PBMCs) overnight with pools of peptides (short protein
pieces) at 2 ug/mL. Then we counted the cells that released interferon-gamma,
a signal of immune activation, with an ELISPOT assay (a test that shows each
releasing cell as a spot)."

**3. Statistics sentence**

Before: "The difference failed to attain statistical significance (p = 0.07),
although the effect size estimate was non-trivial (d = 0.45, 95% CI -0.03 to
0.93)."

After: "The difference was not statistically significant (p = 0.07). But the
estimated effect was moderate in size (Cohen's d = 0.45, a standard measure
of how far apart two groups are). The 95% confidence interval ran from -0.03
to 0.93, so the data fit anything from no effect to a large one."

## Checking a text

Run `python3 scripts/plain_check.py FILE` (or pipe text on stdin). It reports
long sentences (over 25 words), long words (4 or more syllables, minus a small
allow-list of common ones), likely passive voice, abbreviations not spelled
out on first use, and the Flesch reading ease (0 to 100; higher is easier;
60 to 70 is ordinary adult prose, below 30 is very hard). Add `--json` for a
machine-readable line. `--selftest` checks the script itself. The script is a
guide, not a judge: a technical term you have defined will still count as a
long word.

## Output

For a rewrite, give:

1. The rewrite itself, in paragraphs that follow the original's order.
2. A short "Terms" list if you defined three or more terms.
3. One line on anything you could not keep plain without changing meaning, or
   any ambiguity in the original. Leave this out if there is none.

Do not explain your editing choices unless asked.
