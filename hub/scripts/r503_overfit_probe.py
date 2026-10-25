#!/usr/bin/env python3
"""
R503 -- IS THE CORPUS A VALID INSTRUMENT?

R502-A productised the sensitivity corpus (R501-12).  R502's own docstring
already states the sharpest worry about it:

    "R501's own corpus was authored by the same author as the detector, so
     '13/14 sensitive' measured the detector against its own imagination."

R502's fix was to make the corpus PERMANENT, VERSIONED and SEPARATE from the
detector.  That fixes "the corpus is rewritten whenever the detector changes"
-- it does NOT fix "the corpus and the detector came from the same mind".

This file measures the remaining gap, which nobody had measured:

    DOES THE CORPUS DISTINGUISH A SCANNER THAT KNOWS THE CLASS
    FROM A SCANNER THAT HAS MEMORISED THE CORPUS?

THE ADVERSARY
--------------
`r503_memorizer.py` is a scanner with no notion of taint, sites, roots or
sinks.  It carries a LITERAL LOOKUP TABLE from a case's identity to the
verdict that case expects, and emits records in the detectors' format, so the
SAME scorer judges it.

THE FIX, AND WHERE IT COMES FROM
---------------------------------
The static-analysis community already solved this, and R502's corpus is
missing the piece it solved it with.  Semgrep's rule-testing convention
(Semgrep Docs, "Test rules"; semgrep-rules + Shopify/semgrep-rules-1
CONTRIBUTING.md) requires every rule to ship a test file with at least one
TRUE POSITIVE and one TRUE NEGATIVE, and requires the rule to match a
PATTERN with METAVARIABLES ($X, $VAR) rather than literal identifiers:

    // ruleid: my-rule
    var strdata = "hello";
    // ok: my-rule
    var numdata = 1;

The metavariable is the load-bearing part: **a rule written against the
literal identifiers of its own test file cannot be expressed with a
metavariable** -- that is exactly what makes it general rather than
memorised.  Our corpus has no metavariable analogue: every case hard-codes
`PUBLIC_DIR`, `req.url`, `ROOT`, `p`, `raw`, `base`...  So a scanner IS
expressible that keys on those literals.

R503 adds the analogue -- a GENERATOR over the class, with randomised
identifiers, randomised transformation-chain depth and randomised guard
placement (the property-based-testing / Hypothesis generalisation of the
metavariable) -- and measures:

    (a) the memorizer PASSES the FIXED list corpus (a list cannot tell
        memorisation from capability);
    (b) the memorizer FAILS the GENERATED corpus (a generator outruns any
        finite table);
    (c) the real detector PASSES the GENERATED corpus (the corpus
        generalises);
    (d) the OLD detector FAILS the GENERATED corpus (the corpus still
        discriminates the old instrument).

    a corpus that a memorizer can pass is not a measuring instrument;
    a corpus whose unit of truth is a GENERATOR rather than a list is.

USAGE
-----
    python3 r503_overfit_probe.py            # measure all four facts
    python3 r503_overfit_probe.py --json

Exit code 0 iff every measured fact holds.
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import r502_corpus        # noqa: E402  (the FIXED list corpus)
import r503_generator     # noqa: E402  (the GENERATOR)
import r502_score_corpus  # noqa: E402  (the shared scorer)

DETECTOR = os.path.join(HERE, "r502_detector.py")
OLD_DETECTOR = os.path.join(HERE, "r501_detector.py")
MEMORIZER = os.path.join(HERE, "r503_memorizer.py")

GENERATED_N = 60
GENERATED_SEED = 20261025


def md5(path: str) -> str:
    return hashlib.md5(open(path, "rb").read()).hexdigest()


def score_against(scanner: str, corpus_dir: str, cases) -> dict:
    """Run `scanner` over an already-materialised corpus directory and compare
    its FIRING and its CONTAINMENT verdict against the ground truth.

    This is r502_score_corpus.score() with the corpus ALREADY on disk, so the
    SAME comparison code judges the fixed corpus and the generated corpus.
    """
    proc = subprocess.run([sys.executable, scanner, corpus_dir],
                          capture_output=True, text=True, timeout=600)
    if proc.returncode not in (0, 1):
        return {"ok": False, "error": "scanner exited %d" % proc.returncode,
                "stderr": proc.stderr[-2000:], "results": []}
    recs = r502_score_corpus.parse(proc.stdout)
    results = []
    for c in cases:
        key = c["file"] if "file" in c else "case_%s.ts" % c["name"]
        hits = recs.get(key, [])
        fired = bool(hits)
        want_fire = (c["expect"] == "VULN")
        ok = (fired == want_fire)
        detail = ""
        if c["kind"] == "SUBJECT" and fired:
            matching = [h for h in hits if h[0] == c["line"]]
            if not matching:
                ok = False
                detail = "no hit at line %d (fired at %s)" % (
                    c["line"], [h[0] for h in hits])
            else:
                got = matching[0][2]
                if got != c["containment"]:
                    ok = False
                    detail = "containment %s != %s" % (got, c["containment"])
        results.append({"name": c.get("name") or c.get("file"),
                        "kind": c["kind"], "ok": ok, "fired": fired,
                        "expect_fire": want_fire, "detail": detail})
    return {"ok": all(r["ok"] for r in results), "results": results,
            "error": None}


def summarise(res: dict) -> str:
    by = {}
    for r in res.get("results", []):
        k = by.setdefault(r["kind"], [0, 0])
        k[1] += 1
        if r["ok"]:
            k[0] += 1
    return " ".join("%s %d/%d" % (k, v[0], v[1]) for k, v in sorted(by.items()))


def main() -> int:
    facts = {"corpus_md5": md5(os.path.join(HERE, "r502_corpus.py")),
             "generator_md5": md5(os.path.join(HERE, "r503_generator.py")),
             "generated_n": GENERATED_N, "generated_seed": GENERATED_SEED}

    # ---- the FIXED list corpus -----------------------------------------
    fixed_dir = tempfile.mkdtemp(prefix="r503-fixed-")
    r502_corpus.write_corpus(fixed_dir)
    fixed_cases = r502_corpus.all_cases()
    facts["fixed_cases"] = len(fixed_cases)

    # ---- the GENERATED corpus ------------------------------------------
    gen_dir = tempfile.mkdtemp(prefix="r503-generated-")
    gen_manifest = r503_generator.generate(gen_dir, GENERATED_N, GENERATED_SEED)
    facts["generated_cases"] = len(gen_manifest)

    scanners = [("r502_detector", DETECTOR), ("r501_detector", OLD_DETECTOR)]
    if os.path.exists(MEMORIZER):
        scanners.append(("r503_memorizer", MEMORIZER))

    for name, path in scanners:
        if not os.path.exists(path):
            continue
        fixed = score_against(path, fixed_dir, fixed_cases)
        gen = score_against(path, gen_dir, gen_manifest)
        facts[name] = {
            "fixed_corpus": {"ok": fixed["ok"], "summary": summarise(fixed),
                             "error": fixed.get("error"),
                             "failed": [r["name"] for r in fixed.get("results", [])
                                        if not r["ok"]]},
            "generated_corpus": {"ok": gen["ok"], "summary": summarise(gen),
                                 "error": gen.get("error"),
                                 "failed": [r["name"] for r in gen.get("results", [])
                                            if not r["ok"]]},
        }

    print("FIXED corpus md5 %s · %d cases" % (facts["corpus_md5"], facts["fixed_cases"]))
    print("GENERATOR md5 %s · %d cases (seed %d)" % (
        facts["generator_md5"], facts["generated_cases"], GENERATED_SEED))
    print()
    print("%-16s %-26s %-26s" % ("scanner", "FIXED (list)", "GENERATED (generator)"))
    for name in facts:
        if name in ("corpus_md5", "generator_md5", "fixed_cases",
                    "generated_cases", "generated_n", "generated_seed"):
            continue
        f = facts[name]["fixed_corpus"]
        g = facts[name]["generated_corpus"]
        print("%-16s %-26s %-26s" % (
            name,
            f["summary"] + (" PASS" if f["ok"] else " FAIL"),
            g["summary"] + (" PASS" if g["ok"] else " FAIL")))
    print()

    if "--json" in sys.argv:
        print(json.dumps(facts, indent=2))

    checks = []
    mem = facts.get("r503_memorizer")
    if mem:
        checks.append((
            "FACT 1: the memorizer PASSES the FIXED list corpus "
            "(a list cannot tell memorisation from capability)",
            mem["fixed_corpus"]["ok"]))
        checks.append((
            "FACT 2: the memorizer FAILS the GENERATED corpus "
            "(a generator outruns any finite table)",
            not mem["generated_corpus"]["ok"]))
        det = facts.get("r502_detector")
        if det:
            checks.append((
                "FACT 3: the real detector PASSES the GENERATED corpus "
                "(the generated corpus generalises)",
                det["generated_corpus"]["ok"]))
        old = facts.get("r501_detector")
        if old:
            checks.append((
                "FACT 4: the OLD detector FAILS the GENERATED corpus "
                "(the generated corpus still discriminates the old instrument)",
                not old["generated_corpus"]["ok"]))

    ok = True
    for desc, passed in checks:
        print("%-6s %s" % ("PASS" if passed else "FAIL", desc))
        ok = ok and passed
    if not checks:
        print("no checks -- the memorizer is missing")
        return 2
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
