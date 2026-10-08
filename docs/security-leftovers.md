# Security review leftovers

Written for: Samuel, and the session that builds or reviews these fixes.
The review is the one on 2026-10-07 (PROGRESS.md, 10:55 UTC). A1–A4 and B1
are already on `main` and deployed. This file is the rest.

## CI, and why these are one pull request

Question: would these checks be faster if CI ran on this Mac?

The tests themselves, yes. This machine is an Apple M5 Max (18 cores, 64 GB).
On 2026-10-06 the full browser suite here finished in about 7 minutes
(`259 passed (6.7m)` in the ledger). GitHub's shared `ubuntu-24.04` runners
are much smaller. Measured from the job steps on 2026-10-07:

| Run | What changed | Browser job, wall clock | Of which, Playwright itself | Of which, installing the two browsers |
|---|---|---|---|---|
| 37676437968 | library import | 14 min 38 s | 12 min 57 s | 38 s |
| 37665575644 | a test-only change | 17 min 30 s | (inside that) | (inside that) |
| 37688455562 | the merge-train skill (docs) | 16 min 34 s | (inside that) | (inside that) |
| 37691183442 | the deploy ledger (docs) | 27 min 8 s | 16 min 36 s | 9 min 4 s |

The other three jobs finish first. Lint and unit tests are about 5–7 minutes.
Postgres is about 1 minute. The pull request waits on the browser job.

That wait was not the whole day. The day was the shape of the work:

- Fourteen pull requests, one after another. The merge train rebases, waits
  for four green checks, then starts the next. Fourteen times 15–27 minutes
  is most of a working day before anyone reads a failure.
- Every merge to `main` starts the four jobs again.
- On 2026-10-07 the browser job failed often enough to need a second full
  run. `e2e/safari.spec.ts:42` did that eight times (see `docs/ci-flakes.md`).
  One success (37657167352) did not start its browser job until 41 minutes
  after the other three, because the runners were busy.
- A docs-only change still installed browsers and ran every page. The ledger
  pull request spent 9 of its 27 minutes downloading Chromium and WebKit.

Running the same commands on this Mac is the right loop before a push.
`npm run check` is lint, types, and unit tests. A change with a browser
test can run that one file here. It does not replace GitHub as the gate:

- The screenshot references are Linux pixels. This Mac draws fonts
  differently, which is why merges download CI's images and commit those.
  A self-hosted Mac runner would fail the screenshot check, or would need
  a second set of references.
- The WebKit stalls happen on CI's Linux build (GStreamer, a slow frame).
  The same test often passes here. Green on the laptop is not the check
  `main` requires.
- The repository is public. A self-hosted runner that picks up pull requests
  runs that code on the machine it is attached to. GitHub's own guidance is
  not to attach a self-hosted runner to a public repository. Fork pull
  requests already need approval before CI runs, and that is the limit
  worth keeping.

`act` (GitHub Actions inside Docker on the Mac) was not timed. Docker on a
Mac is usually slower than GitHub's runners for browsers, and it would still
not be the required check.

What this change does about the time, in the same pull request as the fixes:

1. The five fixes that do not change a page go in one pull request. One
   browser run, not five.
2. Playwright's browsers are cached (`~/.cache/ms-playwright`), so the
   install is not a 9-minute download on every run. The system libraries
   (`--with-deps`) still install; those are the short part.
3. The browser job is skipped when every changed file is docs, a root
   Markdown file, `.claude/`, or `.github/`. The job still succeeds, so
   branch protection stays green. Any other file (including `lib/` and
   `app/`) runs the browser tests. An empty file list runs them too.
   This pull request changes `app/` and `lib/`, so it still runs them once.

B4 is not in this pull request. It adds a page, so it needs reference
screenshots from CI. That is a second pull request, after this one is green.

## The six items

An invited reader is required for each of these. A stranger is stopped at
sign-in.

### B2. An upload is held in memory before its size is checked

`POST /api/books` calls `req.formData()`, which reads the whole request,
and only then checks each file against 200 MB (`MAX_BOOK_BYTES` in
`lib/library/ebook.ts`). Voice notes do the same: `formData()`, then the
10 MB check. `POST /api/import` calls `req.json()` with no limit. The
read-along routes already stop at a limit (`bodyBytes` in
`lib/readalong/http.ts`).

Next.js holds a request's whole body while `proxy.ts` runs, and then
forwards at most 10 MB. Book uploads and read-along uploads already skip
the proxy for that reason, and check the sign-in themselves before reading.
Voice notes and the library import did not skip it, so a large body was
held in the proxy even though the route would only see 10 MB.

Fix:

- Read the body with the same stream limit as read-along, and refuse with
  413 before holding more than the limit. A stated length over the limit
  is refused without reading. A body that does not say its length is
  stopped at the limit.
- One book request may be 200 MB plus 64 KB of form framing. The Import
  page sends one file per request, so a drop of several books does not
  become one giant request. A request that still carries several small
  files is accepted when they fit.
- A voice note request may be 10 MB plus 64 KB.
- A library import may be 32 MB of JSON. The export does not contain the
  book files, only their storage keys.

### B5. `/api/health` names the version

`lib/health.ts` reads `RAILWAY_GIT_COMMIT_SHA`. Railway sets that when it
builds from GitHub. A laptop deploy (`railway up`) does not, so the live
check on 2026-10-07 read `commit: null`.

