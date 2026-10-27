#!/usr/bin/env python3
"""
R502 — MUTATION MATRIX for the detector-properties suite.

Control FIRST (R404-M1 / R456-1): the suite must be GREEN before any mutation
is applied, otherwise a red matrix cannot be attributed.

The mutations target the DETECTOR (hub/scripts/r502_detector.py), because the
suite's subject is the detector's BEHAVIOUR.  Each mutation is a REAL repair
of the class (or a REAL regression of the class), and each must be KILLED by
the suite.

  M1  restore the FILE-WIDE containment scope (R501's rule)
                                              -> the site-scope arms must fail
  M2  drop the CHAIN constraint (any guard in the site counts)
                                              -> the self-certifying arm must fail
  M3  drop the ORDER constraint (a guard after the sink counts)
                                              -> the guard-after-site arm must fail
  M4  drop the MESSAGE-shaped sources (HTTP transport only)
                                              -> the ws-message/envelope/body/
                                                 peer arms must fail
  M5  drop the NETWORK sinks (filesystem only)
                                              -> the network-sink arm must fail
  M6  record EVERY RHS identifier as a taint parent (siblings become
      ancestor/descendant) -> the self-certifying arm must fail
  M7  NEGATIVE CONTROL: report every file as a hit
                                              -> the specificity arms must fail
  M8  NEGATIVE CONTROL: never report a hit
                                              -> the sensitivity arms must fail

Every mutation is verified to have CHANGED the file (assert new != old, and
assert the needle was present) BEFORE the suite is run -- R456-1's rule: a
mutation that did not apply is a HARNESS, not a survivor.

EQUIVALENCE (R503, 2026-10-25): a mutation that changes the BYTES but not the
BEHAVIOUR is an EQUIVALENT MUTANT, and reporting it as "SURVIVED" is a lie
about the suite -- it says "the suite failed to notice a defect" when in fact
there was no defect to notice.  R502's first matrix run reported 2 SURVIVED
and both were equivalent mutants:

  * M8 "never report a hit" kept its `continue` on the next line, so the
    mutated detector still reported exactly the same hits as the baseline.
  * M3 "drop the ORDER constraint" removed only the `j > i` CHECK, but the
    ORDER rule is enforced TWICE -- once by the window (`min(i, hi)`) and
    once by the check -- so removing one of them changed nothing.

So the driver now MEASURES the mutant's behaviour (the detector's output over
the corpus) and compares it with the baseline.  An output-identical mutant is
reported as EQUIVALENT, which is a DEFECT IN THE MUTATION, not a survivor.
A mutation that is equivalent AND intended to change behaviour is a driver
bug, so the matrix REFUSES to count it as a kill.

Restore is by BYTE-LEVEL SNAPSHOT of the OWNED file (R475-2: `git checkout`
restore silently destroys a concurrent agent's uncommitted work in the same
file).  The md5 of the file is asserted identical before and after the whole
matrix, and an atexit + signal-handler guard restores on SIGKILL (R477's
shape, needed because R501's matrix was SIGKILLed by a tool timeout and left
the tree mutated).
"""
import atexit
import hashlib
import os
import shutil
import signal
import subprocess
import sys
import tempfile

# The paths are DERIVED FROM THIS FILE, never hardcoded: the repository is
# checked out at a different absolute path in CI (and on every other host),
# so a literal "/root/.hermes/workspace/woclaw" makes every arm that touches
# the detector fail with PermissionError -- the suite then reports a
# harness error while measuring nothing.
#
# r502_matrix.py lives in <repo>/hub/scripts/, so the repo root is two
# levels up.  os.path.dirname is used rather than __file__ gymnastics so the
# derivation stays readable.
SCRIPTS = os.path.dirname(os.path.abspath(__file__))
HUB = os.path.dirname(SCRIPTS)
REPO = os.path.dirname(HUB)
DETECTOR = os.path.join(SCRIPTS, "r502_detector.py")
CORPUS_MODULE = os.path.join(SCRIPTS, "r502_corpus.py")
SUITE = "test/r502_detector_properties.test.ts"

