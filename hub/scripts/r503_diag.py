#!/usr/bin/env python3
"""Diagnose which generated cases the real detector fails, and WHY."""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import r503_generator as G
import r502_score_corpus as S

# The scratch directory is DERIVED, never hardcoded: "/root/.hermes/cache"
# exists on exactly one host, so on any other host this script died with
# PermissionError before it measured anything.
d = tempfile.mkdtemp(prefix="r503diag-")
manifest = G.generate(d, 60, 20261025)
det = os.path.join(HERE, "r502_detector.py")
proc = subprocess.run([sys.executable, det, d], capture_output=True, text=True)
recs = S.parse(proc.stdout)

fails = []
for c in manifest:
    hits = recs.get(c["file"], [])
    if not hits:
        fails.append((c, "NO HIT AT ALL", []))
        continue
    m = [h for h in hits if h[0] == c["line"]]
    if not m:
        fails.append((c, "hit but not at gt line %d" % c["line"],
                      [(h[0], h[2]) for h in hits]))
    elif m[0][2] != c["containment"]:
        fails.append((c, "containment %s != %s" % (m[0][2], c["containment"]),
                      [(h[0], h[2]) for h in hits]))

print("TOTAL %d  FAILED %d" % (len(manifest), len(fails)))
byclass = {}
for c, why, _ in fails:
    byclass.setdefault(c["class"], []).append(why)
for k in sorted(byclass):
    print("  %-28s %d  %s" % (k, len(byclass[k]), byclass[k][0]))
print()
for c, why, _ in fails[:4]:
    print("=== %s  %s" % (c["file"], why))
    print(open(os.path.join(d, c["file"])).read())