Fix: also read `NEOLIBRARY_COMMIT`. The value must be 7 to 40 hex
characters; anything else is reported as null. A laptop deploy sets it on
the Railway service before `railway up`, so the running server sees it.
Checked against `railway variable set --help` on 2026-10-08:

```
railway variable set NEOLIBRARY_COMMIT=$(git rev-parse HEAD) --service web --skip-deploys
railway up --service web --ci
```

`--skip-deploys` matters. Without it, setting the variable starts a deploy
of the last GitHub build. That build sets `RAILWAY_GIT_COMMIT_SHA`, which
wins over `NEOLIBRARY_COMMIT`, and it is not the code `railway up` is
about to upload. GitHub deploys keep using Railway's own variable.

### B8. CI's screenshot job keeps a write-capable token in the checkout

The browser job has `contents: write` because it pushes images to the
`ci-screenshots` branch. `actions/checkout` stores that token in the job's
git config for every later step, including `npm ci` and Playwright. A
compromised dependency could push to the repository.

Fix: `persist-credentials: false` on that checkout. The screenshot step
already puts the token in its own remote address for the push, and the
comment step uses the action's token, not git. The job still has
permission to write. The token is no longer sitting in git config while
dependencies run.

The other jobs only have read permission. This change is on the job that
can write.

### B3. Parallel paid calls can pass a spending cap

`checkCaps` in `lib/ai/generate.ts` reads what has been spent, then the
paid call happens, then a row is inserted. Two calls at the same moment
can both read the old total and both go ahead. The most they can overshoot
by is one call each. The in-memory "one run per reader" lock on whole-book
narration does not cover a run and a Listen bar, or two different
paragraphs.

This is not Open unknowns row 12. Row 12 would make every paid paragraph
in the server wait its turn, including the second or two of the paid call.
The default there is still "not built" until Samuel says yes.

Fix: before the paid call, reserve the estimate in this process, under a
lock that only covers the check and the reserve. The paid call itself is
not inside the lock, so Listen does not wait for someone else's network
call. The reserve is released after the cost row is inserted (or when the
call fails). A second caller sees the reserve and is refused when the cap
would be passed. If the process is restarted, the reserve goes with it;
the money was not spent unless the row was written. A second copy of the
server would not share the reserve. Railway runs one web service. A
database reservation is the follow-up if that ever becomes two copies.

Call sites: text generation, Listen (`speak`), pictures, and voice-note
transcripts.

### B6. Sign-in timing tells a real email from a made-up one

`authenticate` looks up the email and runs scrypt (a deliberately slow
password hash) only when the account exists and is not disabled. An
unknown email returns at once. The error text is already the same
("That email and password do not match."). The time is not.

Fix: always run scrypt once. Unknown emails and disabled accounts are
checked against a stand-in hash stored in the code. It is a real scrypt
hash of a password that is not used for any account, with the same cost
settings as real passwords (`N = 16384`). It matches nothing. Disabled
accounts still cannot sign in.

### B4. Accounts: disable, password, other sessions, token expiry

Not built in this pull request. It changes what a person sees, so it needs
screenshots from CI. Defaults, so the next pull request can start:

- A page **Account** (`/account`), linked from the account menu. Change
  password: the current password, then a new one of at least 10 characters.
  **Sign out of other sessions**: every session except this browser is
  deleted. **Sign out** stays what it is (this browser only).
- On **Invite** (admin only): each reader, with Disable and Enable.
  Disable sets `disabledAt` (the column already exists; sign-in and
  sessions and API tokens already honour it) and deletes that reader's
  sessions. You cannot disable yourself. Enable clears `disabledAt`.
- API tokens expire 90 days after they are made. A migration adds
  `expires_at`, with a reverse step. Tokens that already exist get
  `created_at` plus 90 days, so nothing expires on the day it ships
  (the tokens were made with M11, 2026-10-04). The Agent access page
  shows the date. An expired token is treated as revoked: `userForApiToken`
  returns null. Revoke still works immediately.

## Still unsettled (not built here)

- **`X-Forwarded-For`.** Sign-in counts attempts by the first address in
  that header (`app/(public)/actions.ts`). A client can send the header.
  Railway appends the real address. Spoofing rotates the per-address limit
  (10 tries). It does not rotate the per-email backstop (50 tries in 15
  minutes, every address together). Left as it was until someone checks
  what Railway actually forwards. Do not "fix" it by trusting the header
  differently without that check.
- **`SETUP_CODE`.** If the variable is unset, the server makes a code at
  startup and prints it in the log. Setup already refuses once any account
  exists, and production has an account. Worth confirming the variable is
  set on Railway so a brand-new database would not depend on a code that
  only appeared in a log. No code change until that is looked up.

## Done when

- `npm run check` passes, including the new unit tests: a book upload and
  a library import that announce a huge length are refused with 413; an
  unknown email and a disabled account use the stand-in hash; two spends
  at once cannot both pass a cap that fits only one, and two that both fit
  do overlap; health reads `NEOLIBRARY_COMMIT`; the browser-job decision
  skips docs and runs for `app/` and `lib/`.
- The upload spec (`e2e/uploads.spec.ts`) still adds three books from one
  drop. That drop is now three requests.
- One pull request, four GitHub checks green, no test weakened. Then B4
  as its own pull request.
