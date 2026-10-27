#!/usr/bin/env python3
"""
Audit the generated corpus's OWN ground truth: is the containment verdict
consistent with the code that was actually emitted?

A corpus whose ground truth is wrong is worse than no corpus: it makes a
scanner look bad for a defect the corpus invented.  R503's rule: the verdict
must be DERIVED from the emitted code, not asserted by the label.

WHY THIS FILE CALLS THE CORPUS'S OWN RULE (R503-C)
---------------------------------------------------
The first version of this audit carried its OWN copy of the containment
rule.  That was a THIRD copy of one rule (the generator's, this audit's,
and the resolving-order audit's), and the copies DRIFTED: the audit scoped
the ORDER rule to the sink kind but still required the guard to constrain
the variable the sink CONSUMED, while the corpus (correctly) also accepts
a guard on the variable a RESOLVING sink PRODUCED.  The drift then showed
up as 15/200 "mismatches" that were really the AUDIT being wrong -- a
report that looked exactly like a corpus defect.

So the audit now calls the corpus's own `derive_containment()` and compares
the DECLARED verdict against a FRESH re-derivation from the file on disk.
A mismatch therefore means the corpus's verdict was not derived from the
code it emitted -- which is the thing worth auditing.

The RULE's correctness is a separate question, and it is pinned by the test
suite's explicit arms (a resolving sink IS confined by a following guard; a
serving sink is NOT), not by this audit.  Separating "is the verdict derived
from the code" from "is the rule right" is what stops the two from being
confused -- which is the confusion that produced the 15 phantom mismatches.
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import r503_generator as G

# The scratch directory is DERIVED, never hardcoded: "/root/.hermes/cache"
# exists on exactly one host.  On every other host (CI included) the script
# died with PermissionError before it measured anything -- and the failure
# read as "the audit found mismatches", which is the worst way to be wrong.
DEST = tempfile.mkdtemp(prefix="r503audit-")
N = 200
SEED = 20261025


def main() -> int:
    manifest = G.generate(DEST, N, SEED)
    preamble_lines = G.PREAMBLE.count("\n")

    print("total %d" % len(manifest))
    bad = []
    for c in manifest:
        src = open(os.path.join(DEST, c["file"]), encoding="utf8").read()
        body = "\n".join(src.split("\n")[preamble_lines:])
        # re-derive from the code THAT WAS EMITTED, using the corpus's own
        # rule -- so a mismatch means the declared verdict was not derived.
        try:
            derived = G.derive_containment(body, c["marker"])
        except Exception as e:                      # noqa: BLE001
            bad.append((c, "DERIVATION RAISED: %s" % e))
            continue
        if derived != c["containment"]:
            bad.append((c, "declared %s but derived %s" % (
                c["containment"], derived)))

    print("MISMATCHES: %d / %d" % (len(bad), len(manifest)))
    byclass = {}
    for c, why in bad:
        byclass.setdefault(c["class"], []).append(why)
    for k in sorted(byclass):
        print("  %-30s %d   %s" % (k, len(byclass[k]), byclass[k][0]))
    if bad:
        print()
        for c, why in bad[:3]:
            print("=== %s  %s" % (c["file"], why))
            print(open(os.path.join(DEST, c["file"]), encoding="utf8").read())
    return 0 if not bad else 1


if __name__ == "__main__":
    raise SystemExit(main())
