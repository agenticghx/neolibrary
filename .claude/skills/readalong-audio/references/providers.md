# Voice providers: what each needs, costs, and what was measured

Measured on 2026-10-04 on an Apple Silicon laptop, with the Frankenstein
chapter V opening (539 characters, public domain) unless stated.

## Contents
- Summary table
- ElevenLabs
- OpenAI
- Kyutai TTS 1.6B (local)
- Kyutai Pocket TTS (local)
- Apps without a command line (Muse and others)
- Audiobooks made elsewhere (bring your own audio)
- What to ask a TTS tool for

## Summary

| Provider | Library key | Cost | Speed | Timings from engine? | Notes |
|---|---|---|---|---|---|
| ElevenLabs | `elevenlabs:<voice_id>` | ~$0.30 / 1,000 chars (default estimate) | ~5 s per call | yes, per character | free preview clips via the voices list |
| OpenAI | `openai:<name>` | gpt-4o-mini-tts: $0.60/1M text tokens + $12/1M audio tokens; capped with an upper bound of $30/1M chars | — | no | needs API credit (account had none on 2026-10-04) |
| Kyutai 1.6B | `kyutai-16b:<voice path>` | free | 33 s audio in 27 s | yes, word starts every 80 ms | first word's time was 0.6 s early; always align anyway |
| Kyutai Pocket | `kyutai-pocket:<name>` | free | 29 s audio in 4 s; 15-min chapter in 1.6 min | no | dropped 2 quoted phrases in one chapter: the check step catches this |
| Manual apps | `manual:<app>` | depends | by hand | no | paste chunks, save audio files |

Accuracy of the aligner (`align.py`) against ElevenLabs' own timings, 98
words: median difference 17 ms, 90% within 37 ms, worst 98 ms. Against
Kyutai 1.6B's engine times: median 0 ms. Engine timings are therefore used
only as a cross-check; every package is timed by the aligner, so all
providers come out equally accurate.

## ElevenLabs

- Key: `ELEVENLABS_API_KEY` in the environment.
- `tts_paid.py elevenlabs --voice <id> text.txt out.mp3 --timings out.json`
  uses the `with-timestamps` endpoint, model `eleven_multilingual_v2`, MP3
  44.1 kHz 128 kbps. The alignment is per character of the text sent; the
  script refuses if the characters differ from the text (it would mean
  ElevenLabs changed the text).
- Price: set `READALONG_ELEVENLABS_USD_PER_1K_CHARS` to the plan's real
  price; the default 0.30 is a cautious overage price. The response header
  `character-cost` is what was billed.
- Voice list (`/v1/voices`) and each voice's `preview_url` clip are free.

## OpenAI

- Key: `OPENAI_API_KEY`. Model `gpt-4o-mini-tts`, which also takes
  `--instructions` ("calm audiobook narrator"). No timings: align.
- The API refused on 2026-10-04 with `insufficient_quota` /
  `credit_balance_exhausted`: the account needs credit at
  platform.openai.com → Billing. ChatGPT/Codex subscriptions do not pay for
  API speech; the Codex CLI cannot make speech itself.
- Built-in voices: alloy, ash, ballad, coral, echo, fable, nova, onyx, sage,
  shimmer, verse (check the API docs if one is refused).

## Kyutai TTS 1.6B (local, MLX)

- Installed at `~/.local/share/kyutai/tts16b` (a Python venv with
  `moshi_mlx`); model `kyutai/tts-1.6b-en_fr` cached by Hugging Face.
- `~/.local/share/kyutai/tts16b/bin/python scripts/tts_kyutai16b.py text.txt out.wav --voice <path> --timings out.json`
- Voices: 901 in the `kyutai/tts-voices` repository (`vctk/…`, `expresso/…`,
  `ears/…`, `voice-donations/…`, `alba-mackenna/…`), downloaded on first
  use. The voice library starts with 9.
- Best for short chunks (`narrate.py` uses 900 characters).

## Kyutai Pocket TTS (local, CPU)

- Installed at `~/.local/share/kyutai/pocket` (`pocket-tts` command).
- `pocket-tts generate --text "…" --voice <name> --output-path out.wav -q`
- 27 built-in voices (alba, javert, marius, cosette, jean, anna, …); any
  short WAV can be cloned with `--voice path.wav`.
- Output is 24 kHz WAV. When joining chunks, convert every piece to one
  format first (narrate.py does): mixing sample rates in ffmpeg's concat
  step once stretched a 15-minute chapter to 27 minutes.
- Seen once: it left out a phrase opening a quotation at the start of a
  chunk. Always run check_script.py on its output.

## Apps without a command line (Muse and others)

Muse (Meta, `/Applications/Muse.app`) is a window app with no command line
or API that a script can drive. Use `narrate.py --voice manual:muse`: it
writes the chunks to paste, the person saves each result as `NN.<ext>` in
the parts folder, and running it again joins them. Then check and align as
usual. The same works for any app that can export audio.

## Audiobooks made elsewhere (bring your own audio)

Have: the audio (one file with chapter marks, or one per chapter), the
scripts it was read from, and ideally a manifest of chapter start/end times.
Word timings supplied with it are optional and are not trusted: in the Kuhn
audiobook they were estimates (no pauses, word length = letters × 0.069 s),
and the "polished" scripts contained about 500 words the narrator never read
in chapter ten alone. `build_package.py` checks and re-times everything.

Read the chapter marks with
`ffprobe -v error -show_chapters -of json book.m4b`.

## What to ask a TTS tool for (when commissioning an audiobook)

1. Word timings produced by the speech engine itself, with real pauses.
2. Keyed by character position to the exact text sent; if the engine
   rewrote text ("1962" → "nineteen sixty-two"), timings for both.
3. Matching the final, edited audio (or each clip's offset in it).
4. Chapter marks in the file and a manifest: title, start, end, script.
5. Where each script piece starts in the book (page, opening words); which
   spoken text is not in the book and which book text was skipped.
6. Optionally EPUB 3 Media Overlays (the publishing standard for read-along).
7. AAC/MP3 at 128 kbps or better.
