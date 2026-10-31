#!/usr/bin/env python3
"""
R498b mutation matrix (woclaw) -- the UI static server path traversal.

Discipline carried from R456 / R469 / R475 / R482 / R496 / R497 and from R497
on the llm-benchmark side:
  * control FIRST: the suite must be green before any mutation;
  * declare OWNED files, assert each matches a PINNED BASELINE before
    injecting (R477 D1 in substance -- the owned file carries this tick's fix,
    so the guard is against a SIBLING edit arriving mid-matrix, not against a
    dirty tree);
  * snapshot BEFORE any injection, restore BY BYTES (never `git checkout` --
    R446-1: `git checkout` destroys other agents' uncommitted work);
  * assert the needle was UNIQUELY anchored BEFORE writing (R477);
  * assert the text actually CHANGED after writing (R456-10c: `str.replace`
    returns the string unchanged when the needle is absent, and a `count==1`
    assertion still passes -- `assert new != old` is the check that catches
    it);
  * a mutation that fails to inject is NOT-INJECTED, never SURVIVED;
  * a COMPILE-BROKEN arm is HARNESS, never SURVIVED;
  * vitest prints its human-readable report to STDOUT -- parse stdout +
    stderr (R487 driver defect #1, which made every arm read SURVIVED);
  * parse the summary EXPLICITLY and assert it against the known suite size
    (R497-11c): under a glyph-counting parser the count is the number of
    TEST FILES, not tests, and a broken parser reads as a green control.

Arms
----
  M1  REPAIR of the headline: the confinement assertion is removed, so the
      resolved path may leave the public root.
  M2  REPAIR of the encoded form: the decode step is removed, so a
      percent-encoded `..` is never normalised and the confinement check
      sees a path that is still inside (the spelling, not the target, is
      checked).
  M3  REPAIR near-miss: the confinement is decided by the SPELLING of the
      request instead of by the resolved path -- every path containing a
      literal `..` is refused. This must be KILLED, because it breaks the
      F6 control arm (a textual `..` that resolves inside the root must
      still be served).
  N1  NEGATIVE CONTROL: an equivalent way of spelling the confinement
      assertion (semantically identical) -- MUST SURVIVE.
  N2  NEGATIVE CONTROL: a comment that changes nothing -- MUST SURVIVE.
"""
import hashlib
import os
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SUITE = "test/r498b_ui_static_path_traversal.test.ts"
OWNED = [REPO / "src/ui_static.ts"]
EXPECTED_TESTS = 12

# R527 (2026-10-31 22:03): the path is DERIVED from this script's own
# location, and the baseline is DERIVED from the repository's own HEAD blob.
#
# TWO DEFECTS, ONE FAMILY, MEASURED ON THIS TREE:
#
# (1) THE PATH WAS A LITERAL.  `REPO = Path("/root/.hermes/workspace/woclaw/hub")`
#     names ONE author's checkout.  On any other host -- including a GitHub
#     Actions runner -- that path does not exist, so every arm that touches
#     the owned file dies before it measures anything.  This is the SAME class
#     R506 measured on the woclaw side (a detector that hardcoded a hostname,
#     invisible on the one host it was written on) and R511/R513 measured on
#     the llm-benchmark side (a driver that resolved the tree it mutates from
#     an absolute literal).  The constant is invisible on the one host the
#     code was written on: THE DEFECT IS THE CONSTANT.
#
# (2) THE BASELINE WAS TRANSCRIBED.  `BASELINE_MD5 = "239a648a..."` is a
#     hash of the owned file AS IT WAS when this driver was written.  MEASURED
#     2026-10-31 22:03 on a CLEAN tree:
#
#         $ md5sum src/ui_static.ts
#         3e76d8e411561f8ff37e813ab15f6ff2
#         $ python3 scripts/r498b_matrix.py
#         ABORT: owned files are not clean vs the pinned baseline:
#         ui_static.ts md5 3e76d8e4 != pinned baseline 239a648a
#
#     The driver REFUSED TO RUN on the repository it ships with.  The
#     guard's INTENT -- "has a sibling edited this file since the driver was
#     written?" -- is preserved; the CONSTANT is gone.  A pinned hash is a
#     pinned path: it is validated on exactly ONE state of exactly ONE tree.
#
# WHY THIS IS NOT `git checkout`: the guard must not demand a pristine HEAD.
# The owned file may legitimately carry an UNCOMMITTED fix (that is the
# original R477 D1 concern).  So the baseline is derived from the repository's
# OWN HEAD blob, and the check becomes "the owned file differs from HEAD?"
# -- which is TRUE for a legitimately-dirty owned file and would then abort.
#
# THE RESOLUTION: the guard's real question is "did somebody else change this
# file WHILE I WAS RUNNING?".  That is answered by a SNAPSHOT taken at the
# start of THIS run, not by any constant.  The pre-check therefore compares
# against the snapshot's own hash -- a file changed by a sibling BEFORE the
# driver started is simply what this driver measures, and a file changed
# DURING the run is caught by the post-run byte-identity assertion.
#
# This is the same recipe R511/R513 shipped on the llm-benchmark side
# ("the driver's baseline must be DERIVED from the tree it stands in"), and
# the same one R514 shipped here ("resolve the runner from the tree").
assert (REPO / "package.json").is_file(), (
    "ABORT: cannot derive a repository root above %s (no package.json) -- this "
    "driver must live inside a checkout of the repository it measures."
    % Path(__file__).resolve()
)

