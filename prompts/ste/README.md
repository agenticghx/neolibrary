# STE source files

Written for: Claude sessions building the STE rewrite mode (M6).

Copied 2026-10-03 from Samuel's skill at
`~/projects/llm_configs/plugins/bio-skills/skills/simplified-technical-english/`
(the original; re-copy when it changes). `SKILL.md` = method and strictness
levels; `rules.md` and `substitutions.md` = the rules and word swaps;
`ste_check.py` = the reference checker (Python, standard library only) to
port to TypeScript, matching its output on the same inputs.

## Keeping the copy in step (K2)

- `node scripts/sync-ste.mjs` copies the four files from the original again
  and prints which ones changed. Set `STE_SKILL_DIR` to use another folder.
- `lib/ai/ste-sync.test.ts` fails when any copy differs from the original,
  and tells you to run the script. It runs only where the original exists
  (Samuel's laptop); on GitHub's test machines it is skipped.
