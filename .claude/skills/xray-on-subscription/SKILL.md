---
name: xray-on-subscription
description: Read a book in Samuel's Neolibrary for X-ray (who and what it names, with facts that carry the book's own quotes) on his Claude subscription, on the laptop, and send the answers to the live site, where they are checked and shown in Who & what. Use when Samuel wants the X-ray built for a book, when "Build the X-ray" on the site says AI is not set up, when facts or kinds are missing from a book's names, or when the X-ray reading instructions change.
---

# X-ray on the subscription

Written for Claude sessions working on Neolibrary (`agenticghx/neolibrary`, public). Samuel, the owner, is a scientist: tell him in plain English what was done, what was checked, and what is his to do.

## What this makes

X-ray (Kindle's name) is the panel behind a book: who and what it names, and where. In Neolibrary it is the **Who & what** tab in Study. The names and their trails come from the text at no cost. **Facts** come from Claude reading the book one chapter at a time, told the names known so far: each fact is one short statement with the quote it rests on, and a fact whose quote is not found word for word in the paragraph it names is dropped and counted. A card then shows what the book has said about a name up to where the reader is.

The site's own way, "Build the X-ray" in Who & what, calls Claude from the server and needs an Anthropic key there. This skill does the same reading **on the laptop, on Samuel's subscription** (`claude -p`, $0), then sends each chapter's answer to the live site with his API token. The server hands out the exact request it would have sent (`prompts/xray.md`, byte for byte, with the chapter's text and the names known so far) and refuses any other, so it treats the answers as its own and never reads those chapters again.

## Rules that bound everything

- **Subscription only.** Never call the Anthropic API for this, and never set `ANTHROPIC_API_KEY` for it; the script removes it from `claude -p`'s environment. If the subscription limit is reached, stop and say so; do not switch to the API.
- **Never edit an answer by hand.** The server checks every fact's quote; a poor chapter is read again (delete nothing: a chapter read twice keeps both answers, and the facts come from the newest).
- **Keys by name only.** The owner's API token is the Keychain item `NEOLIBRARY_AGENT_TOKEN` (`keyls` shows it). Never print it, and never ask Samuel to paste it. If it is missing, ask him to make one at /agents and run `keyadd NEOLIBRARY_AGENT_TOKEN` in Terminal.
- **No book text in git.** The script keeps nothing on disk; do not paste chapters or answers into the ledger or a pull request.
- **Deploy only when the code changed.** Sending answers needs no deploy. A change to `prompts/xray.md` does: the server refuses answers read with other instructions than its own.

## The workflow

`S=scripts/xray-on-subscription.ts` below. Every command runs from the repository root with `npx tsx`. On the laptop the token loads from the Keychain only in a login shell, so run anything that uses it through `zsh -ic '…'`.

1. **Find the book and its id** with the token:
   ```bash
   zsh -ic 'curl -s -H "authorization: Bearer $NEOLIBRARY_AGENT_TOKEN" "<site>/api/agent/books?q=<title>"'
   ```
   A scanned book has a text edition beside it (hidden from the lists); read the edition, since the scan's pages have no flowing text. The live site's addresses are in the ledger's deploy entries, never in docs.
2. **See where it stands:**
   ```bash
   zsh -ic 'npx tsx scripts/xray-on-subscription.ts status <site> <book id>'
   ```
3. **Read the chapters**, in the background, and watch its log. About one chapter every 20 to 60 seconds; a long book takes a while.
   ```bash
   zsh -ic 'npx tsx scripts/xray-on-subscription.ts read <site> <book id>' > /tmp/xray-<book>.log 2>&1 &
   ```
   - Each line prints the chapter, how many entries and facts it gave, how many facts were dropped because their quotes were not in the book, the time, and the API price it would have cost.
   - Stopped part-way (or out of subscription), the same command carries on from the next unread chapter.
   - `--chapters 3` reads three and stops: use it first on a new book, then look.
   - `--model claude-haiku-5-5` is the default, as on the server (`AI_MODEL_XRAY`); `--effort medium` likewise.
4. **A book read before the alias rules** (M32 X7, 2026-10-23: the rules that keep an alias only when it is a way of writing the name) is put through them once, with its mentions rebuilt:
   ```bash
   zsh -ic 'npx tsx scripts/xray-on-subscription.ts tidy <site> <book id>'
   ```
   It prints how many entries changed. A book read after the rules needs nothing: every answer goes through them as it is stored.
5. **Look at the result on the live site** (Samuel, or a session with the browser): open the book, Study, Who & what. Names should have kinds (Person, Place…) and a card should show "From this book, up to here" with facts and their quotes. Dropped counts above about one in ten facts mean the model is paraphrasing: say so in the ledger.
6. **Record it in the ledger**: the book, chapters read, facts stored, facts dropped, the API price it would have cost, and what was looked at by eye.

## What can go wrong

- `401` from the site: the token is missing or revoked (/agents).
- `It was read with other instructions`: the server's `prompts/xray.md` changed since the request was fetched; the script fetches each chapter's request fresh, so this means a deploy happened mid-run. Run again.
- `claude -p` says the limit is reached: stop; tell Samuel when it resets; never use the API instead.
- An answer that is not JSON stores as a reading with no facts (the chapter counts as read). Read it again only if it matters: the fake in tests never does this, so there is no "reread" command; delete nothing.