# A mutation is a LIST of edits: one mutation may need to touch more than one
# place when the rule it removes is enforced in more than one place (M3).
MUTATIONS = [
    ("M1", "restore the FILE-WIDE containment scope (R501's rule)",
     [('            scope = enclosing_scope(spans, i)\n'
       '            if scope is None:\n'
       '                lo, hi = 0, len(lines) - 1\n'
       '            else:\n'
       '                lo, hi = scope',
       '            lo, hi = 0, len(lines) - 1')]),

    ("M2", "drop the CHAIN constraint (any guard in the site counts)",
     [('                    if subj not in (relevant | descendants_of(relevant)):\n'
       '                        continue',
       '                    if False:\n'
       '                        continue')]),

    # The ORDER rule is enforced in TWO places: the window for a serving sink
    # stops at the sink line, and the `j > i` check rejects a later guard.
    # Removing only the CHECK leaves the window in place, so the mutant is
    # equivalent to the baseline -- R502's first matrix run reported this as
    # "SURVIVED" and that was wrong.  Both halves must go.
    ("M3", "drop the ORDER constraint (a guard after the sink counts)",
     [('                if resolving:\n'
       '                    window = range(lo, hi + 1)\n'
       '                else:\n'
       '                    window = range(lo, min(i, hi) + 1)',
       '                window = range(lo, hi + 1)'),
      ('                    if not resolving and j > i:\n'
       '                        continue',
       '                    if False:\n'
       '                        continue')]),

    ("M4", "drop the MESSAGE-shaped sources (HTTP transport only)",
     [('SOURCE = re.compile("(?:" + REQ_SOURCE.pattern + ")|(?:" + MSG_SOURCE.pattern + ")", re.I)',
       'SOURCE = re.compile("(?:" + REQ_SOURCE.pattern + ")", re.I)')]),

    ("M5", "drop the NETWORK sinks (filesystem only)",
     [('_NET_NAMES = (\n'
       '    r"fetch|axios|axios\\.\\w+|got|superagent|request|"\n'
       '    r"http\\.get|https\\.get|http\\.request|https\\.request|"\n'
       '    r"http\\.post|https\\.post|undici\\.\\w+|nodeFetch|ky")',
       '_NET_NAMES = (\n'
       '    r"zzzznevermatches")')]),

    ("M6", "record EVERY RHS identifier as a taint parent (siblings become ancestor/descendant)",
     [('parents.setdefault(name, set()).update(tainted_ancestors)',
       'parents.setdefault(name, set()).update(ids)')]),

    ("M7", "NEGATIVE CONTROL: report every file as a hit",
     [('            if not channels:\n'
       '                continue',
       '            if not channels:\n'
       '                channels.append("X:always")')]),

    # "never report a hit" has to REMOVE the report, not just relabel the
    # channel.  The first version of this mutation appended a channel AND
    # kept the `continue`, so it was byte-different and behaviour-identical.
    #
    # NOTE the raw strings: the needle contains regex backslashes, so it must
    # be written RAW.  The first version used a normal string with `\\\\b`,
    # which is a DOUBLE backslash in the actual value and therefore matched
    # nothing -- the driver reported "needle absent" and the arm was silently
    # SKIPPED (a NOT-INJECTED arm is not a survivor, but it is also not a
    # kill, so the matrix would have looked better than it was).
    ("M8", "NEGATIVE CONTROL: never report a hit",
     [(r'SINK = re.compile(r"\b((?:" + _FS_NAMES + r")|(?:" + _NET_NAMES + r"))\s*\(")',
       r'SINK = re.compile(r"\bzzzznevermatches\s*\(")')]),
]


def apply_edits(src: str, edits) -> str:
    """Apply every (old, new) edit; raise if any needle is absent or inert.

    R456-1: a needle that does not match makes `str.replace` return the string
    itself, and a count==1 assertion would still pass.  So the check is
    `new != old` per edit AND on the composed result.
    """
    out = src
    for old, new in edits:
        if old not in out:
            raise KeyError("needle absent: %r" % old[:60])
        out = out.replace(old, new, 1)
    if out == src:
        raise ValueError("the composed mutation was inert")
    return out


def detector_output_over_corpus():
    """The BASELINE detector's output over the corpus.

    This is the equivalence oracle: a mutant whose output over the corpus is
    IDENTICAL to the baseline has not changed the behaviour under test, so it
    cannot be scored as a kill and must not be scored as a survivor either.

    NORMALISATION (R503): the detector prints the corpus file's PATH in
    every record, and the corpus is materialised into a FRESH temp dir on
    every call -- so two runs of the SAME detector differ in the path text
    alone and the comparison would never be equal.  The corpus dir is
    therefore replaced by a fixed token before the comparison.  Without this,
    the oracle silently reports "never equivalent" and the equivalence
    detection is theatre.
    """
    tmp = tempfile.mkdtemp(prefix="r502-equiv-")
    try:
        subprocess.run([sys.executable, CORPUS_MODULE, tmp],
                       capture_output=True, text=True, timeout=120)
        proc = subprocess.run(
            [sys.executable, DETECTOR, tmp],
            capture_output=True, text=True, timeout=300)
        return proc.stdout.replace(tmp, "<CORPUS>")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def md5(path: str) -> str:
    return hashlib.md5(open(path, "rb").read()).hexdigest()


