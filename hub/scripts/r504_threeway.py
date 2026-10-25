#!/usr/bin/env python3
"""
R504 -- THE THREE-WAY COMPARISON: baseline vs ROLE vs TRUST.

R503 measured two of the three:

    baseline  (vocabulary: `req.url`, `msg.x`, ...)   GENERATED 29/60
    role      (every parameter field is a source)      GENERATED 60/60
                                                           PRODUCTION  25 hits

and left the third unmeasured:

    trust     (the origin is a proven per-request binding)

This file measures all THREE on the SAME corpora, so the comparison is
controlled:

    (a) the FIXED corpus    -- the list corpus (R502)
    (b) the GENERATED corpus -- the request-derived class (R503)
    (c) the ORIGIN corpus   -- the TRUST class (R504, this round)
    (d) PRODUCTION          -- the real repos

and it reports, for PRODUCTION, the number of hits each variant produces
and, for the ROLE and TRUST variants, WHICH sites they add and lose.

The claim under test is R503's own:

    "the obvious repair is a WIDENING, not a fix.  The next step is a TRUST
     distinction ... and the generated corpus is the instrument that will
     tell us when that distinction is right."

So the measurement must answer: does the TRUST distinction (1) keep the
sensitivity the ROLE repair bought, (2) lose the over-taint the ROLE repair
created, and (3) score on an axis that the ROLE repair CANNOT score?
"""
import os
import re
import subprocess
import sys
import tempfile
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import r502_corpus            # noqa: E402
import r503_generator         # noqa: E402
import r504_origin_generator  # noqa: E402
import r503_role_overtain     # noqa: E402

BASELINE = os.path.join(HERE, "r502_detector.py")
TRUST = os.path.join(HERE, "r504_detector_trust.py")

REPO = os.path.dirname(os.path.dirname(HERE))
PROD_ROOTS = [os.path.join(REPO, "hub", "src"),
              os.path.join(os.path.dirname(REPO), "llm-benchmark", "src")]

REC = re.compile(
    r"^\[(HIGH|LOW\s*)\](\s*\[[A-Z]+\])?\s+(\S+?):(\d+)\s+sink=(\S+)\s+(.*?)\s+"
    r"containment=(YES|NO)\s*(?:\s+trust=(\w+))?\s*$")


def parse(out):
    recs = {}
    for l in out.split("\n"):
        m = REC.match(l)
        if not m:
            continue
        path, line = m.group(3), int(m.group(4))
        recs.setdefault(os.path.basename(path), []).append(
            (line, m.group(7).upper(), l.strip()))
    return recs


def score_fixed(scanner, cases):
    tmp = tempfile.mkdtemp(prefix="r504-f-")
    try:
        r502_corpus.write_corpus(tmp)
        proc = subprocess.run([sys.executable, scanner, tmp],
                              capture_output=True, text=True, timeout=600)
        recs = parse(proc.stdout)
        passed, failed = 0, []
        for c in cases:
            key = "case_%s.ts" % c["name"]
            hits = recs.get(key, [])
            fired = bool(hits)
            want = (c["expect"] == "VULN")
            ok = (fired == want)
            detail = ""
            if c["kind"] == "SUBJECT" and fired:
                matching = [h for h in hits if h[0] == c["line"]]
                if not matching:
                    ok, detail = False, "no hit at line %d" % c["line"]
                elif matching[0][1] != c["containment"]:
                    ok = False
                    detail = "containment %s != %s" % (matching[0][1], c["containment"])
            if ok:
                passed += 1
            else:
                failed.append(c["name"])
        return passed, len(cases), failed
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def score_generated(scanner, n, seed):
    tmp = tempfile.mkdtemp(prefix="r504-g-")
    try:
        cases = r503_generator.generate(tmp, n, seed)
        proc = subprocess.run([sys.executable, scanner, tmp],
                              capture_output=True, text=True, timeout=900)
        recs = parse(proc.stdout)
        passed, failed = 0, []
        for c in cases:
            hits = recs.get(c["file"], [])
            fired = bool(hits)
            want = (c["expect"] == "VULN")
            ok = (fired == want)
            if c["kind"] == "SUBJECT" and fired:
                matching = [h for h in hits if h[0] == c["line"]]
                if not matching:
                    ok = False
                elif matching[0][1] != c["containment"]:
                    ok = False
            if ok:
                passed += 1
            else:
                failed.append(c.get("class", c["file"]))
        return passed, len(cases), failed
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def score_origin(scanner, n, seed):
    tmp = tempfile.mkdtemp(prefix="r504-o-")
    try:
        cases = r504_origin_generator.generate(tmp, n, seed)
        proc = subprocess.run([sys.executable, scanner, tmp],
                              capture_output=True, text=True, timeout=900)
        recs = parse(proc.stdout)
        passed, failed = 0, []
        for c in cases:
            hits = recs.get(c["svc"], [])
            fired = bool(hits)
            want = c["attacker_controlled"]
            ok = (fired == want)
            if ok:
                passed += 1
            else:
                failed.append("%s/%s" % (c["origin"], c["delivery"]))
        return passed, len(cases), failed
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def prod_hits(scanner):
    roots = [r for r in PROD_ROOTS if os.path.isdir(r)]
    proc = subprocess.run([sys.executable, scanner] + roots,
                          capture_output=True, text=True, timeout=900)
    lines = [l for l in proc.stdout.split("\n") if REC.match(l)]
    return len(lines), len(set(l.split()[2] for l in lines)), lines