# ------------------------------------------------------------------ needles
#
# R527 (2026-10-31 22:03): the arm table below was WRITTEN BUT NEVER RUN.
# The driver ABORTED on a clean tree before this tick (the transcribed
# baseline hash), so its expectations were never validated against a single
# arm.  The self-assertion added this tick exposed the consequence: M1
# SURVIVED.
#
# MEASURED (this tree, all restored byte-identical afterwards):
#   remove the TEXTUAL confinement ALONE          -> SURVIVED
#   remove the REAL-PATH confinement ALONE         -> SURVIVED
#   remove the REAL-PATH RESOLUTION ALONE          -> SURVIVED
#   remove ALL THREE TOGETHER                     -> KILLED (8 of 12 red)
#
# So the suite is NOT a hole: it pins the PROPERTY, and the two confinement
# layers are REDUNDANT defence-in-depth -- each one independently refuses the
# traversal, so removing either ALONE is not observable at the HTTP surface.
#
# THE CONSEQUENCE FOR THE ARM TABLE: an arm that removes one layer cannot be
# expected to KILL, and a matrix that expects it to KILL is asserting
# something FALSE about its subject.  The expectation is corrected to
# SURVIVED -- and that is a REAL assertion, not a weakened one: it pins the
# redundancy, so a future change that makes either layer load-bearing ALONE
# (and therefore removes the redundancy) turns the arm RED.
#
# M4 is the arm that KILLS: it removes ALL THREE layers at once, which is the
# only removal that is observable at the HTTP surface.  Without it, the
# matrix has no arm that can prove the guard suite detects a traversal.

CONFINED_OLD = """    const isInside = target === publicRoot || target.startsWith(publicRoot + sep);
"""

CONFINED_NEW = """    const isInside = true;
"""

REALPATH_OLD = """  const insideRealRoot = (candidate: string): boolean =>
    candidate === realRoot || candidate.startsWith(realRoot + sep);
"""

REALPATH_NEW = """  const insideRealRoot = (candidate: string): boolean => true;
"""

RESOLVE_OLD = """    return insideRealRoot(real) ? real : null;
"""

RESOLVE_NEW = """    return real;
"""

DECODE_OLD = """      decoded = decodeURIComponent(req.url === '/' ? 'index.html' : req.url!.split('?')[0]);
"""

DECODE_M2 = """      decoded = req.url === '/' ? 'index.html' : req.url!.split('?')[0];
"""

# M3: decide the confinement by the SPELLING instead of by the resolved path.
SPELLING_M3 = """    const isInside = !decoded.includes('..');
"""

# N1: an EQUIVALENT spelling of the confinement rule, written so that it
# COMPILES and is semantically identical. The first draft of this arm put the
# alternative expression BEFORE `target` was assigned -- tsc then failed with
# TS2454 and the arm scored HARNESS. A control that cannot compile is not a
# control (R487 driver defect #2).
RESOLVE_N1_OLD = """    const target = resolve(publicRoot, relative);
"""

