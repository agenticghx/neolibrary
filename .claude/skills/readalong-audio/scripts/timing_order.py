"""Keep measured word times in order (used by align.py).

Rarely the aligner puts a word it is unsure of after the next one: in The Grid,
a blurred "T." before "Boone" (score -4.2) came out 0.24 s after it, and
validate_package.py refused the package ("starts before the previous word").
Of two words out of order, the one with the lower score loses its time: it is
not lit, rather than lit at a wrong moment.
"""

SLACK = 0.05  # seconds: validate_package.py allows a word to start this much before the one before it


def in_order(words):
    """The timed words (dicts with "start" and "score") whose starts run forward."""
    kept = []
    for w in words:
        while kept and w["start"] < kept[-1]["start"] - SLACK:
            if w["score"] < kept[-1]["score"]:
                break
            kept.pop()
        else:
            kept.append(w)
    return kept
