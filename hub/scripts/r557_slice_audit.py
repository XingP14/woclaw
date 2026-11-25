#!/usr/bin/env python3
"""R557 — REST route-table offset audit (mechanical).

THE PLANE. Every REST route that takes a parameter FROM THE PATH does it by
`path.slice(N)` where N is a hand-computed magic number that must equal the
length of the prefix that produced `path`. There is no `path.replace(prefix,'')`
and no `path.substring(prefix.length)`. The magic number IS the contract, and
nothing checks it.

The audit derives the prefix from the router's OWN `path.startsWith('PREFIX')`
guard (the nearest preceding one) and compares len(prefix) with N.

Rules:
  - only ONE-argument slice() calls are prefix slices;
    `slice(0, -9)` / `slice(0, slashIdx)` are RELATIVE slices and are exempt.
  - the nearest preceding guard is the one that produced the path.
    (Matching against ANY guard is how a v1 of this script produced a
     false OK: `/graph/paths/` slice(14) matched the unrelated
     `/memory/recall` guard, which also has length 14.)
"""
import re, sys, pathlib

SRC = pathlib.Path(__file__).resolve().parents[1] / "src" / "rest_server.ts"
lines = SRC.read_text().split("\n")

# 1. every path.startsWith('PREFIX') guard, in source order
guards = []
for i, ln in enumerate(lines, 1):
    for m in re.finditer(r"path\.startsWith\('([^']+)'\)", ln):
        guards.append((i, m.group(1)))

# 2. every ONE-argument slice on a path-derived variable
slices = []
for i, ln in enumerate(lines, 1):
    for m in re.finditer(r"\b(path|memPath|topicName)\.slice\((\d+)\)", ln):
        slices.append((i, int(m.group(2)), m.group(1), ln.strip()))

print("=== route guards (nearest preceding guard wins) ===")
bad = []
for ln, n, var, src in slices:
    cands = [(gl, p) for gl, p in guards if gl <= ln]
    if not cands:
        print(f"  L{ln:5} slice({n:3}) {var:9} <<< NO GUARD")
        bad.append((ln, n, None, src))
        continue
    gl, p = cands[-1]
    ok = len(p) == n
    print(f"  L{ln:5} slice({n:3}) {var:9} guard L{gl:<5} {p!r:20} len={len(p):2}  "
          f"{'OK' if ok else '<<< OFF-BY-' + str(n - len(p))}")
    if not ok:
        bad.append((ln, n, p, src))

print()
print(f"=== {len(bad)} offset mismatch(es) ===")
for ln, n, p, src in bad:
    print(f"  L{ln:5} slice({n}) guard={p!r}  len(prefix)={len(p) if p else '?'}")
    print(f"        {src}")
sys.exit(1 if bad else 0)
