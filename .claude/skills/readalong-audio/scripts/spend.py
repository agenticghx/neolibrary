"""Spending log with a hard cap for paid text-to-speech calls.

Every paid call goes through `guard()` *before* it is made, with a cautious
estimate, and through `record()` after, with what was actually billed. The
cap covers all paid providers together. Default $3.00; set READALONG_CAP_USD
to change it. The log is one JSON object per line, so it survives crashes and
can be read by eye.

    python spend.py            # print total spent and what is left
"""
import json
import os
import sys
import time
from pathlib import Path

LOG = Path(os.environ.get("READALONG_SPEND_LOG", Path.home() / ".local/share/readalong/spend.jsonl"))
CAP = float(os.environ.get("READALONG_CAP_USD", "3.00"))


class CapExceeded(RuntimeError):
    pass


def entries():
    if not LOG.exists():
        return []
    return [json.loads(line) for line in LOG.read_text().splitlines() if line.strip()]


def spent():
    return round(sum(e.get("usd", 0) for e in entries()), 4)


def guard(provider: str, estimate_usd: float, what: str):
    """Refuse a call whose estimate would take the total over the cap."""
    total = spent()
    if total + estimate_usd > CAP:
        raise CapExceeded(
            f"Refused: {provider} '{what}' would cost about ${estimate_usd:.3f}; "
            f"${total:.3f} of the ${CAP:.2f} cap is already spent."
        )


def record(provider: str, usd: float, what: str, **details):
    LOG.parent.mkdir(parents=True, exist_ok=True)
    entry = {"at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "provider": provider, "usd": round(usd, 5), "what": what, **details}
    with LOG.open("a") as f:
        f.write(json.dumps(entry) + "\n")
    return entry


if __name__ == "__main__":
    for e in entries():
        print(f"{e['at']}  {e['provider']:<11} ${e['usd']:.4f}  {e['what']}")
    print(f"Spent ${spent():.4f} of ${CAP:.2f}; ${CAP - spent():.4f} left.")
    sys.exit(0)
