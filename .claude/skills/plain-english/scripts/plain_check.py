#!/usr/bin/env python3
"""Score a text for plainness. Standard library only.

Usage:
  python3 plain_check.py FILE        # or pipe text on stdin
  python3 plain_check.py FILE --json
  python3 plain_check.py --selftest
"""
import json
import re
import sys

LONG_SENTENCE = 25
LONG_WORD_SYLLABLES = 4
ALLOW = {
    "information", "understanding", "experiment", "experimental", "individual",
    "particular", "especially", "everything", "everybody", "interesting",
    "community", "university", "activity", "available", "necessary",
    "material", "original", "situation", "variable", "variables", "evidence",
    "scientific", "theory", "american", "anybody", "ability", "category",
    "identify", "education", "biology", "technology", "population",
    "relationship", "definition", "observation", "observations",
}
PASSIVE = re.compile(
    r"\b(was|were|is|are|been|being|be)\s+(\w+ly\s+)?([a-z]+(?:ed|en))\b", re.I)
NOT_PARTICIPLE = {"often", "even", "open", "garden", "kitchen",
                  "children", "token", "ten", "then", "when", "need", "red",
                  "bed", "hundred", "indeed", "speed", "seed"}
ABBR = re.compile(r"\b[A-Z]{2,6}s?\b")
ABBR_IGNORE = {"I", "OK", "US", "UK", "AM", "PM", "DNA", "RNA", "TV"}


def sentences(text):
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(])", text.strip())
    return [p for p in parts if re.search(r"[A-Za-z]", p)]


def words(text):
    return re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", text)


def syllables(word):
    w = word.lower()
    if len(w) <= 3:
        return 1
    w = re.sub(r"(?:[^laeiouy]es|ed|[^laeiouy]e)$", "", w)
    w = re.sub(r"^y", "", w)
    return max(1, len(re.findall(r"[aeiouy]{1,2}", w)))


def check(text):
    sents = sentences(text)
    ws = words(text)
    n_words = max(1, len(ws))
    n_sents = max(1, len(sents))
    n_syll = sum(syllables(w) for w in ws)
    flesch = 206.835 - 1.015 * (n_words / n_sents) - 84.6 * (n_syll / n_words)

    long_sents = [(len(words(s)), s) for s in sents if len(words(s)) > LONG_SENTENCE]
    long_words = sorted({w.lower() for w in ws
                         if syllables(w) >= LONG_WORD_SYLLABLES
                         and w.lower() not in ALLOW and not w.isupper()})
    passives = [m.group(0) for m in PASSIVE.finditer(text)
                if m.group(3).lower() not in NOT_PARTICIPLE]
    seen, unexplained = set(), []
    for m in ABBR.finditer(text):
        a = m.group(0).rstrip("s") if m.group(0).endswith("s") and m.group(0)[:-1].isupper() else m.group(0)
        if a in ABBR_IGNORE or a in seen:
            continue
        seen.add(a)
        after = text[m.end():m.end() + 2]
        before = text[max(0, m.start() - 1):m.start()]
        if not after.lstrip().startswith("(") and before != "(":
            unexplained.append(a)
    return {
        "sentences": len(sents), "words": len(ws),
        "avg_sentence_words": round(len(ws) / n_sents, 1),
        "flesch_reading_ease": round(flesch, 1),
        "long_sentences": len(long_sents), "long_words": long_words,
        "passive": passives, "unexplained_abbreviations": unexplained,
        "_long_sentence_text": long_sents,
    }


def report(r):
    out = [f"Flesch reading ease: {r['flesch_reading_ease']} (higher is easier; 60-70 ordinary adult prose)",
           f"Sentences: {r['sentences']}  Words: {r['words']}  Average words per sentence: {r['avg_sentence_words']}",
           f"Sentences over {LONG_SENTENCE} words: {r['long_sentences']}"]
    for n, s in r["_long_sentence_text"]:
        out.append(f"  ({n} words) {s[:90]}{'...' if len(s) > 90 else ''}")
    out.append(f"Long words ({len(r['long_words'])}): {', '.join(r['long_words']) or '-'}")
    out.append(f"Likely passive ({len(r['passive'])}): {'; '.join(r['passive']) or '-'}")
    out.append(f"Abbreviations not spelled out on first use ({len(r['unexplained_abbreviations'])}): "
               f"{', '.join(r['unexplained_abbreviations']) or '-'}")
    return "\n".join(out)


def selftest():
    cases = [
        ("The cat sat on the mat. It was happy.",
         dict(sentences=2, long_sentences=0, passive=0, abbr=0, long_words=0)),
        ("The samples were measured by the team. The data are stored.",
         dict(sentences=2, passive=2, abbr=0)),
        ("We ran an ELISA. Then we ran a PCR (polymerase chain reaction) test.",
         dict(abbr=1)),
        ("Researchers " + "who study cells " * 9 + "agree.",
         dict(sentences=1, long_sentences=1)),
        ("The incommensurability of paradigms is philosophically problematic.",
         dict(long_words=3)),
    ]
    ok = True
    for text, want in cases:
        r = check(text)
        got = dict(sentences=r["sentences"], long_sentences=r["long_sentences"],
                   passive=len(r["passive"]), abbr=len(r["unexplained_abbreviations"]),
                   long_words=len(r["long_words"]))
        for k, v in want.items():
            if got[k] != v:
                ok = False
                print(f"FAIL {k}: want {v} got {got[k]} :: {text[:50]}")
    easy = check("The cat sat on the mat.")["flesch_reading_ease"]
    hard = check(cases[4][0])["flesch_reading_ease"]
    if not easy > hard:
        ok = False
        print(f"FAIL flesch ordering: easy {easy} hard {hard}")
    print("selftest: " + ("PASS" if ok else "FAIL") + f" ({len(cases)} cases + reading-ease ordering)")
    return 0 if ok else 1


def main(argv):
    if "--selftest" in argv:
        return selftest()
    args = [a for a in argv if not a.startswith("--")]
    text = open(args[0], encoding="utf-8").read() if args else sys.stdin.read()
    r = check(text)
    print(report(r))
    if "--json" in argv:
        print(json.dumps({k: v for k, v in r.items() if not k.startswith("_")}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