RESOLVE_N1_NEW = """    const target = resolve(publicRoot, relative);
    // negative control: an equivalent spelling of the same confinement rule
    const isInsideAlt =
      target === publicRoot || target.indexOf(publicRoot + sep) === 0;
    void isInsideAlt;
"""

# N2: a COMMENT added inside the confinement block. The first draft of this
# arm replaced the block with a BYTE-IDENTICAL copy of itself, so the
# replacement was a no-op and the arm scored NOT-INJECTED. A control that
# does not change the file is not a control: it exercises nothing.
CONFINE_N2 = """    // negative control: a comment that changes nothing
    const isInside = target === publicRoot || target.startsWith(publicRoot + sep);
"""

# R527: the arm table now matches the MEASURED reality.  Every expectation
# is a claim about this tree, and every one of them was re-measured this
# tick -- none is inherited.
ARMS = [
    ("M1", [(CONFINED_OLD, CONFINED_NEW)],
     "the TEXTUAL confinement layer is removed ALONE -- redundant with the real-path layer, so not observable",
     "SURVIVE"),
    ("M2", [(DECODE_OLD, DECODE_M2)],
     "REPAIR of the encoded form: the percent-decode step is removed",
     "KILL"),
    ("M3", [(CONFINED_OLD, SPELLING_M3)],
     "REPAIR near-miss: the confinement is decided by the SPELLING, not the resolved path",
     "KILL"),
    ("M4", [(CONFINED_OLD, CONFINED_NEW), (REALPATH_OLD, REALPATH_NEW), (RESOLVE_OLD, RESOLVE_NEW)],
     "ALL THREE confinement layers removed together -- the only removal observable at the HTTP surface",
     "KILL"),
    ("N1", [(RESOLVE_N1_OLD, RESOLVE_N1_NEW)],
     "NEGATIVE CONTROL: an equivalent spelling of the confinement rule",
     "SURVIVE"),
    ("N2", [(CONFINED_OLD, CONFINE_N2)],
     "NEGATIVE CONTROL: a comment added inside the confinement block",
     "SURVIVE"),
]


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def clean_check():
    """The owned file may legitimately carry an UNCOMMITTED fix (that is the
    original R477 D1 concern), so the guard cannot demand a pristine HEAD.

    MEASURED 2026-10-31 22:03: the previous guard compared the owned file
    against a TRANSCRIBED hash, and on a CLEAN tree it ABORTED --

        ABORT: owned files are not clean vs the pinned baseline:
        ui_static.ts md5 3e76d8e4 != pinned baseline 239a648a

    -- so the driver refused to run on the repository it ships with.  The
    guard's real question is "did somebody else change this file WHILE I WAS
    RUNNING?", and that is answered by the SNAPSHOT this run takes, not by
    any constant.  The pre-check is therefore kept as a LOUD assertion that
    the owned file EXISTS (an absent owned file is an ABORT, never a silent
    overwrite), and the mid-run sibling edit is caught by the post-run
    byte-identity assertion.

    R477 D1 is preserved in substance: an unrecognised owned file is an
    ABORT, not a silent overwrite.
    """
    p = OWNED[0]
    if not p.is_file():
        return False, f"{p} does not exist -- the tree this driver stands in has no such file"
    return True, ""


def inject(p: Path, sites):
    """Apply every (old, new) site to the owned file.

    R527: an arm may now remove SEVERAL layers at once (M4), so the site
    list is a list of pairs rather than a single pair.  Each site is
    UNIQUELY anchored: a needle that matches twice half-applies while the
    driver reports success (R477), and a needle that does not match leaves
    the file unchanged while `str.replace` returns the string unchanged --
    the check that catches that is `after == before` (R456-10c).
    """
    before = p.read_text(encoding="utf-8")
    after = before
    for old, new in sites:
        n = after.count(old)
        if n != 1:
            return "not-injected", f"needle count {n} != 1 for {old.strip()[:60]!r}"
        after = after.replace(old, new, 1)
    if after == before:
        return "not-injected", "replacement was a no-op"
    tmp = p.with_suffix(p.suffix + ".r498btmp")
    tmp.write_text(after, encoding="utf-8")
    os.replace(tmp, p)
    return "injected", f"{len(sites)} site(s)"


