"""python3 -m pytest .claude/skills/readalong-audio/tests -q"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from timing_order import in_order  # noqa: E402


def words(*triples):
    return [{"w": w, "start": s, "score": c} for w, s, c in triples]


def test_the_grid_case_drops_the_unsure_word():
    got = in_order(words(("oilman", 1645.04, -0.006), ("T.", 1646.42, -4.198), ("Boone", 1646.18, -0.291), ("Pickens,", 1646.48, -0.036)))
    assert [w["w"] for w in got] == ["oilman", "Boone", "Pickens,"]


def test_a_late_unsure_word_is_dropped_and_the_rest_kept():
    got = in_order(words(("a", 1.0, -0.1), ("b", 2.0, -0.1), ("c", 1.5, -3.0), ("d", 2.5, -0.1)))
    assert [w["w"] for w in got] == ["a", "b", "d"]


def test_words_in_order_or_within_the_slack_are_all_kept():
    ws = words(("a", 1.0, -0.1), ("b", 0.97, -0.1), ("c", 1.2, -5.0))
    assert in_order(ws) == ws
