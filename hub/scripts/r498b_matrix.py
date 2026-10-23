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

REPO = Path("/root/.hermes/workspace/woclaw/hub")
SUITE = "test/r498b_ui_static_path_traversal.test.ts"
OWNED = [REPO / "src/ui_static.ts"]
EXPECTED_TESTS = 12

# The owned file carries THIS TICK'S FIX, so it is legitimately dirty vs HEAD.
# The pre-check therefore compares against a PINNED BASELINE HASH (the fix as
# written in this tick) rather than against HEAD: the guard's job is to detect
# a SIBLING edit arriving mid-matrix, not to demand a clean tree.
#
# R477 D1 is preserved in substance: an unrecognised owned file is an ABORT,
# not a silent overwrite.
BASELINE_MD5 = "239a648a2cdec09b5c481fa30971f2bc"

# ------------------------------------------------------------------ needles

CONFINE_OLD = """    const isInside = target === publicRoot || target.startsWith(publicRoot + sep);
"""

CONFINE_M1 = """    const isInside = true;
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

ARMS = [
    ("M1", CONFINE_OLD, CONFINE_M1,
     "REPAIR of the headline: the confinement assertion is removed",
     "KILL"),
    ("M2", DECODE_OLD, DECODE_M2,
     "REPAIR of the encoded form: the percent-decode step is removed",
     "KILL"),
    ("M3", CONFINE_OLD, SPELLING_M3,
     "REPAIR near-miss: the confinement is decided by the SPELLING, not the resolved path",
     "KILL"),
    ("N1", RESOLVE_N1_OLD, RESOLVE_N1_NEW,
     "NEGATIVE CONTROL: an equivalent spelling of the confinement rule",
     "SURVIVE"),
    ("N2", CONFINE_OLD, CONFINE_N2,
     "NEGATIVE CONTROL: a comment added inside the confinement block",
     "SURVIVE"),
]


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def clean_check():
    """The owned file carries this tick's fix, so the guard is a BASELINE-HASH
    check (R477 D1 in substance): an owned file whose bytes differ from the
    pinned baseline means a SIBLING edited it, and we must not overwrite it.
    """
    p = OWNED[0]
    actual = md5(p)
    if actual != BASELINE_MD5:
        return False, f"{p.name} md5 {actual[:8]} != pinned baseline {BASELINE_MD5[:8]}"
    return True, ""


def inject(p: Path, old: str, new: str, expect_count: int = 1):
    before = p.read_text(encoding="utf-8")
    n = before.count(old)
    if n != expect_count:
        return "not-injected", f"needle count {n} != {expect_count}"
    after = before.replace(old, new, expect_count)
    if after == before:
        return "not-injected", "replacement was a no-op"
    tmp = p.with_suffix(p.suffix + ".r498btmp")
    tmp.write_text(after, encoding="utf-8")
    os.replace(tmp, p)
    return "injected", f"{expect_count} site(s)"


def run_suite():
    r = subprocess.run(
        ["npx", "vitest", "run", SUITE, "--reporter=verbose"],
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


def main():
    print("=" * 78)
    print("R498b MUTATION MATRIX (woclaw) -- UI static server path traversal")
    print("=" * 78)

    ok, dirty = clean_check()
    if not ok:
        print(f"ABORT: owned files are not clean vs the pinned baseline:\n{dirty}")
        return 2
    print("pre-check: owned files match the pinned baseline  [OK]")

    snap = {p: p.read_bytes() for p in OWNED}
    base_md5 = {p: md5(p) for p in OWNED}
    print("baseline md5:", {p.name: base_md5[p][:8] for p in OWNED})

    print("\n--- CONTROL (must be green before any mutation) ---")
    p_, f_, t_, out = run_suite()
    print(f"control: {p_} passed / {f_} failed (expected {EXPECTED_TESTS} passed / 0 failed)")
    if f_ != 0 or p_ != EXPECTED_TESTS:
        print("CONTROL NOT GREEN -- aborting")
        print(out[-4000:])
        restore(snap)
        return 3

    results = []
    for aid, old, new, desc, expect in ARMS:
        print(f"\n--- {aid}: {desc}")
        print(f"    expectation: {expect}")
        restore(snap)
        status, detail = inject(OWNED[0], old, new, 1)
        if status != "injected":
            print(f"  {aid} NOT-INJECTED ({detail}) -- NOT counted as SURVIVED")
            results.append((aid, desc, "NOT-INJECTED"))
            continue
        if md5(OWNED[0]) == base_md5[OWNED[0]]:
            print(f"  {aid} NOT-INJECTED (md5 unchanged) -- NOT counted as SURVIVED")
            results.append((aid, desc, "NOT-INJECTED"))
            restore(snap)
            continue

        tsc = subprocess.run(["npx", "tsc", "--noEmit"], cwd=REPO,
                             capture_output=True, text=True, timeout=600)
        if tsc.returncode != 0:
            err = (tsc.stdout + tsc.stderr).strip().splitlines()
            print(f"  {aid} HARNESS (tsc failed) -- NOT counted as SURVIVED")
            if err:
                print("   ", err[-1][:200])
            results.append((aid, desc, "HARNESS"))
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
        results.append((aid, desc, verdict))
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
    for aid, desc, verdict in results:
        print(f"  {aid:4} {verdict:14} {desc}")
    killed = sum(1 for _, _, v in results if v == "KILLED")
    survived = sum(1 for _, _, v in results if v == "SURVIVED")
    ni = sum(1 for _, _, v in results if v == "NOT-INJECTED")
    harness = sum(1 for _, _, v in results if v == "HARNESS")
    print(f"\n  KILLED={killed}  SURVIVED={survived}  NOT-INJECTED={ni}  HARNESS={harness}")
    print(f"  final md5 match: {all(md5(p) == base_md5[p] for p in OWNED)}")
    print("=" * 78)
    return 0


def restore(snap):
    for p, data in snap.items():
        tmp = p.with_suffix(p.suffix + ".r498brestore")
        tmp.write_bytes(data)
        os.replace(tmp, p)


if __name__ == "__main__":
    sys.exit(main())
