# Security updates: how to fix Dependabot alerts yourself

Written for: Samuel (the owner; a scientist, not a software engineer), so he
can do this without a Claude session. A Claude session can follow it too.
Written 2026-10-29, when the first round (pull request "M38 security
updates") was done this way.

## The words, first

- **Dependency** (or **package**): code written by someone else that
  Neolibrary uses, downloaded from npm (the public library of JavaScript
  code). `package.json` lists the ones Neolibrary asks for by name: these are
  **direct** dependencies (for example `next`, the web framework, and `zod`,
  which checks that data has the right shape).
- **Indirect** (or **transitive**) dependency: a package that one of our
  packages needs in turn. We never asked for `body-parser`; the MCP toolkit
  (`@modelcontextprotocol/sdk`, the piece that lets AI agents talk to the
  library) pulls in `express`, which pulls in `body-parser`.
- **Runtime vs development**: a runtime package runs on the live site; a
  development package runs only on a laptop or in CI (for example `vite`,
  which the unit-test tool uses). A development-only alert cannot hurt
  readers of the live site.
- **Lockfile** (`package-lock.json`): the exact version of every package,
  direct and indirect, that was installed. It makes the laptop, CI and the
  live site run the same code. An indirect package is upgraded by changing
  the lockfile only.
- **Dependabot**: GitHub's robot that compares our lockfile against a public
  list of known security problems and raises an **alert** for each match.
  It is on the repository's Security tab.
- **Advisory**: the public write-up of one security problem: which versions
  are affected, which version is the first fixed one ("first patched
  version"), and what an attacker could do.
- **Severity**: the advisory's own rating: low, medium (npm says
  "moderate"), high, critical. It is about the package in general, not about
  how Neolibrary uses it, so read the advisory before panicking or relaxing.
- **Version numbers** are three numbers, `major.minor.patch`, e.g.
  `16.4.1`. A **patch** step (16.4.0 → 16.4.1) only fixes bugs. A **minor**
  step (16.3 → 16.4) adds features but should not break anything. A
  **major** step (16 → 17) may break things on purpose, and needs its own
  careful pull request. Security fixes should be patch or minor steps.
- **Range**: a package says which versions of its own dependencies it
  accepts. `^2.2.1` means "2.2.1 or any later 2.x". If the fixed version is
  inside the range, npm can upgrade the indirect package with no other change.
- **npm overrides**: a block in `package.json` that forces an indirect
  package to a version its parent did not ask for. A last resort, only when
  the parent's range excludes every fixed version and the parent has no
  newer release. Not needed this time.
- **CI** (continuous integration): the checks GitHub runs on every pull
  request (lint, types, unit tests, real Postgres, the browser tests). A pull
  request merges only when they pass.
- **Pull request (PR)**: a proposed change on its own branch, checked by CI,
  then merged into `main`.

## The steps

Run everything from the repository folder (a fresh worktree is best; see
`CLAUDE.local.md`). Never run `npm audit fix --force`: it makes major
upgrades without asking.

### 1. List the open alerts

```bash
gh api repos/agenticghx/neolibrary/dependabot/alerts --paginate \
  -q '.[] | select(.state=="open") | [.number, .security_advisory.severity, .dependency.package.name, .dependency.scope, .security_vulnerability.first_patched_version.identifier] | @tsv'
```

Each line: alert number, severity, package, `runtime` or `development`, and
the first fixed version. To read one alert in full (what it does, who is
affected, any workaround):

```bash
gh api repos/agenticghx/neolibrary/dependabot/alerts/12 -q '.security_advisory.summary, .security_advisory.description'
```

### 2. See where each package comes from

```bash
npm ls zod body-parser
```

A package at the left edge under `neolibrary@0.1.0` is direct; one indented
under another package is indirect, and the package above it is its parent.
To see which versions a parent accepts:

```bash
jq '.packages["node_modules/express"].dependencies["body-parser"]' package-lock.json
```

### 3. Ask npm what it thinks

```bash
npm audit --omit=dev   # only what runs on the live site
npm audit              # everything, including test tools
```

npm counts one line per package, not per advisory, so its numbers are
smaller than Dependabot's. "fix available via `npm audit fix --force`" only
means the fix is outside the version written in `package.json` (Neolibrary
pins exact versions); it does not mean a major upgrade is needed. Check the
version numbers yourself.

### 4. Upgrade, the smallest step that fixes it

First save the lockfile's versions, so you can see exactly what moved:

```bash
jq -r '.packages|to_entries[]|"\(.key) \(.value.version)"' package-lock.json | sort > /tmp/lock-before.txt
```

- **A direct dependency**: change its version in `package.json` to the first
  fixed version, then `npm install`. Some packages travel in pairs and should
  move together: `next` and `eslint-config-next` always share a version.
- **An indirect dependency whose parent's range includes the fix**: update it
  in the lockfile only, naming it (never a bare `npm update`, which moves
  everything):

  ```bash
  npm update body-parser qs ip-address fast-uri vite
  ```

  npm picks the newest version inside the parent's range, which can be a
  little newer than the first fixed version. That is fine for a patch step.
- **An indirect dependency whose parent's range excludes every fix**: first
  look for a newer release of the parent (`npm view <parent> versions`). Only
  if there is none, add an `overrides` block to `package.json`:

  ```json
  "overrides": { "body-parser": "2.4.0" }
  ```

  then `npm install`, and write down in the PR why it was needed.
- **Only a major upgrade fixes it**: stop. Open an issue for it, and decide
  whether the danger applies to Neolibrary (step 7) before taking it on.

Then check what moved:

```bash
jq -r '.packages|to_entries[]|"\(.key) \(.value.version)"' package-lock.json | sort > /tmp/lock-after.txt
diff /tmp/lock-before.txt /tmp/lock-after.txt
```

Every changed line should be a package you meant to move, or something it
needs (Next.js brings its own `@next/...` pieces; vite brings `rolldown`). If
an unrelated package moved, find out why before going on.

### 5. Prove nothing broke

```bash
npm audit --omit=dev && npm audit       # both should say "found 0 vulnerabilities"
npm run check                           # lint, types, unit tests
npm run build                           # the production build
PORT=3200 npx playwright test --ignore-snapshots   # every browser test
```

The browser tests take 10 to 15 minutes on the Mac. `--ignore-snapshots`
skips the picture comparisons, because the reference pictures are Linux
renders; CI compares them. A failing test that is listed in
`docs/ci-flakes.md` (a known flaky test) is re-run once before judging it.
If the same test fails twice, run it once with the old package versions
(`git checkout origin/main -- package.json package-lock.json && npm ci`,
run the test, then `git checkout HEAD -- package.json package-lock.json && npm ci`):
if it fails there too, the upgrade did not cause it. A failure early in the
suite stops the tests that depend on it ("did not run"); adding
`--retries=1` lets a flaky test try once more so the rest still run.
Leave out `PORT=3200` if nothing else on the laptop is running browser tests.

Do the upgrades in two commits when one of them is large (a framework like
Next.js) so that, if something breaks, you know which one did it.

### 6. Open the pull request

Branch names start with the milestone number: use the next free one in
`docs/plan.md` (38 was this round), or reuse `m38-` for a later round.
Make the branch before step 4:

```bash
git fetch origin && git switch -c m38-security-updates-2 origin/main   # before step 4
git add package.json package-lock.json docs/security-updates.md PROGRESS.md LEARNING_LOG.md
git commit -m "Security: ..."
git push -u origin m38-security-updates-2
gh pr create --base main --title "Security: ..." --body-file /tmp/pr-body.md
```

The PR description pastes the `npm audit` before and after and the test
results. CI must be green before it merges. Once it merges and is deployed,
Dependabot closes the alerts on its own (it reads the lockfile on `main`).
They are only fixed on the live site after a deploy.

### 7. When it is safe to dismiss an alert instead

Dismissing tells GitHub "we have looked at this and accept it". Do it only
when an upgrade is impossible for now (only a major version fixes it) **and**
the danger cannot reach Neolibrary, and always with a written reason that
names the evidence. Good reasons: the vulnerable code is never run (for
example a Windows-only bug in a test tool used only on a Mac and Linux CI),
or the package is development-only and the attack needs someone on our own
network while the dev server runs. Never dismiss a runtime critical or high
alert because it is inconvenient.

```bash
gh api -X PATCH repos/agenticghx/neolibrary/dependabot/alerts/4 \
  -f state=dismissed \
  -f dismissed_reason=not_used \
  -f dismissed_comment="Windows-only bug in vite's editor launcher; vite runs only in unit tests on macOS and Linux CI. Upgrade when vite 9 lands (issue #N)."
```

`dismissed_reason` is one of: `fix_started`, `inaccurate`, `no_bandwidth`,
`not_used`, `tolerable_risk`. Re-open one with `-f state=open`.

## Today's alerts (2026-10-29)

Sixteen open alerts in six packages, plus one npm found that Dependabot had
not (`qs`). All fixed with patch or minor steps; no overrides, no dismissals.

| Package | How it gets in | Alerts (severity) | What it means for Neolibrary | What was done |
|---|---|---|---|---|
| next (the web framework) | direct, runtime | 2 critical, 1 high | The live server itself. Critical 1: code execution through `"use cache"` functions; Neolibrary has none. Critical 2: code execution through image resizing on Linux, via `sharp`; the lockfile already had the fixed `sharp` 0.35.5, but the fixed Next.js guarantees it. High: a crafted request can tie up the server's processor through Server Actions (forms that call the server); Neolibrary uses them (`app/(app)/actions.ts`, `app/(public)/actions.ts`), so this one applied to the live site. | 16.3.8 → 16.4.1 (minor step; no 16.3.x fix exists), with `eslint-config-next` |
| zod (checks data shapes) | direct, runtime | 1 high | A huge list sent to a check can use up the server's memory. In Neolibrary the only zod checks on incoming requests are the agent (MCP) endpoint's, which needs an agent token first. | 4.6.5 → 4.6.6 |
| body-parser | indirect (MCP toolkit → express), runtime | 1 high | A compressed request with extra bytes crashes a server that uses it. Neolibrary's MCP endpoint uses the toolkit's web-standard transport, not express, so this code never runs on the live site. | 2.3.0 → 2.4.0, lockfile only |
| fast-uri | indirect (ajv, used by the MCP toolkit and stylelint), runtime | 2 medium, 2 low | Some web addresses are read the wrong way. ajv uses it on the schemas Neolibrary itself defines, not on readers' input. Low real risk. | 3.1.8 → 3.1.9, lockfile only |
| ip-address | indirect (MCP toolkit → express-rate-limit), runtime | 1 medium | A long crafted string makes an address check slow. Not reached: Neolibrary does not use express-rate-limit. | 10.7.3 → 10.7.5, lockfile only |
| vite | indirect (vitest, the unit-test tool), development | 1 high, 4 medium, 1 low | Bugs in vite's development server and its "open in editor" helper; three are Windows-only. Vite runs only in unit tests on the Mac and in CI, never on the live site. | 8.3.2 → 8.3.5, lockfile only (brings `rolldown` 1.2.16, which vite 8.3.5 requires) |
| qs (reads web-form data) | indirect (express, body-parser), runtime | not in Dependabot; npm says moderate | A crafted value crashes one formatting call. Not reached, for the same reason as body-parser. | 6.16.0 → 6.17.1, lockfile only, with body-parser |

One new build warning came with Next.js 16.4.1: "Dynamic filesystem access
causes tracing of the whole project" for `lib/db/migrate.ts` (16.3.8 already
gave the same warning twice for `lib/library/samples.ts`). It affects only
the "standalone" build output, which Neolibrary does not use
(`next.config.ts` has no `output: "standalone"`); the build still succeeds.
