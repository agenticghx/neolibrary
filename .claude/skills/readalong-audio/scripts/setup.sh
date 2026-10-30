#!/bin/sh
# One-time setup for the read-along tools (about 2 GB with the models).
# Makes a Python environment at ~/.local/share/readalong/venv with the
# aligner (ctc-forced-aligner + MMS-300m, downloaded on first use) and the
# transcriber (faster-whisper "small", downloaded on first use). Needs ffmpeg
# and poppler (pdftotext) on the PATH: brew install ffmpeg poppler
set -e
V="$HOME/.local/share/readalong/venv"
command -v ffmpeg >/dev/null || { echo "ffmpeg missing: brew install ffmpeg"; exit 1; }
command -v pdftotext >/dev/null || { echo "pdftotext missing: brew install poppler"; exit 1; }
[ -x "$V/bin/python" ] || python3 -m venv "$V"
"$V/bin/pip" install -q --upgrade pip
"$V/bin/pip" install -q "git+https://github.com/MahmoudAshraf97/ctc-forced-aligner.git" faster-whisper
"$V/bin/python" -c "import ctc_forced_aligner, faster_whisper; print('read-along tools ready in $V')"
