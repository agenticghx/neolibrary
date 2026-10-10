# Plain English source file

Written for: Claude sessions working on the Plain rewrite (the "Plain" level of
AI explanations, and the Rewrite panel's "Plain English").

`SKILL.md` was copied on 2026-10-10 from Samuel's plain-english skill, at
`~/.local/share/chezmoi/claude/skills/plain-english/SKILL.md`. That is the
original (his dotfiles); `~/.claude/skills/plain-english` links to it. When the
original changes, copy it again:

    cp ~/.local/share/chezmoi/claude/skills/plain-english/SKILL.md prompts/plain/SKILL.md

`lib/ai/plain-sync.test.ts` fails when the copy differs from the original. It
runs only where the original exists (Samuel's laptop); on GitHub's test
machines it is skipped. Set `PLAIN_SKILL_DIR` to compare against another folder.

The app sends the skill without its header (`lib/ai/plain-prompt.ts`), inside
`prompts/plain-rewrite.md`. The skill's checker script (`plain_check.py`) is
not used by the app yet.
