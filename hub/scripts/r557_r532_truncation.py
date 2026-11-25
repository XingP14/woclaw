#!/usr/bin/env python3
"""R557 — why R532 saw 2 misaligned sites and R557 sees 4.

R532's `derivePrefixSites()` scans only the 10 lines FOLLOWING each
`path.startsWith(prefix)` guard for the `path.slice(n)` that belongs to it:

    for (let j = i; j < Math.min(lines.length, i + 10); j++) {

A route whose slice is further than 10 lines after its guard is therefore
NOT DERIVED AT ALL — it is silently absent from the subject set, and the
suite's `expect(misaligned.length).toBe(2)` then pins the TRUNCATED count.

This script reproduces R532's derivation EXACTLY (same regexes, same window)
and compares it with an unbounded derivation, so the difference is the
subject set, not a different rule.
"""
import re, pathlib

SRC = pathlib.Path(__file__).resolve().parents[1] / "src" / "rest_server.ts"
lines = SRC.read_text().split("\n")

def derive(window):
    """R532's derivePrefixSites, parameterised by the scan window."""
    sites = []
    for i, ln in enumerate(lines):
        m = re.search(r"path\.startsWith\('([^']+)'\)", ln)
        if not m:
            continue
        for j in range(i, min(len(lines), i + window)):
            s = re.search(r"path\.slice\((\d+)\)", lines[j])
            if not s:
                continue
            prefix = m.group(1)
            slice_at = int(s.group(1))
            sites.append({"prefix": prefix, "sliceAt": slice_at,
                          "aligned": slice_at == len(prefix), "guardLine": i + 1,
                          "sliceLine": j + 1})
            break
    return sites

r532 = derive(10)
unbounded = derive(10**6)

def show(name, sites):
    mis = [s for s in sites if not s["aligned"]]
    print(f"--- {name}: {len(sites)} sites, {len(mis)} misaligned ---")
    for s in sites:
        flag = "OK " if s["aligned"] else "<<< MISALIGNED"
        print(f"   {s['prefix']:20} slice({s['sliceAt']:2}) len={len(s['prefix']):2} "
              f"guard L{s['guardLine']:<5} slice L{s['sliceLine']:<5} {flag}")
    print(f"   misaligned prefixes: {sorted(s['prefix'] for s in mis)}")
    print()

show("R532's derivation (window = 10 lines)", r532)
show("UNBOUNDED derivation (window = infinite)", unbounded)

print("=== the difference ===")
a = {(s["prefix"], s["sliceAt"]) for s in r532}
b = {(s["prefix"], s["sliceAt"]) for s in unbounded}
for item in sorted(b - a):
    print(f"  MISSED BY R532: {item[0]!r} slice({item[1]})  "
          f"(offset {item[1] - len(item[0])})")
print()
print(f"R532 subject set size = {len(a)}   unbounded = {len(b)}   "
      f"truncated = {len(b) - len(a)}")
print()
print("=== R532's own assertion (arm A0) ===")
print("  expect(misaligned.length).toBe(2)   <-- pins the TRUNCATED count")
print(f"  truth: {len([s for s in unbounded if not s['aligned']])} misaligned sites")
