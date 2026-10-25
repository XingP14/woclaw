#!/usr/bin/env python3
"""
R502 — score a scanner against the PERMANENT corpus.

The point of the corpus is that a scanner's "0 hits on production code" is
evidence ONLY if the scanner has been MEASURED first.  This script is the
measurement gate: it runs a scanner over the corpus and reports, per case,
whether the scanner FIRED and what CONTAINMENT verdict it gave, against the
corpus's ground truth.

Usage:
    python3 r502_score_corpus.py <scanner.py> [--json]

Exit code:
    0  -- the scanner passed every case
    1  -- the scanner failed at least one case (details on stdout)
    2  -- the scanner could not be run at all (a harness failure, NOT a
         scanner failure -- R405's rule: an errored leg is not a zero)

The scanner is invoked as:
    python3 <scanner.py> <corpus_dir>
and its stdout is parsed with the SAME record format the R501/R502 detectors
emit:
    [HIGH] <path>:<line>  sink=<name>  <channels>  containment=<YES|NO>
    [LOW ] ... (same)
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import r502_corpus  # noqa: E402

RECORD = re.compile(
    r"^\[(HIGH|LOW\s*)\]\s+(\S+):(\d+)\s+sink=(\S+)\s+(\S+)\s+containment=(\w+)")

# NOTE the regex: the detectors print `[LOW ]` (a 4-char field, so the columns
# align with `[HIGH]`) -- R501's own output parser matched only `\[(HIGH|LOW)\]`
# and silently DROPPED every LOW record, which made a working detector look
# like 13/13 failures.  The field is `\w*` here on purpose.


def parse(out: str):
    """-> {basename: [(line, fired, containment)]}"""
    recs = {}
    for l in out.split("\n"):
        m = RECORD.match(l)
        if not m:
            continue
        path, line = m.group(2), int(m.group(3))
        key = os.path.basename(path)
        recs.setdefault(key, []).append(
            (line, True, m.group(6).upper()))
    return recs


def score(scanner: str, verbose=False):
    tmp = tempfile.mkdtemp(prefix="r502-corpus-")
    try:
        r502_corpus.write_corpus(tmp)
        cases = r502_corpus.all_cases()
        proc = subprocess.run(
            [sys.executable, scanner, tmp],
            capture_output=True, text=True, timeout=300)
        if proc.returncode not in (0, 1):
            return {"ok": False, "error": "scanner exited %d" % proc.returncode,
                    "stderr": proc.stderr[-2000:], "results": []}
        recs = parse(proc.stdout)
        results = []
        for c in cases:
            key = "case_%s.ts" % c["name"]
            hits = recs.get(key, [])
            fired = bool(hits)
            want_fire = (c["expect"] == "VULN")
            ok = (fired == want_fire)
            detail = ""
            if c["kind"] == "SUBJECT" and fired:
                # the containment verdict at the ground-truth LINE
                gt_line = c["line"]
                matching = [h for h in hits if h[0] == gt_line]
                if not matching:
                    # the scanner fired on the file but not on the named
                    # line: report the lines it did fire on
                    ok = False
                    detail = "no hit at line %d (fired at %s)" % (
                        gt_line, [h[0] for h in hits])
                else:
                    got = matching[0][2]
                    if got != c["containment"]:
                        ok = False
                        detail = "containment %s != %s" % (got, c["containment"])
            results.append({
                "name": c["name"], "kind": c["kind"], "ok": ok,
                "fired": fired, "expect_fire": want_fire,
                "detail": detail,
                "lines": [h[0] for h in hits],
            })
            if verbose and not ok:
                print("  FAIL %-28s %-12s fired=%s want=%s %s" % (
                    c["name"], c["kind"], fired, want_fire, detail))
        return {"ok": all(r["ok"] for r in results), "results": results,
                "error": None}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    scanner = sys.argv[1]
    if not os.path.isfile(scanner):
        print("scanner not found: %s" % scanner)
        return 2
    res = score(scanner, verbose=True)
    if res.get("error"):
        print("HARNESS FAILURE: %s" % res["error"])
        if res.get("stderr"):
            print(res["stderr"])
        return 2
    by_kind = {}
    for r in res["results"]:
        k = by_kind.setdefault(r["kind"], [0, 0])
        k[1] += 1
        if r["ok"]:
            k[0] += 1
    print()
    for k, (ok, tot) in sorted(by_kind.items()):
        print("%-14s %d/%d" % (k, ok, tot))
    print()
    if "--json" in sys.argv:
        print(json.dumps(res["results"], indent=2))
    if res["ok"]:
        print("CORPUS PASS: the scanner is MEASURED")
        return 0
    print("CORPUS FAIL: the scanner is NOT measured -- its '0 hits' is not evidence")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
