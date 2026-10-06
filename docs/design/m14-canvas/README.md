# M14 design canvas: a local copy

Written for Samuel and for any Claude session, in case the claude.ai account
or organisation changes and the original canvas can no longer be opened.

**What this is.** A copy, taken 2026-10-06, of the private claude.ai design
canvas "Neolibrary Home Prototypes"
(https://claude.ai/artifact/Bcvw4gq5SeemEQdDPxYDFg, version 1791249174-3bbe
plus the "B decided" note): every mockup Samuel chose from in M14, his picks,
and the phone account-button decision.

- `project/canvas.json`: the canvas index (where each board sits, its title,
  the sticky notes and row titles).
- `project/*.dc.html`: one file per board. Each is HTML with a small
  template language (`{{…}}`, `<sc-for>`, `<sc-if>`) and a script at the end
  that supplies the sample data. They need the canvas's own runtime
  (`./support.js`, part of the claude.ai Design artifact type) to render;
  opened directly in a browser they show only the raw template.
- `assets/<id>.jpg`: the 9 images the "Earlier prototypes" board shows
  (smaller copies of `docs/design/prototypes/*.png`). In
  `project/Earlier.dc.html` they are referenced as `/_blob/<id>`.

**The boards, top to bottom** (as `canvas.json` "order" lists them):

| Board | Shows | Decision |
|---|---|---|
| AccountButton | the account button on a phone: A strip on every page, B Home only, C every title row | **B**, 2026-10-06 |
| PicksHome, PicksPhone, PicksPlayer | Samuel's picks drawn together | picked 2026-10-05 |
| Main, HomeDark, HomeB | Home on desktop: A grid, B spines | A |
| HomePhone, PhoneB | Home on a phone: A grid, B spines | A, with a Grid / Spines switch |
| Players | mini-player A, B, C | B plus a speed menu |
| Progress | progress on covers A, B, C | A (a bar fills) |
| Continue | Continue A, B | B |
| PathPage | a Path page (one option) | not picked yet (open unknown 3) |
| C4Question, C5Threads | optional Home extras | not in M14 |
| Earlier | Codex prototypes, 2026-10-03 | history |

**To restore it on another account** (any Claude session with the Artifact
tool can do this):

1. Create a new canvas from the Design artifact type (Artifact tool:
   `action: "quickstart"`, `intent: "design"`, then publish with the Design
   type's `type_url` and a title).
2. Upload the 9 images to it as assets (`asset: true`); each gets a new
   `/_blob/<new id>` address.
3. In `project/Earlier.dc.html`, replace each `/_blob/<old id>` with the new
   address (the old id is the file name in `assets/`).
4. Publish `project/canvas.json` with every `project/*.dc.html` as `files`
   (`root` = this folder).

The decisions themselves are recorded in git, so they never depend on the
canvas: `PROGRESS.md` (Decisions) and `docs/m14-home-plan.md` (§1, §4).
