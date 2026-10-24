#!/usr/bin/env python3
"""
R501 — MUTATION MATRIX for the detector-properties suite.

Control FIRST (R404-M1 / R456-1): the suite must be GREEN before any
mutation is applied, otherwise a red matrix cannot be attributed.

The mutations target the DETECTOR (hub/scripts/r501_detector.py), because the
suite's subject is the detector's BEHAVIOUR.  Each mutation is a REAL repair
of the class, and each must be KILLED by the suite.

  M1  remove the INLINE taint channel (CH-A)        -> the suite must fail
      (it fires on the inline spelling only through CH-A)
  M2  restore the OLD containment classifier
      (accept any startsWith in the file)            -> the route-prefix arm
                                                         must fail
  M3  remove the request-OBJECT ALIAS channel (CH-B)-> the alias arm must fail
  M4  remove the DESTRUCTURING channel (CH-C)        -> the destructured arm
                                                         must fail
  M5  narrow the taint propagation back to path-call-only
                                                      -> the "real confinement"
                                                         arm must fail (its
                                                         chain crosses a
                                                         helper call)
  M6  NEGATIVE CONTROL: a detector that reports EVERY file as a hit
      (no taint required)                            -> the specificity arms
                                                         must fail

Every mutation is verified to have CHANGED the file (assert new != old, and
assert the needle was present) BEFORE the suite is run -- R456-1's rule: a
mutation that did not apply is a HARNESS, not a survivor.

Restore is by BYTE-LEVEL SNAPSHOT of the OWNED file (R475-2: `git checkout`
restore silently destroys a concurrent agent's uncommitted work in the same
file).  The md5 of the file is asserted identical before and after the whole
matrix.
"""
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile

REPO = "/root/.hermes/workspace/woclaw"
HUB = os.path.join(REPO, "hub")
DETECTOR = os.path.join(HUB, "scripts", "r501_detector.py")
SUITE = "test/r501_detector_properties.test.ts"

MUTATIONS = [
    ("M1", "drop the INLINE taint channel (CH-A)",
     'if REQ_SOURCE.search(argtext):\n                channels.append("A:inline")',
     'if False:\n                channels.append("A:inline")'),

    ("M2", "restore the OLD containment classifier (any startsWith in the file)",
     'r"|\\.startsWith\\s*\\(\\s*(?:realRoot|publicRoot|PUBLIC_REAL_ROOT|"\n    r"root|Root|BASE|base|baseDir|basePath)\\b",',
     'r"|\\.startsWith\\s*\\(\\s*(?:realRoot|publicRoot|PUBLIC_REAL_ROOT|"\n    r"root|Root|BASE|base|baseDir|basePath)\\b|\\.startsWith\\s*\\(",'),

    ("M3", "drop the request-OBJECT ALIAS channel (CH-B)",
     'for a in req_aliases:\n                if re.search(r"\\b" + re.escape(a) + r"\\s*\\.", argtext):\n                    channels.append(f"B:alias({a})")\n                    break',
     'for a in []:\n                if re.search(r"\\b" + re.escape(a) + r"\\s*\\.", argtext):\n                    channels.append(f"B:alias({a})")\n                    break'),

    ("M4", "drop the DESTRUCTURING channel (CH-C)",
     'for d in destructured:\n                if re.search(r"\\b" + re.escape(d) + r"\\b", argtext):\n                    channels.append(f"C:destruct({d})")\n                    break',
     'for d in []:\n                if re.search(r"\\b" + re.escape(d) + r"\\b", argtext):\n                    channels.append(f"C:destruct({d})")\n                    break'),

    ("M5", "narrow taint propagation back to path-calls-only",
     'ids = set(re.findall(r"\\b([A-Za-z_$][\\w$]*)\\b", rhs))\n                if (ids & tainted) or (ids & req_aliases) or (ids & destructured):',
     'ids = set(re.findall(r"\\b([A-Za-z_$][\\w$]*)\\b", rhs))\n                if (ids & tainted) and re.search(r"\\b(?:path\\.)?(?:join|resolve|normalize)\\s*\\(", rhs):'),

    ("M6", "NEGATIVE CONTROL: report every file as a hit",
     'if not channels:\n                continue',
     'if not channels:\n                channels.append("X:always")'),
]


def md5(path: str) -> str:
    return hashlib.md5(open(path, "rb").read()).hexdigest()


