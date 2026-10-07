# Resolves git conflict blocks keeping both sides, innermost first; an empty side is fine.
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
text = "\n".join(lines)
left = len(re.findall(r"^(<<<<<<< |=======$|>>>>>>> )", text, flags=re.M))
open(path, "w").write(text)
print(f"{path}: {n} block(s) unwound, {left} marker line(s) left")
sys.exit(1 if left else 0)