def main() -> int:
    fixed_cases = r502_corpus.all_cases()
    role_dir = tempfile.mkdtemp(prefix="r504-role-")
    role_scanner = r503_role_overtain.build_role_variant(
        os.path.join(role_dir, "role_detector.py"))

    variants = (("baseline", BASELINE), ("role", role_scanner), ("trust", TRUST))
    res = {}
    for label, scanner in variants:
        fp, ft, ff = score_fixed(scanner, fixed_cases)
        gp, gt, gf = score_generated(scanner, 60, 20261025)
        op, ot, of = score_origin(scanner, 60, 20261026)
        ph, pf, plines = prod_hits(scanner)
        res[label] = dict(fixed=(fp, ft), generated=(gp, gt),
                          origin=(op, ot), production=(ph, pf), plines=plines,
                          ofail=of)

    print("R504 -- THREE VARIANTS ON THE SAME CORPORA")
    print()
    print("  FIXED     %d cases (R502 list corpus)" % len(fixed_cases))
    print("  GENERATED %d cases (R503 request-derived class)" % 60)
    print("  ORIGIN    %d cases (R504 TRUST class)" % 60)
    print()
    print("%-10s %-14s %-16s %-16s %s" % (
        "variant", "FIXED", "GENERATED", "ORIGIN", "PRODUCTION"))
    for label, _ in variants:
        r = res[label]
        print("%-10s %-14s %-16s %-16s %d hits / %d files" % (
            label,
            "%d/%d %s" % (r["fixed"][0], r["fixed"][1],
                          "PASS" if r["fixed"][0] == r["fixed"][1] else "FAIL"),
            "%d/%d %s" % (r["generated"][0], r["generated"][1],
                          "PASS" if r["generated"][0] == r["generated"][1] else "FAIL"),
            "%d/%d %s" % (r["origin"][0], r["origin"][1],
                          "PASS" if r["origin"][0] == r["origin"][1] else "FAIL"),
            r["production"][0], r["production"][1]))
    print()

    base = set(res["baseline"]["plines"])
    for label in ("role", "trust"):
        cur = set(res[label]["plines"])
        # strip the trailing trust= field so the comparison is on the SITE
        def site(l):
            return re.sub(r"\s+trust=\w+\s*$", "", l)
        b = set(site(x) for x in base)
        c = set(site(x) for x in cur)
        print("%s vs baseline -- PRODUCTION sites" % label.upper())
        print("  lost   : %d" % len(b - c))
        for l in sorted(b - c):
            print("    - " + l)
        print("  gained : %d" % len(c - b))
        for l in sorted(c - b):
            print("    + " + l)
        print()

    shutil.rmtree(role_dir, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
