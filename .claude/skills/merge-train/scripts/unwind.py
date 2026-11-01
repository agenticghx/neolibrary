# Resolves git conflict blocks keeping both sides, innermost first; an empty side is fine.
# A file that starts with a header between "---" lines (PROGRESS.md) keeps one line per header field afterwards: the
# first one, which is the side named first (theirs with theirs-first). Keeping both made two next_action lines after
# every rebase (2026-11-01).
# usage: python3 unwind.py <file> [theirs-first]
import re, sys
path = sys.argv[1]; theirs_first = len(sys.argv) > 2 and sys.argv[2] == "theirs-first"
lines = open(path).read().split("\n")
def once(lines):
    stack = []
    for i, l in enumerate(lines):
        if l.startswith("<<<<<<< "): stack.append(i)
        elif l == "=======" and stack:
            start = stack[-1]
            for j in range(i + 1, len(lines)):
                if lines[j].startswith("<<<<<<< "): break
                if lines[j].startswith(">>>>>>> "):
                    head, theirs = lines[start + 1:i], lines[i + 1:j]
                    both = (theirs + head) if theirs_first else (head + theirs)
                    return lines[:start] + both + lines[j + 1:], True
    return lines, False
n = 0
while True:
    lines, changed = once(lines)
    if not changed: break
    n += 1
if lines and lines[0] == "---" and "---" in lines[1:]:
    end = lines.index("---", 1)
    seen, header = set(), []
    for l in lines[1:end]:
        key = l.split(":", 1)[0] if re.match(r"^[A-Za-z_][\w-]*:", l) else None
        if key and key in seen: continue
        if key: seen.add(key)
        header.append(l)
    lines = [lines[0]] + header + lines[end:]
text = "\n".join(lines)
left = len(re.findall(r"^(<<<<<<< |=======$|>>>>>>> )", text, flags=re.M))
open(path, "w").write(text)
print(f"{path}: {n} block(s) unwound, {left} marker line(s) left")
sys.exit(1 if left else 0)
