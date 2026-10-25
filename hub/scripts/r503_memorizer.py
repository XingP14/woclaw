#!/usr/bin/env python3
"""
R503 -- THE MEMORIZER: a scanner that knows the ANSWER KEY, not the class.

This file is the ADVERSARY for R503's question:

    Does the corpus distinguish a scanner that KNOWS THE CLASS from a scanner
    that has MEMORISED THE CORPUS?

It has no notion of taint, of sites, of roots, of sinks or of containment.  It
carries a lookup table from a case's IDENTITY to the verdict that case
expects, and it emits records in the same format the real detectors emit, so
the SAME scorer judges it.

That lookup table is trivially expressible BECAUSE THE CORPUS LEAKS ITS OWN
IDENTITY: `r502_corpus.write_corpus()` names every case file
`case_<name>.ts`, and the case names are stable strings.  A scanner that
receives a directory listing can read the answer key off the filenames.

This is not a strawman.  It is what a scanner looks like after a human has
"tuned" it against a corpus by hand -- which is precisely the state R502's
corpus is meant to prevent, and precisely the state that a corpus PASS does
not distinguish from genuine capability.

The fix (R503's proposal) is Semgrep's: make the rule match a PATTERN with
METAVARIABLES rather than the literal identifiers of its own test file, so the
rule cannot be written against the test's text.  R503 measures whether the
corpus, as it stands, allows that defence to be tested.

OUTPUT FORMAT (identical to r501_detector.py / r502_detector.py):

    [HIGH] <path>:<line>  sink=<name>  <channels>  containment=<YES|NO>

Exit code 0 always.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import r502_corpus  # noqa: E402  (the ANSWER KEY this adversary reads)


def build_table() -> dict:
    """case name -> (line, containment or None, sink).

    `line` is the ground-truth sink line, COMPUTED from the marker rather
    than hand-copied (R502's own rule).  `containment` is None for the
    SENSITIVITY/SPECIFICITY cases, where the corpus does not grade it.
    """
    table = {}
    for c in r502_corpus.all_cases():
        name = c["name"]
        if c["kind"] == "SUBJECT":
            line = c["line"]
            containment = c["containment"]
            sink = "readFileSync"
        elif c["kind"] == "SENSITIVITY":
            # any line will do for the SENSITIVITY cases: the scorer only
            # checks whether the scanner FIRED.
            line = r502_corpus.preamble_lines() + 1
            containment = "NO"
            sink = "readFileSync"
        else:  # SPECIFICITY -- must stay silent
            continue
        table[name] = (line, containment, sink)
    return table


def main() -> int:
    roots = sys.argv[1:] or [os.getcwd()]
    table = build_table()
    for root in roots:
        if not os.path.isdir(root):
            continue
        for dp, dn, fn in os.walk(root):
            dn[:] = [d for d in dn if d not in ("node_modules", ".git")]
            for f in sorted(fn):
                if not f.startswith("case_") or not f.endswith(".ts"):
                    continue
                name = f[len("case_"):-len(".ts")]
                if name not in table:
                    # A case this adversary has never seen -- e.g. a held-out
                    # corpus whose cases were re-identified.  It cannot know
                    # the answer, so it stays silent.
                    continue
                line, containment, sink = table[name]
                p = os.path.join(dp, f)
                print("[HIGH] %s:%d  sink=%s  M:memorized  containment=%s" %
                      (p, line, sink, containment))
                print("    | (memorized case %s)" % name)
                print("")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
