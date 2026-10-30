# simplified-technical-english

Rewrite technical text into ASD-STE100 Simplified Technical English, and measure how
close it got.

```
simplified-technical-english/
├── SKILL.md                      Claude skill (Claude Code, Cowork, claude.ai)
├── AGENTS.md                     portable, self-contained — Codex, Cursor, Aider, …
├── README.md                     this file
├── references/
│   ├── rules.md                  the 53 writing rules, grouped, with reasoning
│   └── substitutions.md          non-approved → approved words
└── scripts/
    └── ste_check.py              compliance checker, stdlib only
```

## Install

**Claude Code** — copy the folder into either location:

```bash
cp -r simplified-technical-english ~/.claude/skills/          # all projects
cp -r simplified-technical-english .claude/skills/            # this project only
```

**Claude Cowork / claude.ai** — package it and upload:

```bash
zip -r simplified-technical-english.skill simplified-technical-english
```

Then use the *Save skill* option on the uploaded file.

**Codex, Cursor, Aider, Windsurf, Continue, and other `AGENTS.md` harnesses** — copy
`AGENTS.md` into the repository root, or append it to an existing one:

```bash
cat simplified-technical-english/AGENTS.md >> AGENTS.md
```

`AGENTS.md` is self-contained. It repeats the essential rules inline, so it works
without `references/`. Keep `scripts/ste_check.py` beside it if you want the checker.

**Any other tool** — paste `AGENTS.md` into the system prompt or custom-instructions
field. It is written to stand alone.

## Use

Ask for it explicitly. This is a deliberate register, not a default improvement:

> Rewrite this SOP in Simplified Technical English. Our techs in three countries have
> to follow it.

> Check this protocol for STE compliance and tell me what to fix.

### Strictness levels

The full standard is stringent. You can set how far to take it:

| Say | Level | What you get |
|---|---|---|
| "strict STE", "full ASD-STE100", "90%+" | Strict | The full standard: hard sentence limits, approved words, STE verb forms only |
| "80% STE", "standard STE" | Standard | Core rules, sentence limits with some tolerance, passive allowed in methods, ordinary vocabulary kept |
| "light STE", "below 70%" | Light | Core rules and short sentences only |
| "STE, but allow passive voice" | Custom | Standard, plus the changes you name |

The core rules apply at every level: one instruction per sentence, imperative for
steps, conditions first, one term per thing, no ambiguous connectors, and every
meaning change flagged. With no level named, the agent uses Strict when you name
ASD-STE100 or ask for a score, and Standard otherwise. The notes after each rewrite
state the level used.

The checker always scores against full STE, so expect lower scores at softer levels.

## The checker on its own

`ste_check.py` is useful without any agent. It needs only the Python standard
library.

```bash
python3 scripts/ste_check.py draft.md                 # descriptive: 25-word limit
python3 scripts/ste_check.py draft.md --procedural     # instructions: 20-word limit
python3 scripts/ste_check.py draft.md --json           # machine-readable
python3 scripts/ste_check.py --text "Close the valve."
cat draft.md | python3 scripts/ste_check.py -
python3 scripts/ste_check.py draft.md --fail-under 90  # exit 1 below 90% — for CI
```

It reports sentence-length violations, oversized paragraphs, likely passive voice,
noun clusters longer than three words, non-approved words with replacements,
forbidden verb forms and contractions, then a compliance percentage.

It is a heuristic linter, not a certification tool. It pattern-matches, so it
produces false positives. Review each finding rather than obeying it.

### In CI

```yaml
- name: Check documentation register
  run: python3 scripts/ste_check.py docs/procedures.md --procedural --fail-under 90
```

## The standard itself

ASD-STE100 is maintained by the AeroSpace and Defence Industries Association of
Europe. Issue 9 (January 2025) is current: 53 writing rules in 9 sections, about 900
approved words, and about 1,200 non-approved words with alternatives.

The official specification is **free** from <https://www.asd-ste100.org>. The
dictionary is copyrighted, so `references/substitutions.md` is a practical working
subset rather than a replacement. For regulated or contractual deliverables, obtain
the official copy and verify against it.