def run_suite() -> tuple[tuple[int, int], str]:
    p = subprocess.run(
        ["npx", "vitest", "run", SUITE, "--reporter=basic", "--no-watch"],
        cwd=HUB, capture_output=True, text=True, timeout=420)
    out = p.stdout + p.stderr
    # Parse the SUMMARY line's SHAPE, not just the substring "Tests"
    # (R482-10: a compile error prints "Tests  no tests", so "Tests" alone is
    # not a sufficient discriminator).
    #
    # vitest prints TWO summary shapes:
    #   all green : "Tests  17 passed (17)"
    #   some red  : "Tests  2 failed | 15 passed (17)"
    # The first shape has NO "failed" token at all, so a parser that only
    # looks for "N failed | N passed" reads an all-green run as ZERO passed
    # -- and then reports the CONTROL as failed.  That is what the first
    # version of this matrix did.
    import re as _re
    failed = passed = None
    verdict = "NO SUMMARY LINE"
    for line in out.split("\n"):
        s = line.strip()
        if not s.startswith("Tests "):
            continue
        verdict = s
        mm = _re.search(r"Tests\s+(\d+)\s+failed\s*\|\s*(\d+)\s+passed", s)
        if mm:
            failed, passed = int(mm.group(1)), int(mm.group(2))
            break
        mm = _re.search(r"Tests\s+(\d+)\s+passed", s)
        if mm:
            failed, passed = 0, int(mm.group(1))
            break
        mm = _re.search(r"Tests\s+(\d+)\s+failed", s)
        if mm:
            failed, passed = int(mm.group(1)), 0
            break
    if failed is None:
        # No usable summary -> the run did not produce a verdict at all.
        return (-1, 0), verdict
    return (failed, passed), verdict


def main() -> int:
    orig = open(DETECTOR, "rb").read()
    baseline_md5 = hashlib.md5(orig).hexdigest()
    snap = os.path.join(tempfile.mkdtemp(prefix="r501snap_"), "detector.py")
    with open(snap, "wb") as f:
        f.write(orig)

    print("=" * 76)
    print("R501 MUTATION MATRIX — control first")
    print("=" * 76)
    ctl, verdict = run_suite()
    print(f"CONTROL: {verdict}")
    if ctl[1] == 0 or ctl[0] != 0:
        print("CONTROL FAILED — the suite is not green before mutation; the "
              "matrix would be uninterpretable. ABORT.")
        shutil.copyfile(snap, DETECTOR)
        return 2
    print(f"  (failed={ctl[0]} passed={ctl[1]})\n")

    results = []
    # A HARD restore guard that runs even if this process is KILLED (SIGKILL
    # skips `finally`, so the guard is ALSO a signal handler and an atexit
    # hook).  R477: a mutation driver that dies at SIGKILL leaves the tree
    # MUTATED, and the next run's control then reports a red suite that has
    # nothing to do with the code under test.  That happened here once: a
    # 420s tool timeout killed the matrix mid-M3, and the next control run
    # came back red for a reason that was three mutations old.
    restored = {"done": False}

    def restore_now():
        if restored["done"]:
            return
        restored["done"] = True
        try:
            shutil.copyfile(snap, DETECTOR)
        except OSError:
            pass

    import atexit
    import signal
    atexit.register(restore_now)
    for _sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        try:
            signal.signal(_sig, lambda *_: (restore_now(), os._exit(3)))
        except (ValueError, OSError):
            pass

    try:
        for mid, desc, old, new in MUTATIONS:
            text = orig.decode()
            if old not in text:
                results.append((mid, desc, "NOT-INJECTED", "needle absent"))
                print(f"{mid}: NOT-INJECTED -- needle absent (HARNESS, not a survivor)")
                continue
            mutated = text.replace(old, new, 1)
            if mutated == text:
                results.append((mid, desc, "NOT-INJECTED", "replace was a no-op"))
                print(f"{mid}: NOT-INJECTED -- replace was a no-op")
                continue
            # R456-1: assert the needle was unique enough to be the RIGHT one.
            if text.count(old) != 1:
                results.append((mid, desc, "NOT-INJECTED",
                                f"needle appears {text.count(old)}x"))
                print(f"{mid}: NOT-INJECTED -- needle appears "
                      f"{text.count(old)}x (would hit the wrong copy)")
                continue
            with open(DETECTOR, "w") as f:
                f.write(mutated)
            if md5(DETECTOR) == baseline_md5:
                results.append((mid, desc, "NOT-INJECTED", "md5 unchanged"))
                print(f"{mid}: NOT-INJECTED -- md5 unchanged")
                with open(snap, "rb") as s, open(DETECTOR, "wb") as d:
                    d.write(s.read())
                continue
            res, verdict = run_suite()
            failed, passed = res
            status = "KILLED" if failed > 0 else "SURVIVED"
            results.append((mid, desc, status, verdict))
            print(f"{mid}: {status}  ({desc})")
            print(f"     {verdict}")
            # restore by BYTE-LEVEL snapshot (R475-2)
            shutil.copyfile(snap, DETECTOR)
            if md5(DETECTOR) != baseline_md5:
                print(f"     *** RESTORE FAILED for {mid} ***")
                return 3
    finally:
        shutil.copyfile(snap, DETECTOR)

    print()
    print("=" * 76)
    print(f"{'ID':4} {'STATUS':12} DESCRIPTION")
    for mid, desc, status, note in results:
        print(f"{mid:4} {status:12} {desc}")
        if status != "KILLED":
            print(f"     -> {note}")
    killed = sum(1 for r in results if r[2] == "KILLED")
    survived = sum(1 for r in results if r[2] == "SURVIVED")
    notinj = sum(1 for r in results if r[2] == "NOT-INJECTED")
    print(f"\nKILLED {killed} · SURVIVED {survived} · NOT-INJECTED {notinj}")
    print(f"final md5 == baseline: {md5(DETECTOR) == baseline_md5}")
    print("=" * 76)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