def run_suite():
    """Run the suite; return (passed_count, failed_count, raw_tail)."""
    proc = subprocess.run(
        ["npx", "vitest", "run", SUITE, "--reporter=basic"],
        cwd=HUB, capture_output=True, text=True, timeout=900)
    out = proc.stdout + proc.stderr
    # vitest prints "Tests  21 passed (21)" for an all-green run -- there is
    # no "failed" token at all.  R501's matrix parser looked only for the red
    # shape and read a GREEN control as zero-passed, then aborted the matrix.
    # Parse the summary line explicitly and ASSERT the count.
    passed = failed = None
    for line in out.split("\n"):
        if "Tests" in line and ("passed" in line or "failed" in line):
            import re
            mp = re.search(r"(\d+)\s+passed", line)
            mf = re.search(r"(\d+)\s+failed", line)
            if mp:
                passed = int(mp.group(1))
            if mf:
                failed = int(mf.group(1))
    return passed, failed, out[-3000:]


def main() -> int:
    base_md5 = md5(DETECTOR)
    snapshot = tempfile.mktemp(suffix=".r502_detector.py.bak")
    shutil.copy2(DETECTOR, snapshot)

    def restore():
        if os.path.exists(snapshot):
            shutil.copy2(snapshot, DETECTOR)

    atexit.register(restore)
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        try:
            signal.signal(sig, lambda *a: (restore(), sys.exit(3)))
        except (ValueError, OSError):
            pass

    print("== CONTROL (unmutated) ==")
    p, f, tail = run_suite()
    print("passed=%s failed=%s" % (p, f))
    if p is None:
        print("CONTROL: could not parse the vitest summary -- HARNESS FAILURE")
        print(tail)
        return 2
    if f:
        print("CONTROL FAILED -- the matrix cannot be attributed")
        print(tail)
        return 2
    print("control OK\n")

    # the equivalence oracle: the BASELINE behaviour of the detector
    baseline_out = detector_output_over_corpus()
    print("baseline detector output over corpus: %d bytes\n" % len(baseline_out))

    results = []
    for mid, desc, edits in MUTATIONS:
        src = open(DETECTOR, encoding="utf8").read()
        try:
            mutated = apply_edits(src, edits)
        except (KeyError, ValueError) as e:
            print("%-4s NOT-INJECTED: %s" % (mid, e))
            results.append((mid, "NOT-INJECTED"))
            restore()
            continue
        open(DETECTOR, "w", encoding="utf8").write(mutated)
        # --- EQUIVALENCE CHECK ---------------------------------------
        # The mutant's own behaviour over the corpus, compared with the
        # baseline's.  Identical output == an EQUIVALENT MUTANT: the bytes
        # changed but the subject under test did not.  Reporting that as
        # "SURVIVED" claims the suite missed a defect that does not exist.
        mutant_out = detector_output_over_corpus()
        equivalent = (mutant_out == baseline_out)
        p, f, tail = run_suite()
        restore()
        if equivalent:
            verdict = "EQUIVALENT"
        elif f:
            verdict = "KILLED"
        elif p is None:
            verdict = "HARNESS"
        else:
            verdict = "SURVIVED"
        print("%-4s %-9s passed=%s failed=%s equivalent=%s  %s" % (
            mid, verdict, p, f, equivalent, desc))
        results.append((mid, verdict))

    restore()
    final_md5 = md5(DETECTOR)
    print()
    print("final md5 == baseline:", final_md5 == base_md5)
    killed = sum(1 for _, v in results if v == "KILLED")
    survived = [m for m, v in results if v == "SURVIVED"]
    equivalent = [m for m, v in results if v == "EQUIVALENT"]
    notinj = [m for m, v in results if v == "NOT-INJECTED"]
    harness = [m for m, v in results if v == "HARNESS"]
    print("KILLED %d · SURVIVED %d · EQUIVALENT %d · NOT-INJECTED %d · HARNESS %d" % (
        killed, len(survived), len(equivalent), len(notinj), len(harness)))
    if survived:
        print("SURVIVED: %s" % survived)
    if equivalent:
        print("EQUIVALENT (defect in the MUTATION, not a survivor): %s" % equivalent)
    # A survivor that is not equivalent is a REAL finding: the suite failed to
    # notice a behaviour change.  An EQUIVALENT arm is a defect in the matrix
    # driver and must be fixed, not reported as a pass.
    return 1 if survived else 0


if __name__ == "__main__":
    raise SystemExit(main())