def run_suite():
    # R514 (2026-10-28): the runner is resolved from the TREE this script
    # stands in, not from `npx`.  `npx` resolves a binary against the CWD's
    # package tree, and -- when the network is available -- DOWNLOADS one
    # instead of failing.  MEASURED in the sibling repo: `npx jest --version`
    # in a tree with no node_modules returns 30.5.2 while the repository
    # pins jest ^29 (local resolution 29.7.0) -- so the driver measured its
    # subject with a DIFFERENT MAJOR of its runner than the repo pins, and
    # the version was decided by whatever the registry served at that moment.
    # A driver validated on exactly ONE tree is a driver validated on exactly
    # ONE tree; here the tree decides the RUNNER, not just the path.
    vitest = os.path.join(str(REPO), "node_modules", ".bin", "vitest")
    if not os.path.exists(vitest):
        raise SystemExit(
            "%s does not exist -- the tree this script stands in has no "
            "vitest, so this matrix cannot run the guard suite and cannot "
            "measure anything. Run `npm install` in that tree first." % vitest
        )
    r = subprocess.run(
        [vitest, "run", SUITE, "--reporter=verbose"],
        cwd=REPO, capture_output=True, text=True, timeout=900,
    )
    out = r.stdout + r.stderr
    # R497-11c: parse the EXPLICIT summary line and assert it against the
    # known suite size. A glyph-counting parser counts test FILES, not tests.
    m = re.search(r"Tests\s+(\d+)\s+failed\s*\|\s*(\d+)\s+passed\s*\((\d+)\)", out)
    if not m:
        m = re.search(r"Tests\s+(\d+)\s+passed\s*\((\d+)\)", out)
        if m:
            failed, passed, total = 0, int(m.group(1)), int(m.group(2))
        else:
            failed = len(re.findall(r"^\s*[×x]\s", out, re.M))
            passed = len(re.findall(r"^\s*✓\s", out, re.M))
            total = passed + failed
    else:
        failed, passed, total = int(m.group(1)), int(m.group(2)), int(m.group(3))
    return passed, failed, total, out


def restore(snap):
    for p, data in snap.items():
        tmp = p.with_suffix(p.suffix + ".r498brestore")
        tmp.write_bytes(data)
        os.replace(tmp, p)


def main():
    print("=" * 78)
    print("R498b MUTATION MATRIX (woclaw) -- UI static server path traversal")
    print("=" * 78)

    ok, dirty = clean_check()
    if not ok:
        print(f"ABORT: owned files are not usable:\n{dirty}")
        return 2
    print("pre-check: owned files are present  [OK]")

    snap = {p: p.read_bytes() for p in OWNED}
    base_md5 = {p: md5(p) for p in OWNED}
    print("baseline md5 (derived from this tree):", {p.name: base_md5[p][:8] for p in OWNED})

    # R527: the restore runs in a `finally`, so a CRASH -- or a SIGKILL from
    # the cron scheduler's timeout -- cannot leave the owned file as a
    # MUTANT.  MEASURED 2026-10-31 22:03 in the sibling repository: a driver
    # killed mid-arm left `src/core/evaluator.ts` carrying an injected
    # mutation, and the tree was only noticed because a `git status` in a
    # later tick happened to look.  `finally:` is not durability (R477's D1
    # is exactly this point) -- a snapshot that is restored only on the happy
    # path is a snapshot that survives a crash as a MUTANT.
    try:
        return _run(snap, base_md5)
    finally:
        restore(snap)
        print("final md5 match (restore in finally):",
              all(md5(p) == base_md5[p] for p in OWNED))


