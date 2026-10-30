# Neolibrary's skills

Written for: anyone who works on Neolibrary with Claude Code (Samuel, a
teammate, a cloud session, another computer), and for Claude itself.

A skill is a packaged set of instructions (and sometimes scripts) that Claude
loads for one kind of task. Every skill this project needs lives in this
folder, so cloning the repository is enough: nothing has to be installed from
anyone's laptop. Claude Code finds them on its own when it is started inside
the repository, on a laptop or in a cloud session.

| Skill | What it is for |
|---|---|
| `merge-train` | Merge pull requests one at a time under the repo's rules; refresh reference screenshots; judge a red CI check |
| `scan-to-text` | Turn a scanned book (page photographs) into a text edition beside the scan |
| `xray-on-subscription` | Build a book's X-ray (who and what is in it) on a Claude subscription |
| `readalong-audio` | Make a read-along package: audio, the script read aloud, word timings, and where each paragraph is in the book |
| `book-chapters` | Split an EPUB or PDF into one clean text file per chapter, ready to narrate |
| `plain-english` | Rewrite or check text in plain English (the app's "Plain" level) |
| `simplified-technical-english` | Rewrite or check text in ASD-STE100 Simplified Technical English (the app's STE levels) |

## Where the app keeps its own copies

The app cannot read this folder at run time, so it keeps copies, and a test
fails when a copy drifts from the skill here:

| App copy | Skill | Test |
|---|---|---|
| `prompts/plain/SKILL.md` | `plain-english/SKILL.md` | `lib/ai/plain-sync.test.ts` |
| `prompts/ste/` | `simplified-technical-english/` | `lib/ai/ste-sync.test.ts` (copy again: `node scripts/sync-ste.mjs`) |
| `tools/readalong/` | `readalong-audio/` (format and checker) | `lib/readalong/skill-sync.test.ts` |

## Rules for anything added here

The repository is public. A skill here never holds a key, a password, an
email address, a personal folder path, a machine name, or the address or
layout of the live site. Commands are written to run from the repository's
root folder (for example `.claude/skills/readalong-audio/scripts/setup.sh`),
never from one person's home folder. Skills about one person's own machines
(their cluster, their other computers, their note-keeping across projects)
stay in that person's own `~/.claude/skills`.

History: `readalong-audio`, `book-chapters` and `plain-english` came from
Samuel's dotfiles, and `simplified-technical-english` from his bio-skills
plugin, on 2026-10-29 (M37). He keeps his own copies of the last two for his
other projects; the copies here are the originals for Neolibrary.
