#!/usr/bin/env python3
"""ste_check.py - measure text against the measurable parts of ASD-STE100.

Standard library only. Works on any Python 3.8+.

    python3 ste_check.py draft.md
    python3 ste_check.py draft.md --procedural
    python3 ste_check.py draft.md --json
    python3 ste_check.py --text "Close the valve."
    cat draft.md | python3 ste_check.py -

This is a heuristic linter, not a certification tool. It pattern-matches, so it
produces false positives -- a technical name can look like a noun cluster, and
"is required" can look like passive voice when it is the clearest phrasing
available. Read every finding and decide. Overriding the tool with a reason is
correct STE practice; obeying it blindly is not.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field, asdict

MAX_WORDS_PROCEDURAL = 20
MAX_WORDS_DESCRIPTIVE = 25
MAX_SENTENCES_PER_PARAGRAPH = 6
MAX_NOUN_CLUSTER = 3

# ---------------------------------------------------------------- word data

AMBIGUOUS = {
    "since": "after / because",
    "while": "when / although",
    "once": "when / one time",
    "following": "after / these",
    "as": "because / when / like",
}

VERBOSE = {
    "in order to": "to",
    "in the event that": "if",
    "prior to": "before",
    "subsequent to": "after",
    "in the vicinity of": "near",
    "with regard to": "about",
    "with respect to": "about",
    "for the purpose of": "to",
    "in conjunction with": "with",
    "a number of": "some / many",
    "the majority of": "most",
    "at this point in time": "now",
    "due to the fact that": "because",
    "in spite of the fact that": "although",
    "care should be taken": "state the hazard directly",
    "it is necessary to": "you must",
    "in the process of": "omit",
}

FORMAL = {
    "utilize": "use", "utilise": "use", "utilizing": "use", "utilising": "use",
    "commence": "start", "initiate": "start", "terminate": "stop", "cease": "stop",
    "ascertain": "find", "endeavour": "try", "endeavor": "try",
    "procure": "get", "obtain": "get", "perform": "do", "conduct": "do",
    "execute": "do", "indicate": "show", "demonstrate": "show",
    "facilitate": "help", "implement": "do / install",
    "sufficient": "enough", "additional": "more", "approximately": "about",
    "numerous": "many", "assist": "help", "purchase": "buy",
    "verify": "check", "modify": "change", "eliminate": "remove",
    "accomplish": "do", "optimal": "best", "via": "by / through",
    "regarding": "about", "necessitate": "need", "leverage": "use",
    "methodology": "method", "functionality": "function",
    "prioritize": "rank", "prioritise": "rank",
}

# words that are non-approved only in certain parts of speech -- flagged softly
SOFT = {
    "monitor": "look at / check / record (noun in the dictionary)",
    "impact": "effect (noun) / change (verb)",
    "reference": "refer to",
    "interface": "connect to",
    "action": "do (verb use is non-approved)",
}

IRREGULAR_PARTICIPLES = {
    "done", "made", "given", "taken", "seen", "shown", "known", "found",
    "held", "kept", "left", "lost", "meant", "met", "paid", "put", "read",
    "run", "said", "sent", "set", "shut", "sold", "spent", "told", "understood",
    "written", "driven", "chosen", "broken", "spoken", "frozen", "grown",
    "drawn", "worn", "torn", "built", "burnt", "dealt", "felt", "cut",
}

BE_FORMS = {"is", "are", "was", "were", "be", "been", "being", "am"}

# -ing words that are legitimate parts of technical names
ING_ALLOWLIST = {
    "landing", "sequencing", "binding", "operating", "housing", "bearing",
    "coating", "casing", "tubing", "wiring", "packaging", "training",
    "engineering", "screening", "imaging", "sampling", "during", "string",
    "spring", "ring", "thing", "morning", "everything", "something",
    "nothing", "anything", "being", "king", "wing",
}

# Words that end a noun cluster: function words plus high-frequency verbs,
# comparatives and quantifiers. A real tagger would be better; this is the
# pragmatic substitute for a standard-library-only tool.
CLUSTER_STOP = {
    # determiners, pronouns, prepositions, conjunctions
    "the", "a", "an", "this", "that", "these", "those", "each", "every", "any",
    "some", "no", "all", "both", "either", "neither", "such", "its", "his",
    "her", "their", "our", "your", "my", "it", "he", "she", "they", "we",
    "you", "i", "who", "whom", "whose", "which", "what", "there", "here",
    "of", "to", "in", "on", "at", "for", "with", "and", "or", "but", "if",
    "by", "from", "into", "onto", "over", "under", "above", "below", "between",
    "through", "during", "after", "before", "than", "then", "when", "while",
    "as", "so", "because", "since", "until", "unless", "although", "though",
    "about", "against", "across", "along", "among", "around", "behind",
    "beside", "beyond", "near", "off", "out", "up", "down", "per", "via",
    "within", "without", "upon", "toward", "towards", "not", "nor", "yet",
    # be / have / do / modals
    "is", "are", "was", "were", "be", "been", "being", "am", "has", "have",
    "had", "do", "does", "did", "can", "could", "will", "would", "shall",
    "should", "may", "might", "must", "let", "lets",
    # very common lexical verbs
    "use", "uses", "make", "makes", "take", "takes", "give", "gives", "get",
    "gets", "go", "goes", "come", "comes", "see", "sees", "know", "knows",
    "become", "becomes", "cause", "causes", "show", "shows", "find", "finds",
    "need", "needs", "want", "wants", "keep", "keeps", "put", "puts", "set",
    "sets", "run", "runs", "hold", "holds", "start", "starts", "stop", "stops",
    "open", "opens", "close", "closes", "add", "adds", "remove", "removes",
    "check", "checks", "read", "reads", "write", "writes", "move", "moves",
    "turn", "turns", "look", "looks", "work", "works", "help", "helps",
    "mean", "means", "occur", "occurs", "apply", "applies", "allow", "allows",
    "contain", "contains", "include", "includes", "produce", "produces",
    # quantity / degree
    "more", "most", "less", "least", "many", "much", "few", "several", "very",
    "too", "only", "also", "just", "even", "still", "again", "now", "always",
    "never", "often", "usually", "first", "second", "third", "next", "last",
}

CONTRACTIONS = re.compile(
    r"\b(?:can't|won't|don't|doesn't|didn't|isn't|aren't|wasn't|weren't|"
    r"hasn't|haven't|hadn't|shouldn't|wouldn't|couldn't|mustn't|it's|"
    r"that's|there's|they're|we're|you're|i'm|let's|we'll|you'll|it'll)\b",
    re.I,
)

ABBREVIATIONS = {
    "e.g", "i.e", "etc", "vs", "fig", "no", "approx", "dr", "mr", "mrs",
    "ms", "prof", "st", "cf", "al", "min", "max", "sec", "hr", "ca",
}

# ---------------------------------------------------------------- structures


@dataclass
class Finding:
    kind: str
    severity: str          # "error" | "warning" | "info"
    line: int
    message: str
    excerpt: str = ""
    suggestion: str = ""


@dataclass
class Report:
    mode: str
    sentence_limit: int
    n_sentences: int = 0
    n_words: int = 0
    n_paragraphs: int = 0
    findings: list = field(default_factory=list)

    @property
    def n_errors(self):
        return sum(1 for f in self.findings if f.severity == "error")

    @property
    def n_warnings(self):
        return sum(1 for f in self.findings if f.severity == "warning")

    @property
    def compliance(self):
        """Percent of sentences with no error-level finding."""
        if not self.n_sentences:
            return 100.0
        bad = {f.line for f in self.findings if f.severity == "error"}
        clean = max(0, self.n_sentences - len(bad))
        return 100.0 * clean / self.n_sentences


# ---------------------------------------------------------------- text utils


def strip_noise(text: str) -> str:
    """Remove fenced code, inline code, URLs and markdown tables.

    STE governs prose. Linting a code block or a table of part numbers
    produces noise that buries the real findings.
    """
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    text = re.sub(r"~~~.*?~~~", "", text, flags=re.S)
    text = re.sub(r"`[^`]*`", "", text)
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"^\s*\|.*\|\s*$", "", text, flags=re.M)   # table rows
    text = re.sub(r"^\s*[-=]{3,}\s*$", "", text, flags=re.M)  # rules
    return text


def split_paragraphs(text: str):
    """Yield (start_line, paragraph_text). Blank lines separate paragraphs."""
    out, buf, start = [], [], 1
    for i, line in enumerate(text.split("\n"), start=1):
        if line.strip():
            if not buf:
                start = i
            buf.append(line)
        elif buf:
            out.append((start, " ".join(buf)))
            buf = []
    if buf:
        out.append((start, " ".join(buf)))
    return out


def split_sentences(para: str):
    """Split on . ! ? followed by space+capital, protecting abbreviations."""
    para = re.sub(r"^\s*(?:[-*+]|\d+[.)])\s+", "", para)      # list markers
    para = re.sub(r"^#{1,6}\s+", "", para)                    # headings
    protected = re.sub(r"(\d)\.(\d)", r"\1<DOT>\2", para)     # decimals
    for abbr in ABBREVIATIONS:
        protected = re.sub(
            r"\b" + re.escape(abbr) + r"\.", abbr + "<DOT>", protected, flags=re.I
        )
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(])", protected)
    return [p.replace("<DOT>", ".").strip() for p in parts if p.strip()]


def words_of(sentence: str):
    cleaned = re.sub(r"[*_#>\[\]()]", " ", sentence)
    return re.findall(r"[A-Za-z][A-Za-z'\-]*|\d+(?:\.\d+)?", cleaned)


def looks_like_participle(word: str) -> bool:
    lw = word.lower()
    if lw in IRREGULAR_PARTICIPLES:
        return True
    return lw.endswith("ed") and len(lw) > 4


# ---------------------------------------------------------------- the checks


def check_sentence(s: str, line: int, limit: int, findings: list):
    ws = words_of(s)
    n = len(ws)
    low = " " + s.lower() + " "

    if n > limit:
        findings.append(Finding(
            "sentence_length", "error", line,
            f"{n} words (limit {limit}). Split it into separate sentences.",
            excerpt=s[:110],
        ))

    # passive voice: a form of "be" followed (within 2 words) by a participle
    lw = [w.lower() for w in ws]
    for i, w in enumerate(lw):
        if w in BE_FORMS:
            for j in range(i + 1, min(i + 3, len(lw))):
                if looks_like_participle(lw[j]):
                    findings.append(Finding(
                        "passive_voice", "warning", line,
                        f'possible passive voice: "{ws[i]} {" ".join(ws[i+1:j+1])}"'
                        " -- name the actor, or use the imperative.",
                        excerpt=s[:110],
                    ))
                    break
            else:
                continue
            break

    # forbidden verb forms
    for i, w in enumerate(lw):
        if w in {"is", "are", "was", "were", "be", "been", "am"} and i + 1 < len(lw):
            nxt = lw[i + 1]
            if nxt.endswith("ing") and nxt not in ING_ALLOWLIST:
                findings.append(Finding(
                    "continuous_tense", "error", line,
                    f'continuous tense "{ws[i]} {ws[i+1]}" -- use the simple present'
                    f' or past.', excerpt=s[:110],
                ))
        if w in {"has", "have", "had"} and i + 1 < len(lw):
            if looks_like_participle(lw[i + 1]):
                findings.append(Finding(
                    "perfect_tense", "error", line,
                    f'perfect tense "{ws[i]} {ws[i+1]}" -- use the simple past.',
                    excerpt=s[:110],
                ))

    # -ing at the start of a clause (gerund / participial phrase)
    for m in re.finditer(r"(?:^|,\s+|;\s+)([A-Za-z]+ing)\b", s):
        w = m.group(1).lower()
        if w not in ING_ALLOWLIST:
            findings.append(Finding(
                "ing_form", "warning", line,
                f'"-ing" form "{m.group(1)}" starting a clause -- rewrite with a'
                f' subject and a simple verb.', excerpt=s[:110],
            ))

    # Noun clusters. Without a part-of-speech tagger this can only be
    # approximated: find runs of words that are not function words and are not
    # obviously verbs or adverbs. Breaking the run on -ly, -ed and unlisted
    # -ing words removes most of the false positives that come from verb
    # phrases like "samples become warmer than".
    def breaks_cluster(w: str) -> bool:
        lw = w.lower()
        if lw in CLUSTER_STOP or "'" in w or not w[0].isalpha():
            return True
        if lw.endswith("ly") and len(lw) > 4:
            return True
        if lw.endswith("ed") and len(lw) > 4:
            return True
        if lw.endswith("ing") and lw not in ING_ALLOWLIST:
            return True
        return False

    def flush(run_words):
        if len(run_words) > MAX_NOUN_CLUSTER:
            findings.append(Finding(
                "noun_cluster", "warning", line,
                f'possible noun cluster of {len(run_words)} words:'
                f' "{" ".join(run_words)}" -- unpack it with prepositions,'
                f' or confirm it is a single technical name.',
                excerpt=s[:110],
            ))

    run_words = []
    for w in ws:
        if breaks_cluster(w):
            flush(run_words)
            run_words = []
        else:
            run_words.append(w)
    flush(run_words)

    # vocabulary
    for phrase, better in VERBOSE.items():
        if phrase in low:
            findings.append(Finding(
                "verbose_phrase", "warning", line,
                f'"{phrase}" -> "{better}"', excerpt=s[:110], suggestion=better,
            ))
    seen = set()
    for w in lw:
        if w in seen:
            continue
        seen.add(w)
        if w in FORMAL:
            findings.append(Finding(
                "non_approved_word", "warning", line,
                f'"{w}" -> "{FORMAL[w]}"', excerpt=s[:110], suggestion=FORMAL[w],
            ))
        elif w in AMBIGUOUS:
            findings.append(Finding(
                "ambiguous_word", "warning", line,
                f'"{w}" has more than one meaning -> "{AMBIGUOUS[w]}"',
                excerpt=s[:110], suggestion=AMBIGUOUS[w],
            ))
        elif w in SOFT:
            findings.append(Finding(
                "part_of_speech", "info", line,
                f'"{w}": {SOFT[w]}', excerpt=s[:110], suggestion=SOFT[w],
            ))

    for m in CONTRACTIONS.finditer(s):
        findings.append(Finding(
            "contraction", "warning", line,
            f'contraction "{m.group(0)}" -- write it in full.', excerpt=s[:110],
        ))

    # "/" used as and/or
    if re.search(r"\w/\w", s) and not re.search(r"https?://|\d+/\d+", s):
        findings.append(Finding(
            "slash", "info", line,
            'a "/" between words is ambiguous -- write "and" or "or".',
            excerpt=s[:110],
        ))


def analyse(text: str, procedural: bool = False) -> Report:
    limit = MAX_WORDS_PROCEDURAL if procedural else MAX_WORDS_DESCRIPTIVE
    rep = Report(mode="procedural" if procedural else "descriptive",
                 sentence_limit=limit)
    clean = strip_noise(text)

    for start_line, para in split_paragraphs(clean):
        sentences = split_sentences(para)
        if not sentences:
            continue
        rep.n_paragraphs += 1
        if len(sentences) > MAX_SENTENCES_PER_PARAGRAPH:
            rep.findings.append(Finding(
                "paragraph_length", "warning", start_line,
                f"{len(sentences)} sentences in one paragraph (limit"
                f" {MAX_SENTENCES_PER_PARAGRAPH}). Split it, or check that it"
                f" holds only one topic.",
            ))
        for s in sentences:
            rep.n_sentences += 1
            rep.n_words += len(words_of(s))
            check_sentence(s, start_line, limit, rep.findings)

    rep.findings.sort(key=lambda f: (f.line, {"error": 0, "warning": 1,
                                              "info": 2}[f.severity]))
    return rep


# ---------------------------------------------------------------- output


def print_report(rep: Report, source: str):
    bar = "=" * 68
    print(bar)
    print(f"ASD-STE100 check  ·  {source}  ·  {rep.mode} mode"
          f"  (sentence limit {rep.sentence_limit})")
    print(bar)
    avg = rep.n_words / rep.n_sentences if rep.n_sentences else 0
    print(f"{rep.n_paragraphs} paragraphs · {rep.n_sentences} sentences · "
          f"{rep.n_words} words · {avg:.1f} words/sentence")
    print(f"{rep.n_errors} errors · {rep.n_warnings} warnings · "
          f"compliance {rep.compliance:.0f}%\n")

    if not rep.findings:
        print("No findings. Read it once more yourself -- the checker cannot see")
        print("whether the meaning survived.")
        return

    icon = {"error": "[ERROR]  ", "warning": "[warn]   ", "info": "[info]   "}
    last = None
    for f in rep.findings:
        if f.line != last:
            print(f"\n--- line {f.line} " + "-" * 48)
            last = f.line
        print(f"{icon[f.severity]}{f.kind}: {f.message}")
        if f.excerpt:
            print(f"          > {f.excerpt}")

    print("\n" + bar)
    print("Findings are heuristics. A technical name can look like a noun cluster,")
    print("and some passive flags are the clearest available phrasing. Decide each")
    print("one; do not obey the tool blindly.")


def main(argv=None):
    p = argparse.ArgumentParser(
        description="Check text against measurable ASD-STE100 rules.")
    p.add_argument("path", nargs="?", help="file to check, or - for stdin")
    p.add_argument("--text", help="check this string instead of a file")
    p.add_argument("--procedural", action="store_true",
                   help="instruction text: 20-word limit (default 25)")
    p.add_argument("--json", action="store_true", help="machine-readable output")
    p.add_argument("--fail-under", type=float, default=None,
                   help="exit 1 if compliance is below this percentage")
    a = p.parse_args(argv)

    if a.text is not None:
        text, source = a.text, "--text"
    elif a.path in (None, "-"):
        text, source = sys.stdin.read(), "stdin"
    else:
        with open(a.path, encoding="utf-8") as fh:
            text = fh.read()
        source = a.path

    rep = analyse(text, procedural=a.procedural)

    if a.json:
        print(json.dumps({
            "source": source, "mode": rep.mode,
            "sentence_limit": rep.sentence_limit,
            "paragraphs": rep.n_paragraphs, "sentences": rep.n_sentences,
            "words": rep.n_words, "errors": rep.n_errors,
            "warnings": rep.n_warnings, "compliance": round(rep.compliance, 1),
            "findings": [asdict(f) for f in rep.findings],
        }, indent=2))
    else:
        print_report(rep, source)

    if a.fail_under is not None and rep.compliance < a.fail_under:
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:
        # piping into head/less closes stdout early; that is not an error
        try:
            sys.stdout.close()
        finally:
            sys.exit(0)
