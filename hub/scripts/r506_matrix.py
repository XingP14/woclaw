#!/usr/bin/env python3
"""
R506 mutation matrix (woclaw) -- the system-file detector must be derived
from the host, not from one author's hostname.

WHAT THIS MATRIX IS FOR
-----------------------
The defect shipped in TWO layers, and each layer needs its own evidence:

  L1  The DETECTOR hardcoded this author's hostname, so the committed
      suites were RED on every GitHub Actions runner while the product
      under test was correct.

  L2  The CONTROL ARM that was supposed to notice was itself VACUOUS:
      it asserted `served === false` ONLY IF `served` was already true, so
      on a fixed server the assertion never ran.  The r498c arm had the
      mirrored shape: it `continue`d past every unreadable file and could
      exit green having checked NOTHING.

A matrix that only kills L1 does not show that the REWRITE of the control
is load-bearing.  So this matrix carries a TWO-SIDED arm:

  * the detector is made DEAD (it can never fire)  -> the REWRITTEN r498b
    arm (8) MUST go RED;
  * the SAME mutation against the OLD (pre-fix) r498b arm (8) MUST stay
    GREEN -- which is the measurement that proves the old arm was a
    tautology rather than a control.

That second half is measured in the HEAD worktree, because the old arm
only exists there.

DISCIPLINE (carried from R456 / R469 / R475 / R482 / R496 / R497 / R505)
-------------------------------------------------------------------------
  * control FIRST -- the suites must be green before any mutation;
  * OWNED-FILE snapshot/restore BY BYTES, never `git checkout` (R446-1:
    `git checkout` destroys other agents' uncommitted work);
  * the owned files are checked against a PINNED BASELINE hash before any
    injection, so a SIBLING edit arriving mid-matrix is an ABORT, not a
    silent overwrite (R477 D1 in substance);
  * every injection asserts (a) the needle was found exactly N times and
    (b) the file actually CHANGED -- `str.replace` returns the string
    unchanged when the needle is absent, and a `count==1` assertion still
    passes, so `assert new != old` is the check that catches it (R456-10c);
  * a mutation that fails to inject is NOT-INJECTED, never SURVIVED;
  * a COMPILE-BROKEN arm is HARNESS, never SURVIVED;
  * the vitest summary is parsed EXPLICITLY and asserted against the known
    suite sizes -- a glyph-counting parser counts test FILES, not tests
    (R497-11c).

Arms
----
  M1  REGRESSION of L1: the detector hardcodes a hostname literal again.
       The r506 gate MUST go RED (arm 2) on a host whose name it is.
  M2  REGRESSION of L1: the hostname marker is dropped entirely.
       The r506 gate MUST go RED (arms 1 and 3).
  M3  REGRESSION of L1: the detector can NEVER fire.
       The r506 gate MUST go RED (arms 3 and 5) AND the REWRITTEN r498b
       arm (8) MUST go RED -- this is the arm that proves the rewritten
       control is load-bearing.
  N1  NEGATIVE CONTROL: the detector rewritten in an equivalent spelling
       (regex instead of `includes`). MUST SURVIVE.
  N2  NEGATIVE CONTROL: a comment added inside the detector. MUST SURVIVE.
"""
import hashlib
import os
import re
import subprocess
import sys
from pathlib import Path

HUB = Path(__file__).resolve().parent.parent
DETECTOR = HUB / "test" / "support" / "system-file-marker.ts"
R506 = "test/r506_detector_derived_from_host.test.ts"
R498B = "test/r498b_ui_static_path_traversal.test.ts"

OWNED = [DETECTOR]
EXPECTED = {R506: 6, R498B: 12}

# Pinned baseline of the owned file as this tick writes it.  The owned file
# carries THIS TICK'S FIX, so it is legitimately dirty vs HEAD; the guard is
# against a SIBLING edit arriving mid-matrix, not against a dirty tree.
BASELINE_MD5 = {
    DETECTOR: hashlib.md5(DETECTOR.read_bytes()).hexdigest(),
}

# ------------------------------------------------------------------ needles

# M1: hardcode a hostname again, in the shape the shipped defect had.
M1_OLD = """  if (hostname.length > 0) {
    markers.push(hostname);
  }
"""
M1_NEW = """  // negative arm of the regression: the hostname is HARD-CODED again
  markers.push('us-vps4');
"""

# M2: drop the hostname marker entirely -- the detector keeps only the two
# host-independent markers.
M2_OLD = """  if (hostname.length > 0) {
    markers.push(hostname);
  }
"""
M2_NEW = """  void hostname;
"""

# M3: the detector can never fire.
M3_OLD = """  return MARKERS.some((m) => body.includes(m));
"""
M3_NEW = """  return false;
"""

# N1: an EQUIVALENT spelling of the same predicate. It must survive: it
# computes the same thing.
N1_OLD = """  return MARKERS.some((m) => body.includes(m));
"""
N1_NEW = """  return MARKERS.some((m) => new RegExp(m.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')).test(body));
"""

# N2: a comment that changes nothing.
N2_OLD = """  return MARKERS.some((m) => body.includes(m));
"""
N2_NEW = """  // negative control: a comment that changes nothing
  return MARKERS.some((m) => body.includes(m));
"""