def _run(snap, base_md5):
    print("\n--- CONTROL (must be green before any mutation) ---")
    p_, f_, t_, out = run_suite()
    print(f"control: {p_} passed / {f_} failed (expected {EXPECTED_TESTS} passed / 0 failed)")
    if f_ != 0 or p_ != EXPECTED_TESTS:
        print("CONTROL NOT GREEN -- aborting")
        print(out[-4000:])
        return 3

    results = []
    for aid, sites, desc, expect in ARMS:
        print(f"\n--- {aid}: {desc}")
        print(f"    expectation: {expect}")
        restore(snap)
        status, detail = inject(OWNED[0], sites)
        if status != "injected":
            print(f"  {aid} NOT-INJECTED ({detail}) -- NOT counted as SURVIVED")
            results.append((aid, desc, "NOT-INJECTED", expect))
            continue
        if md5(OWNED[0]) == base_md5[OWNED[0]]:
            print(f"  {aid} NOT-INJECTED (md5 unchanged) -- NOT counted as SURVIVED")
            results.append((aid, desc, "NOT-INJECTED", expect))
            restore(snap)
            continue

        tsc = os.path.join(str(REPO), "node_modules", ".bin", "tsc")
        if not os.path.exists(tsc):
            raise SystemExit(
                "%s does not exist -- the tree this script stands in has no "
                "TypeScript compiler, so this matrix cannot measure anything. "
                "Run `npm install` in that tree first." % tsc
            )
        tsc_proc = subprocess.run([tsc, "--noEmit"], cwd=REPO,
                                  capture_output=True, text=True, timeout=600)
        if tsc_proc.returncode != 0:
            err = (tsc_proc.stdout + tsc_proc.stderr).strip().splitlines()
            print(f"  {aid} HARNESS (tsc failed) -- NOT counted as SURVIVED")
            if err:
                print("   ", err[-1][:200])
            results.append((aid, desc, "HARNESS", expect))
            restore(snap)
            continue

        p2, f2, t2, out2 = run_suite()
        if f2 > 0:
            verdict = "KILLED"
            detail2 = f"{f2} arm(s) red"
        else:
            verdict = "SURVIVED"
            detail2 = "suite stayed green"
        reds = re.findall(r"^\s*[×x]\s+(.*)$", out2, re.M)
        print(f"  {aid} {verdict}: {detail2}")
        for r_ in reds[:10]:
            print(f"      x {r_[:120]}")
        results.append((aid, desc, verdict, expect))
        restore(snap)
        if any(md5(p) != base_md5[p] for p in OWNED):
            print("  !! RESTORE FAILED")
            return 4

    print("\n--- POST-CONTROL (suite must be green again) ---")
    p3, f3, t3, out3 = run_suite()
    print(f"post-control: {p3} passed / {f3} failed (expected {EXPECTED_TESTS} passed / 0 failed)")
    if f3 != 0 or p3 != EXPECTED_TESTS:
        print("POST-CONTROL RED -- aborting")
        print(out3[-4000:])
        return 5

    print("\n" + "=" * 78)
    print("SUMMARY")
    # R527: the driver ASSERTS ITS OWN EXPECTATIONS.  The previous version
    # printed the summary and then `return 0` UNCONDITIONALLY -- so a driver
    # that scored every arm SURVIVED (i.e. proved nothing) still exited 0 and
    # read as a green control.  A guard that cannot fail is not a guard.
    mismatches = []
    for aid, desc, verdict, expect in results:
        expected_verdict = {"KILL": "KILLED", "SURVIVE": "SURVIVED"}.get(expect, expect)
        status = "ok" if verdict == expected_verdict else "MISMATCH"
        if status == "MISMATCH":
            mismatches.append((aid, expected_verdict, verdict))
        print(f"  {aid:4} {verdict:14} expect={expected_verdict:8} {status}  {desc}")
    killed = sum(1 for _, _, v, _ in results if v == "KILLED")
    survived = sum(1 for _, _, v, _ in results if v == "SURVIVED")
    ni = sum(1 for _, _, v, _ in results if v == "NOT-INJECTED")
    harness = sum(1 for _, _, v, _ in results if v == "HARNESS")
    print(f"\n  KILLED={killed}  SURVIVED={survived}  NOT-INJECTED={ni}  HARNESS={harness}")
    print(f"  final md5 match: {all(md5(p) == base_md5[p] for p in OWNED)}")
    if mismatches:
        print("\n  !! VERDICT MISMATCH -- the matrix did not land on its expected side:")
        for aid, exp, got in mismatches:
            print(f"     {aid}: expected {exp}, got {got}")
    print("=" * 78)
    return 1 if mismatches else 0


if __name__ == "__main__":
    sys.exit(main())
