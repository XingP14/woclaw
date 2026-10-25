#!/usr/bin/env python3
"""
R504 -- THE MEASUREMENT: does the TRUST rule keep the sensitivity and lose
the over-taint?

Three legs, all measured, none inherited:

    (1) FIXED corpus      -- the R502 list corpus must not regress.
    (2) GENERATED corpus  -- R503's generator corpus (request-derived).
    (3) ORIGIN corpus     -- R504's generator corpus (the TRUST axis).
    (4) PRODUCTION        -- the real repos.

And a differential arm: the trust detector and the baseline must agree on
every hit they BOTH produce, and the trust detector must not lose a real
vulnerability.

THE KEY NUMBER
---------------
R503 measured the ROLE repair:

    GENERATED 28/60 -> 60/60   PRODUCTION 6 -> 25   (19 config hits)

If the TRUST rule is the fix R503 was looking for, it must show:

    GENERATED >= 29/60 (no regression from the baseline's 29)
    ORIGIN    = the axis a role rule cannot score
    PRODUCTION 6 hits (no explosion) -- and the 19 config hits GONE
"""
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import r502_corpus      # noqa: E402
import r503_generator   # noqa: E402
import r504_origin_generator  # noqa: E402

BASELINE = os.path.join(HERE, "r502_detector.py")
TRUST = os.path.join(HERE, "r504_detector_trust.py")

REPO = os.path.dirname(os.path.dirname(HERE))
PROD_ROOTS = [os.path.join(REPO, "hub", "src"),
              os.path.join(os.path.dirname(REPO), "llm-benchmark", "src")]

# The record format.  The trust detector appends a `trust=` field, so the
# regex must tolerate TRAILING fields -- otherwise the trust variant's hits
# are silently dropped and the variant reads as "0 hits", which is the
# R482-10(2) shape: a parser that cannot read the output is not a green
# result, it is an absent measurement.
REC = re.compile(
    r"^\[(HIGH|LOW\s*)\](\s*\[[A-Z]+\])?\s+(\S+?):(\d+)\s+sink=(\S+)\s+(.*?)\s+"
    r"containment=(YES|NO)\s*(?:\s+trust=(\w+))?\s*$")


def run(scanner, roots):
    proc = subprocess.run([sys.executable, scanner] + list(roots),
                          capture_output=True, text=True, timeout=900)
    return proc.stdout, proc.stderr


def parse(out):
    """-> {basename: [(line, containment, raw)]}"""
    recs = {}
    for l in out.split("\n"):
        m = REC.match(l)
        if not m:
            continue
        path, line = m.group(3), int(m.group(4))
        key = os.path.basename(path)
        recs.setdefault(key, []).append((line, m.group(7).upper(), l.strip()))
    return recs


def score_list_corpus(scanner, cases):
    tmp = tempfile.mkdtemp(prefix="r504-fixed-")
    try:
        r502_corpus.write_corpus(tmp)
        proc = subprocess.run([sys.executable, scanner, tmp],
                              capture_output=True, text=True, timeout=600)
        recs = parse(proc.stdout)
        passed = 0
        failed = []
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
                    ok = False
                    detail = "no hit at line %d" % c["line"]
                else:
                    got = matching[0][1]
                    if got != c["containment"]:
                        ok = False
                        detail = "containment %s != %s" % (got, c["containment"])
            if ok:
                passed += 1
            else:
                failed.append("%s (%s)" % (c["name"], detail))
        return passed, len(cases), failed
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)


def score_gen_corpus(scanner, cases):
    """R503's generator: each case is a file whose sink line is known."""
    recs = None
    # re-generate into a temp dir and scan it
    tmp = tempfile.mkdtemp(prefix="r504-gen-")
    try:
        r503_generator.generate(tmp, len(cases), r503_generator_seed())
        proc = subprocess.run([sys.executable, scanner, tmp],
                              capture_output=True, text=True, timeout=900)
        recs = parse(proc.stdout)
        passed = 0
        failed = []
        for c in cases:
            key = c["file"]
            hits = recs.get(key, [])
            fired = bool(hits)
            want = (c["expect"] == "VULN")
            ok = (fired == want)
            detail = ""
            if c["kind"] == "SUBJECT" and fired:
                matching = [h for h in hits if h[0] == c["line"]]
                if not matching:
                    ok = False
                    detail = "no hit at line %d (fired %s)" % (c["line"], [h[0] for h in hits])
                else:
                    got = matching[0][1]
                    if got != c["containment"]:
                        ok = False
                        detail = "containment %s != %s" % (got, c["containment"])
            if ok:
                passed += 1
            else:
                failed.append("%s (%s)" % (c.get("name", c.get("file")), detail))
        return passed, len(cases), failed
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)


