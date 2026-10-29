#!/usr/bin/env python3
"""R517c -- storage-surface reachability: which storage methods does the
PRODUCT actually call?

R406 found ONE dead writer (`addMemoryFeedback`: the only writer of
`memory_feedback`, reachable only from tests) and R399 found the extraction
plane unwired.  Both rounds found their subject BY HAND.

This script measures the whole storage surface mechanically: every public
method of `ClawDB` / the storage classes, classified by who calls it:
  prod     -- at least one call site in src/ (outside db.ts)
  test     -- only call sites in test/
  internal -- called only from within db.ts itself
  none     -- no call site at all

A method whose only callers are tests is a writer that the product never
runs: the column keeps its DEFAULT forever (R406's shape), and the
"green test suite" is the only evidence the feature exists.

A method with NO call site at all is stronger: not even the test suite
believes in it.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
HUB = os.path.dirname(HERE)
SRC = os.path.join(HUB, "src")
# Generated artefact -> _tmp/ (gitignored), not the tracked scripts/ dir.
_OUT_DIR = os.path.join(HUB, "_tmp")
os.makedirs(_OUT_DIR, exist_ok=True)
OUT = os.path.join(_OUT_DIR, "r517c_reachability.json")


def read(p):
    try:
        return open(p, encoding="utf-8").read()
    except OSError:
        return ""


def strip_comments(src):
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            j = src.find("\n", i)
            i = n if j < 0 else j
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            j = src.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def storage_methods(src):
    """-> [names] public methods declared in db.ts"""
    out = []
    for m in re.finditer(
            r"\n  (?:async )?(?!private |protected )(?:static )?([a-zA-Z_]\w*)\s*\(", src):
        n = m.group(1)
        if n in ("constructor", "if", "for", "while", "switch", "catch", "return"):
            continue
        out.append(n)
    return sorted(set(out))


def classify(names, files, facade=()):
    """files: [(label, path, src)]

    A call site INSIDE db.ts is `internal`: the storage module uses its own
    method (e.g. `this.ready = storage.init()`).  It is a real call site
    and must not be counted as "no call site" (R517's own bug #6).
    """
    out = {}
    for n in names:
        pat = re.compile(r"\b" + re.escape(n) + r"\s*\(")
        prod, test, internal = [], [], []
        for label, path, src in files:
            if path.endswith(os.path.join("src", "db.ts")):
                for m in pat.finditer(src):
                    # A DECLARATION is not a call site: `async addMemoryFeedback(`
                    # must not count as the method calling itself.  A real
                    # internal call is preceded by a dot (`this.storage.init()`).
                    pre = src[:m.start()].rstrip()
                    if not pre.endswith("."):
                        continue
                    # `this.storage.X(` is the FACADE forwarding to the
                    # storage class -- it is NOT a product call site.
                    if pre.endswith("storage.") and n in facade:
                        continue
                    line = src[:m.start()].count("\n") + 1
                    internal.append(f"{os.path.relpath(path, HUB)}:{line}")
                continue
            for m in pat.finditer(src):
                line = src[:m.start()].count("\n") + 1
                rec = f"{os.path.relpath(path, HUB)}:{line}"
                if label == "prod":
                    prod.append(rec)
                else:
                    test.append(rec)
        if prod:
            verdict = "prod"
        elif internal and not test:
            verdict = "internal-only"
        elif test:
            # A method called from inside db.ts AND from tests only is
            # reached by the product (the internal call is the product's
            # own boot path) -- `init` is the canonical case: the storage
            # class's init() is called by ClawDB's constructor, and the
            # tests call the same method directly.
            verdict = "test-only" if not internal else "prod-via-internal"
        else:
            verdict = "no-callsite"
        out[n] = {"verdict": verdict, "prod": prod, "test": test, "internal": internal}
    return out


def facade_methods(src):
    """-> set of names that ClawDB merely DELEGATES to the storage class.

    `async addMemoryFeedback(...) { return this.storage.addMemoryFeedback(...) }`
    is a FACADE method: its call site inside db.ts is the facade forwarding,
    NOT the product calling the storage method.  Counting it as an internal
    call site would make EVERY test-only method look product-reachable.

    The CONSTRUCTOR is excluded: `this.storage.init()` there is the
    product's own boot path, and init IS product-reachable.
    """
    out = set()
    for m in re.finditer(r"\n  (?:async )?(constructor|\w+)\s*\([^)]*\)[^{]*\{", src):
        mname = m.group(1)
        i = src.index("{", m.start())
        depth, j = 0, i
        while j < len(src):
            if src[j] == "{":
                depth += 1
            elif src[j] == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        body = src[i:j]
        if mname == "constructor":
            continue
        for fm in re.finditer(r"this\.storage\.(\w+)\s*\(", body):
            out.add(fm.group(1))
    return out


def main():
    dbts = strip_comments(read(os.path.join(SRC, "db.ts")))
    names = storage_methods(dbts)

    prod_files, test_files = [], []
    for root, dirs, files in os.walk(HUB):
        dirs[:] = [d for d in dirs if d not in ("node_modules", "dist", ".git", "coverage")]
        for f in files:
            if not f.endswith(".ts"):
                continue
            p = os.path.join(root, f)
            if "/test/" in p or "/tests/" in p or f.endswith(".test.ts"):
                test_files.append(p)
            elif "/src/" in p:
                prod_files.append(p)

    files = [("prod", p, strip_comments(read(p))) for p in sorted(prod_files)]
    files += [("test", p, strip_comments(read(p))) for p in sorted(test_files)]

    facade = facade_methods(dbts)
    res = classify(names, files, facade)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=1)

    counts = {}
    for n, r in res.items():
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    print(f"storage methods scanned: {len(names)}")
    for k in sorted(counts):
        print(f"  {k:14}: {counts[k]}")
    print()
    for v in ("test-only", "no-callsite", "internal-only"):
        hits = [n for n, r in res.items() if r["verdict"] == v]
        if hits:
            print(f"{v.upper()}:")
            for n in sorted(hits):
                r = res[n]
                where = ", ".join(r["prod"] + r["test"]) or "(none)"
                print(f"  {n:32} {where}")
            print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
