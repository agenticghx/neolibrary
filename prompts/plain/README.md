# Plain English source file

Written for: Claude sessions working on the Plain rewrite (the "Plain" level of
AI explanations, and the Rewrite panel's "Plain English").

`SKILL.md` was copied on 2026-10-10 from Samuel's plain-english skill. Since
M37 (2026-10-29) the original for this project lives in this repo, at
`.claude/skills/plain-english/SKILL.md` (Samuel keeps his own copy on his
laptop for his other projects; the two may differ). When the original changes,
copy it again:

    cp .claude/skills/plain-english/SKILL.md prompts/plain/SKILL.md

`lib/ai/plain-sync.test.ts` fails when the copy differs from the original. It
runs everywhere, GitHub's test machines included. Set `PLAIN_SKILL_DIR` to
compare against another folder.

The app sends the skill without its header (`lib/ai/plain-prompt.ts`), inside
`prompts/plain-rewrite.md`. The skill's checker script (`plain_check.py`) is
not used by the app yet.