def r503_generator_seed():
    return 20261025


def score_origin_corpus(scanner, cases):
    """R504's corpus: the TRUST axis.

    Each instance is a PAIR of files (svc + main).  The question is not
    "does the scanner fire" but "does it fire exactly on the ATTACKER-
    CONTROLLED instances".

    The svc file holds the sink; the main file holds the registration.
    The scanner is given BOTH, so it can resolve the delivery.
    """
    tmp = tempfile.mkdtemp(prefix="r504-org-")
    try:
        r504_origin_generator.generate(tmp, len(cases), 20261026)
        proc = subprocess.run([sys.executable, scanner, tmp],
                              capture_output=True, text=True, timeout=900)
        recs = parse(proc.stdout)
        passed = 0
        failed = []
        for c in cases:
            key = c["svc"]
            hits = recs.get(key, [])
            fired = bool(hits)
            want = c["attacker_controlled"]
            ok = (fired == want)
            detail = ""
            if want and fired:
                # must fire at the sink line
                sink_line = c["sink_line"]
                matching = [h for h in hits if sink_line.split("(")[0].split()[-1] in h[2]]
                if not matching:
                    ok = False
                    detail = "fired but not at the sink"
            if ok:
                passed += 1
            else:
                failed.append("%s/%s fired=%s want=%s %s" % (
                    c["origin"], c["delivery"], fired, want, detail))
        return passed, len(cases), failed
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)


def prod_hits(scanner):
    roots = [r for r in PROD_ROOTS if os.path.isdir(r)]
    out, err = run(scanner, roots)
    lines = [l for l in out.split("\n") if REC.match(l)]
    return len(lines), len(set(l.split()[2] for l in lines)), lines, err


def main() -> int:
    fixed_cases = r502_corpus.all_cases()
    gen_cases = r503_generator.generate(
        tempfile.mkdtemp(prefix="r504-g-"), 60, r503_generator_seed())
    origin_cases = r504_origin_generator.generate(
        tempfile.mkdtemp(prefix="r504-o-"), 60, 20261026)

    results = {}
    for label, scanner in (("baseline", BASELINE), ("trust", TRUST)):
        fp, ft, ff = score_list_corpus(scanner, fixed_cases)
        gp, gt, gf = score_gen_corpus(scanner, gen_cases)
        op, ot, of = score_origin_corpus(scanner, origin_cases)
        ph, pf, plines, err = prod_hits(scanner)
        results[label] = {
            "fixed": (fp, ft, ff),
            "generated": (gp, gt, gf),
            "origin": (op, ot, of),
            "production": (ph, pf, plines),
        }

    print("R504 -- TRUST as a DECIDABLE property: the measurement")
    print()
    print("corpora: FIXED %d | GENERATED %d | ORIGIN %d" % (
        len(fixed_cases), len(gen_cases), len(origin_cases)))
    print()
    print("%-10s %-16s %-18s %-18s %s" % (
        "variant", "FIXED (list)", "GENERATED (req)", "ORIGIN (trust)", "PRODUCTION"))
    for label in ("baseline", "trust"):
        r = results[label]
        print("%-10s %-16s %-18s %-18s %d hits / %d files" % (
            label,
            "%d/%d %s" % (r["fixed"][0], r["fixed"][1],
                          "PASS" if r["fixed"][0] == r["fixed"][1] else "FAIL"),
            "%d/%d %s" % (r["generated"][0], r["generated"][1],
                          "PASS" if r["generated"][0] == r["generated"][1] else "FAIL"),
            "%d/%d %s" % (r["origin"][0], r["origin"][1],
                          "PASS" if r["origin"][0] == r["origin"][1] else "FAIL"),
            r["production"][0], r["production"][1]))
    print()

    base_lines = set(results["baseline"]["production"][2])
    trust_lines = set(results["trust"]["production"][2])
    lost = base_lines - trust_lines
    gained = trust_lines - base_lines
    print("PRODUCTION DIFFERENTIAL (baseline vs trust)")
    print("  lost by the trust rule : %d" % len(lost))
    for l in sorted(lost):
        print("    - " + l)
    print("  gained by the trust rule: %d" % len(gained))
    for l in sorted(gained):
        print("    + " + l)
    print()

    for label in ("baseline", "trust"):
        r = results[label]
        print("%s ORIGIN failures (first 12):" % label.upper())
        for f in r["origin"][2][:12]:
            print("    " + f)
        if not r["origin"][2]:
            print("    (none)")
        print()

    if "--json" in sys.argv:
        print(json.dumps(
            {k: {kk: vv for kk, vv in v.items() if kk != "production"}
             for k, v in results.items()}, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
