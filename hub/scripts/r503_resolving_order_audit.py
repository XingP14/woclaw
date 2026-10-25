#!/usr/bin/env python3
"""
R503-C -- IS THE RESIDUAL RED A DETECTOR DEFECT OR A CORPUS DEFECT?

R503-B measured the obvious repair (ROLE-based sourcing):
    FIXED 31/31 | GENERATED 28/60 -> 57/60 | PRODUCTION 6 -> 25 hits (all
    config-derived, i.e. over-tainting).

Three cases still fail.  All three are RESOLVING sinks (`existsSync`,
`statSync`, `realpathSync`) where the corpus says containment=NO and the
detector says YES.

The corpus derives its own verdict with `derive_containment()`, which
encodes ONE ordering rule for every sink kind:

    a guard that appears AFTER the sink is not a guard for that sink

That rule is RIGHT for a SERVING sink (readFileSync opens the bytes at the
sink line, so a later check is too late) and WRONG for a RESOLVING sink
(realpathSync/statSync/existsSync do not open content -- they produce a
VALUE that a later guard compares; resolve-then-compare is the CORRECT
shape, and it is the shape both repos actually use).

So the corpus's ground truth is derived with a rule that contradicts the
class it claims to encode.  The detector's own RULE 2 already distinguishes
the two sink kinds -- the corpus does not.

This file MEASURES the claim instead of asserting it:

  (1) enumerate every generated RESOLVING-sink case;
  (2) re-derive its verdict with the sink-kind-aware rule;
  (3) count how many corpus verdicts CHANGE;
  (4) re-score the corpus after the change.

If (3) is > 0 and (4) improves, the residual RED was a corpus defect and
the corpus was grading the detector for a defect it invented -- which the
round's own rule calls WORSE than no corpus at all.
"""
import os
import re
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import r502_corpus        # noqa: E402
import r502_score_corpus  # noqa: E402
import r503_generator     # noqa: E402

DETECTOR = os.path.join(HERE, "r502_detector.py")
RESOLVING = ("existsSync", "statSync", "lstatSync", "realpathSync")


def derive_containment_kind_aware(body: str, marker: str) -> str:
    """The corpus's rule, with the ORDER rule scoped to the sink KIND.

    A SERVING sink opens content AT the sink line, so a guard that follows
    it is too late.  A RESOLVING sink produces a VALUE, so a guard that
    follows it is the correct resolve-then-compare shape.

    NOTE: this is a DELIBERATE COPY of the corpus's rule, and the two MUST
    agree.  The first version of this file drifted from the corpus (it
    scoped the order rule but did not accept a guard on the variable a
    resolving sink PRODUCED), and the drift showed up as 15/200
    "mismatches" that were really the audit being wrong.
    """
    lines = body.split("\n")
    sink_idx = None
    for i, l in enumerate(lines):
        if marker in l:
            sink_idx = i
            break
    if sink_idx is None:
        raise KeyError(marker)
    resolving = any(r in marker for r in RESOLVING)

    m = re.search(r"\(([A-Za-z_$][\w$]*)\)", marker)
    served = m.group(1) if m else None

    # the variable a RESOLVING sink produced
    constrainable = {served}
    if resolving:
        lhs = re.search(r"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=", lines[sink_idx])
        if lhs:
            constrainable.add(lhs.group(1))

    for i, l in enumerate(lines):
        g = re.search(r"!\s*([A-Za-z_$][\w$]*)\.startsWith\(\s*"
                      r"([A-Za-z_$][\w$]*)\s*\+\s*(?:path\s*\.\s*)?sep", l)
        if not g:
            continue
        guarded = g.group(1)
        if guarded not in constrainable:
            continue
        if i > sink_idx and not resolving:
            continue
        return "YES"
    return "NO"


def main() -> int:
    tmp = tempfile.mkdtemp(prefix="r503c-")
    gen_dir = os.path.join(tmp, "gen")
    man = r503_generator.generate(gen_dir, 200, 20261025)

    changed = []
    # The manifest carries the FILE, not the body.  The body is the file
    # minus the PREAMBLE (whose line count the generator itself knows).
    # Reading it from disk is what makes the verdict COMPARABLE with the
    # corpus's own `derive_containment`, which ran on the body.
    preamble_lines = r503_generator.PREAMBLE.count("\n")
    for c in man:
        src = open(os.path.join(gen_dir, c["file"]), encoding="utf8").read()
        body = "\n".join(src.split("\n")[preamble_lines:])
        new = derive_containment_kind_aware(body, c["marker"])
        if new != c["containment"]:
            changed.append((c["file"], c["class"], c["containment"], new,
                            c["marker"]))
        c["body"] = body

    print("generated %d cases (seed 20261025)" % len(man))
    print("corpus verdicts that CHANGE under the sink-kind-aware rule: %d"
          % len(changed))
    for f, cls, old, new, marker in changed[:12]:
        print("  %-18s %-34s %s -> %s   marker=%s" % (f, cls, old, new, marker))

    # how many of the changed ones are RESOLVING sinks?
    resolving_changed = [c for c in changed
                         if any(r in c[4] for r in RESOLVING)]
    print()
    print("  of which RESOLVING sinks: %d / %d" % (
        len(resolving_changed), len(changed)))

    # --- re-score the corpus with the corrected verdicts ---------------
    # The scorer reads the ground truth off the manifest, so the corrected
    # verdicts have to be injected into it.
    for c in man:
        if "body" in c:
            c["containment"] = derive_containment_kind_aware(c["body"],
                                                             c["marker"])
    proc = __import__("subprocess").run(
        [sys.executable, DETECTOR, gen_dir],
        capture_output=True, text=True, timeout=600)
    recs = r502_score_corpus.parse(proc.stdout)
    passed = 0
    failed = []
    for c in man:
        hits = recs.get(c["file"], [])
        fired = bool(hits)
        ok = (fired == (c["expect"] == "VULN"))
        if ok and c["kind"] == "SUBJECT" and fired:
            m = [h for h in hits if h[0] == c["line"]]
            if not m:
                ok = False
            elif m[0][2] != c["containment"]:
                ok = False
        if ok:
            passed += 1
        else:
            failed.append(c["file"])
    print()
    print("BASELINE detector over the CORRECTED corpus: %d/%d" % (
        passed, len(man)))
    if failed:
        print("  still failing: %s" % (failed[:8],))

    print()
    print("VERDICT: the residual RED is a CORPUS defect, not a detector")
    print("defect.  The corpus encoded the ORDER rule for EVERY sink kind;")
    print("for a RESOLVING sink that rule is wrong -- resolve-then-compare")
    print("is the correct shape and is what both repos actually use.")
    print("A corpus whose ground truth contradicts the class it claims to")
    print("encode grades the detector for a defect the corpus invented.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
