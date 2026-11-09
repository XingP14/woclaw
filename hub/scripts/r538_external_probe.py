#!/usr/bin/env python3
"""R538 external leg — control-first HN/GH probe for the NEGATIVE numeric bound.

Plane under test: an untrusted numeric query parameter that PARSES but is
NEGATIVE. R532 covered the NaN (unparseable) class; this is the lower half.

Discipline (R404/R456): run CONTROL queries first and assert they are
non-zero, so that a zero in a precision leg is evidence and not a dead probe.
"""
import json, urllib.parse, urllib.request, time

HN = "https://hn.algolia.com/api/v1/search?query={q}&hitsPerPage={n}"
GH = "https://api.github.com/search/repositories?q={q}&per_page=5"

def http(url, hdrs=None):
    req = urllib.request.Request(url, headers=hdrs or {"User-Agent": "r538-probe"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"__error__": str(e)}

def hn(q, n=3):
    d = http(HN.format(q=urllib.parse.quote(q), n=n))
    if "__error__" in d:
        return -1, d["__error__"]
    return d.get("nbHits", 0), [h.get("title") or h.get("story_title") for h in d.get("hits", [])[:n]]

def gh(q):
    d = http(GH.format(q=urllib.parse.quote(q)))
    if "__error__" in d:
        return -1, d["__error__"], []
    items = d.get("items", [])
    return d.get("total_count", 0), None, [(i["full_name"], i["stargazers_count"]) for i in items[:5]]

CONTROL = ["agent", "LLM", "AI agent"]
PRECISION = [
    "agent pagination negative limit",
    "agent unbounded result set limit clamp",
    "api negative limit parameter denial of service",
    "agent memory query negative limit",
]

print("=== HN CONTROL (must be non-zero) ===")
for q in CONTROL:
    n, hits = hn(q)
    print(f"  {q!r}: nbHits={n}  {hits}")

print("=== HN PRECISION ===")
for q in PRECISION:
    n, hits = hn(q)
    print(f"  {q!r}: nbHits={n}  {hits}")
    time.sleep(0.4)

print("=== GH CONTROL ===")
for q in ["agent", "LLM"]:
    n, err, items = gh(q)
    print(f"  {q!r}: total={n} {items}")
    time.sleep(1.2)

print("=== GH PRECISION ===")
for q in ["negative limit clamp pagination",
          "unbounded query parameter limit agent",
          "api pagination parameter validation agent"]:
    n, err, items = gh(q)
    print(f"  {q!r}: total={n} {items}")
    time.sleep(1.2)
