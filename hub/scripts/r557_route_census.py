#!/usr/bin/env python3
"""R557 — census of the REST route surface (mechanical).

Two questions, per R556's methodology:

  Q1 (MENTIONS): how many suites in the whole tree name this route at all?
  Q2 (END-TO-END): how many of THOSE import the production RestServer and
      actually drive it?

A route with mentions == 0 is a TOTAL hole: no suite could ever fail on it,
because no suite knows it exists.

"Names it" = the literal path appears QUOTED in the suite (R556 P1: a word
boundary is not enough; `publish-stream` breaks \\b). We match both quoted
forms and URL-path literals.
"""
import re, pathlib, sys, collections

HUB = pathlib.Path(__file__).resolve().parents[1]
ROOTS = [HUB / "test", HUB.parent / "plugin" / "test", HUB.parent / "integration-test"]

# The routes whose slice offsets the audit flagged, plus their siblings for
# context. Derived from the router, not hand-listed from memory.
ROUTES = [
    ("/graph/edges/", "DELETE /graph/edges/:id"),
    ("/graph/paths/",  "GET /graph/paths/:from/:to"),
    ("/graph/nodes/",  "GET /graph/nodes/:id"),
    ("/graph/traverse/", "GET /graph/traverse/:id"),
    ("/graph/related/", "GET /graph/related/:id"),
    ("/streams/",      "GET/POST /streams/:topic"),
    ("/sessions/",     "GET/PUT/DELETE /sessions/:id"),
    ("/memory/tags/",  "GET /memory/tags/:tag"),
    ("/topics/",       "GET /topics/:topic"),
]

def quoted_literal_mentions(text: str, route: str):
    """Count occurrences of the route as a QUOTED literal."""
    pats = [f"'{route}", f'"{route}', f"`{route}", f"'{route}", f'"{route}']
    n = 0
    for p in pats:
        n += text.count(p)
    return n

def drives_rest_server(text: str) -> bool:
    """Does this suite import / construct the PRODUCTION RestServer?"""
    return bool(re.search(r"import\s*\{[^}]*\bRestServer\b[^}]*\}\s*from\s*'[^']*rest_server",
                          text)) or "new RestServer(" in text

files = []
for r in ROOTS:
    if r.exists():
        for p in sorted(r.rglob("*.test.ts")):
            files.append(p)

print(f"scanned {len(files)} suite files under {[str(r.relative_to(HUB.parent)) for r in ROOTS if r.exists()]}\n")

# non-vacuity control: are there suites that DO drive the production RestServer?
drivers = [p for p in files if drives_rest_server(p.read_text())]
print(f"NON-VACUITY CONTROL: {len(drivers)} suites drive the production RestServer")
if not drivers:
    print("  <<< CENSUS BROKEN: zero suites drive RestServer => every '0' below is void")
    sys.exit(2)
print()

rows = []
for route, desc in ROUTES:
    mentioning = []
    for p in files:
        t = p.read_text()
        if quoted_literal_mentions(t, route):
            mentioning.append((p, drives_rest_server(t)))
    total = len(mentioning)
    e2e = sum(1 for _, d in mentioning if d)
    rows.append((route, desc, total, e2e, mentioning))

print(f"{'route':22} {'mentions':>9} {'e2e':>5}  severity")
print("-" * 70)
for route, desc, total, e2e, mentioning in rows:
    if total == 0:
        sev = "TOTAL  (no suite knows it exists)"
    elif e2e == 0:
        sev = "LATENT (suites mention it, none drive production)"
    else:
        sev = "covered"
    print(f"{route:22} {total:9} {e2e:5}  {sev}")
    for p, d in mentioning:
        print(f"      {'E2E ' if d else 'stand-in'} {p.name}")

print()
print("=== detail for the zero-mention / latent routes ===")
for route, desc, total, e2e, mentioning in rows:
    if total == 0:
        print(f"  {desc:36} TOTAL — {route}")
print()
print("=== does ANY suite assert a successful DELETE /graph/edges or a session PUT? ===")
for kw in ["graph/edges", "graph/paths", "sessions/sess", "/streams/"]:
    hits = []
    for p in files:
        t = p.read_text()
        if kw in t:
            hits.append(p.name)
    print(f"  {kw:20} -> {len(hits)} suite(s): {hits[:6]}")
