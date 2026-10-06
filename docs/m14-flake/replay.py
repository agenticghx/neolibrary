import json, sys
F = sys.argv[1]
words = json.load(open(F + "/words.json"))
def changes(frames, col):
    out = []
    for at, f in enumerate(frames):
        v = f[col] or ""
        if v and (not out or out[-1][0] != v):
            out.append((v, at, f))
    return out
for name in ["main-recording.json", "pr75a1-recording.json"]:
    fr = json.load(open(F + "/" + name))["frames"]
    bar, lit = changes(fr, 1), changes(fr, 3)
    hist = {}
    first = None
    for i, (b, l) in enumerate(zip(bar, lit)):
        d = b[1] - l[1]
        hist[d] = hist.get(d, 0) + 1
        if d != 0 and first is None: first = (i, b[0], b[1], l[1])
    w51 = words[51]
    late = lambda f: f[0] * 1000 - w51[1] * 1000
    gaps = [round(fr[k][7] - fr[k-1][7]) for k in range(545, 556)]
    print(name, "words bar/lit:", len(bar), len(lit), "bar-lit frame diff histogram:", hist, "first mismatch:", first)
    print("   word 51 =", w51[0], "start", w51[1], "s; bar late %.1f ms, lit late %.1f ms" % (late(bar[51][2]), late(lit[51][2])), "frame gaps 545-555:", gaps)
    allLate = sorted(late2 for late2 in [b[2][0]*1000 - words[i][1]*1000 for i, b in enumerate(lit)])
    print("   lit lateness median %.1f ms, max %.1f ms" % (allLate[len(allLate)//2], allLate[-1]))
