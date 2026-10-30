# Read-along package: format and reference checker

Written for: Claude sessions working on M13 (read along with your own audiobooks).

Copied 2026-10-04 from the `readalong-audio` skill, which makes the packages.
Since M37 (2026-10-29) the skill lives in this repo at
`.claude/skills/readalong-audio/`, and `lib/readalong/skill-sync.test.ts`
fails if these copies drift from it:

- `package-format.md`: the format (`neolibrary-readalong/1`), the contract
  between the skill and the app's importer.
- `validate_package.py`: the skill's checker (Python, standard library only).
  `lib/readalong/package.ts` is its TypeScript port; `package.test.ts` runs
  both on the same packages and requires the same verdicts.

If the format changes, change it in the skill and here together, and bump the
version name.