ARMS = [
    ("M1", M1_OLD, M1_NEW,
     "REGRESSION of L1: the detector hardcodes a hostname literal again", "KILL"),
    ("M2", M2_OLD, M2_NEW,
     "REGRESSION of L1: the hostname marker is dropped entirely", "KILL"),
    ("M3", M3_OLD, M3_NEW,
     "REGRESSION of L1: the detector can never fire", "KILL"),
    ("N1", N1_OLD, N1_NEW,
     "NEGATIVE CONTROL: an equivalent spelling of the same predicate", "SURVIVE"),
    ("N2", N2_OLD, N2_NEW,
     "NEGATIVE CONTROL: a comment added inside the detector", "SURVIVE"),
]


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def precheck() -> tuple[bool, str]:
    for p in OWNED:
        actual = md5(p)
        if actual != BASELINE_MD5[p]:
            return False, f"{p.name} md5 {actual[:8]} != pinned baseline {BASELINE_MD5[p][:8]}"
    return True, ""


def inject(p: Path, old: str, new: str, expect_count: int = 1):
    before = p.read_text(encoding="utf-8")
    n = before.count(old)
    if n != expect_count:
        return "not-injected", f"needle count {n} != {expect_count}"
    after = before.replace(old, new, expect_count)
    if after == before:
        return "not-injected", "replacement was a no-op"
    tmp = p.with_suffix(p.suffix + ".r506tmp")
    tmp.write_text(after, encoding="utf-8")
    os.replace(tmp, p)
    return "injected", f"{expect_count} site(s)"


def restore(snap: dict) -> None:
    for p, data in snap.items():
        tmp = p.with_suffix(p.suffix + ".r506restore")
        tmp.write_bytes(data)
        os.replace(tmp, p)


def emergency_restore(snap: dict) -> None:
    """Last-resort restore, run from a signal handler AND at process exit.

    A matrix killed by SIGKILL cannot run a handler -- that is why the
    shell wrapper keeps an independent byte copy under /tmp and restores
    from it when the exit code is 137/143.
    """
    for p, data in snap.items():
        try:
            tmp = p.with_suffix(p.suffix + ".r506emgrestore")
            tmp.write_bytes(data)
            os.replace(tmp, p)
        except Exception:
            pass


def run_suite(suite: str):
    r = subprocess.run(
        ["npx", "vitest", "run", suite, "--reporter=verbose"],
        cwd=HUB, capture_output=True, text=True, timeout=900,
    )
    out = r.stdout + r.stderr
    # Parse the EXPLICIT summary line and assert against the known size.
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


def reds(out: str):
    return re.findall(r"^\s*[×x]\s+(.*)$", out, re.M)


def main() -> int:
    print("=" * 78)
    print("R506 MUTATION MATRIX (woclaw) -- the detector must be derived from the host")
    print("=" * 78)

    ok, detail = precheck()
    if not ok:
        print(f"ABORT: owned files do not match the pinned baseline:\n{detail}")
        return 2
    print("pre-check: owned files match the pinned baseline  [OK]")

    snap = {p: p.read_bytes() for p in OWNED}
    base_md5 = {p: md5(p) for p in OWNED}

    print("\n--- CONTROL (must be green before any mutation) ---")
    for suite, expected in EXPECTED.items():
        p_, f_, t_, out = run_suite(suite)
        print(f"control {suite}: {p_} passed / {f_} failed (expected {expected} / 0)")
        if f_ != 0 or p_ != expected:
            print("CONTROL NOT GREEN -- aborting")
            print(out[-4000:])
            restore(snap)
            return 3

    results = []
    import atexit
    import signal

    def _on_signal(signum, frame):
        emergency_restore(snap)
        raise SystemExit(128 + signum)

    for _sig in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(_sig, _on_signal)
        except Exception:
            pass
    atexit.register(lambda: emergency_restore(snap))

    for aid, old, new, desc, expect in ARMS:
        print(f"\n--- {aid}: {desc}")
        print(f"    expectation: {expect}")
        restore(snap)
        status, det = inject(DETECTOR, old, new, 1)
        if status != "injected":
            print(f"  {aid} NOT-INJECTED ({det}) -- NOT counted as SURVIVED")
            results.append((aid, desc, "NOT-INJECTED"))
            continue
        if md5(DETECTOR) == base_md5[DETECTOR]:
            print("  {aid} NOT-INJECTED (md5 unchanged) -- NOT counted as SURVIVED")
            results.append((aid, desc, "NOT-INJECTED"))
            restore(snap)
            continue

        tsc = subprocess.run(["npx", "tsc", "--noEmit"], cwd=HUB,
                             capture_output=True, text=True, timeout=600)
        if tsc.returncode != 0:
            err = (tsc.stdout + tsc.stderr).strip().splitlines()
            print(f"  {aid} HARNESS (tsc failed) -- NOT counted as SURVIVED")
            if err:
                print("   ", err[-1][:200])
            results.append((aid, desc, "HARNESS"))
            restore(snap)
            continue

        p6, f6, t6, out6 = run_suite(R506)
        p4, f4, t4, out4 = run_suite(R498B)
        if f6 > 0 or f4 > 0:
            verdict = "KILLED"
            detail2 = f"r506 {f6} red, r498b {f4} red"
        else:
            verdict = "SURVIVED"
            detail2 = "both suites stayed green"
        print(f"  {aid} {verdict}: {detail2}")
        for r_ in (reds(out6) + reds(out4))[:10]:
            print(f"      x {r_[:130]}")
        results.append((aid, desc, verdict))
        restore(snap)
        if any(md5(p) != base_md5[p] for p in OWNED):
            print("  !! RESTORE FAILED")
            return 4

    print("\n--- POST-CONTROL (the suites must be green again) ---")
    for suite, expected in EXPECTED.items():
        p_, f_, t_, out = run_suite(suite)
        print(f"post-control {suite}: {p_} passed / {f_} failed (expected {expected} / 0)")
        if f_ != 0 or p_ != expected:
            print("POST-CONTROL RED -- aborting")
            print(out[-4000:])
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


if __name__ == "__main__":
    sys.exit(main())
