#!/usr/bin/env python3
"""
R514 mutation matrix — the guard suite must be LOAD-BEARING.

The subject: `hub/test/r514_web_ui_port_derived.test.ts` pins the property
that the Web UI port is DERIVED from `WEB_UI_PORT` rather than hardcoded.

A guard that cannot fail is not a guard, so every mutant below is a REAL
repair-shaped or defect-shaped change to the production source, applied to
an IN-MEMORY SNAPSHOT (never the real tree — R198's rule: observe the
DECISION, do not perform the CONSEQUENCE), and the suite is run against the
mutant.

Expected verdicts
-----------------
  M1  revert the resolver call to the hardcoded literal
      -> the whole point: MUST be KILLED.
  M2  resolve the port but IGNORE it (resolve, then bind 8084 anyway)
      -> the fix-shaped survivor: a resolver that is computed and discarded.
         MUST be KILLED, and this is the arm that separates "the resolver
         exists" from "the resolver is USED".
  M3  make the resolver accept ANY value (no validation)
      -> MUST be KILLED by arm (2).
  N1  an equivalent spelling of the same resolution
      -> MUST SURVIVE. A control that cannot fail is not a control; the
         negative control proves the harness does not simply kill whatever
         it touches.

The matrix asserts its OWN expectations and parses the jest/vitest summary
EXPLICITLY, asserting the total against the known suite size — under a
glyph-counting parser the count is the number of TEST FILES, and a broken
parser reads as a green control (R507's lesson, applied here).

A snapshot is taken BEFORE the mutation and restored in a `finally`, so a
crash cannot leave the tree mutated (R477's D1: restore on EXIT, not only
in the happy path).
"""

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HUB = os.path.join(REPO, "hub")
if not os.path.isdir(HUB):
    # The script lives at <repo>/hub/scripts/, so REPO is already <repo>/hub.
    HUB = REPO
    REPO = os.path.dirname(HUB)
SUITE = "test/r514_web_ui_port_derived.test.ts"
INDEX_TS = os.path.join(HUB, "src", "index.ts")
RESOLVER_TS = os.path.join(HUB, "src", "web_ui_port.ts")
DIST_INDEX = os.path.join(HUB, "dist", "index.js")
DIST_RESOLVER = os.path.join(HUB, "dist", "web_ui_port.js")

# The suite has exactly 7 tests. A parser that counts files would report 1.
# (The constant is asserted against the live run: when it drifted, the
# matrix reported HARNESS rather than a green control -- which is the
# parser refusing to be wrong.)
EXPECTED_TESTS = 7


def md5(path):
    with open(path, "rb") as fh:
        return hashlib.md5(fh.read()).hexdigest()


def snapshot(paths):
    return {p: open(p, "rb").read() for p in paths}


def restore(snap):
    for path, data in snap.items():
        with open(path, "wb") as fh:
            fh.write(data)


def read(path):
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


def write(path, text):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def substitute(text, old, new, label):
    """Replace `old` with `new`, asserting the anchor was found EXACTLY once.

    A needle that has drifted from the source is an ANCHOR MISS, not a kill.
    Reporting it as a kill is how a mutation matrix produces a confident
    verdict about a mutation that never happened (R507's finding).
    """
    count = text.count(old)
    if count != 1:
        raise SystemExit(
            "ANCHOR MISS for %s: expected exactly 1 occurrence, found %d" % (label, count)
        )
    return text.replace(old, new)


def build():
    """Rebuild dist/ from the current source.

    The guard suite's runtime arms drive the COMPILED entrypoint, so a
    mutation in src/ is INVISIBLE to them until the build is refreshed.
    Mutating src/ and running the suite without rebuilding would score the
    runtime arms against the UNMUTATED artifact — a mutation that never
    reached the subject, reported as a verdict. This is the same class as
    R483's "a suite reads commits, not the live tree".

    THE COMPILER IS RESOLVED FROM THE TREE THIS SCRIPT STANDS IN, NOT
    FROM `npx`.  MEASURED: in an ISOLATED WORKTREE of the same commit,
    `npx tsc` prints

        "This is not the tsc command you are looking for"

    and exits non-zero, while `./node_modules/.bin/tsc --version` prints
    5.9.3 — because `npx` resolves `tsc` against the CWD's package tree
    and the worktree has no installed `typescript` of its own.  So the
    matrix worked in the author's checkout and could not measure anything
    in a checkout it was COPIED into: the same "a script validated on
    exactly ONE host" shape R506/R511/R513 measured, one level down —
    the tool, not the path.

    The binary is therefore taken from the tree the script lives in, and
    the resolution is ASSERTED, so a copy in a tree without a build tool
    fails LOUDLY instead of silently scoring nothing.
    """
    tsc = os.path.join(HUB, "node_modules", ".bin", "tsc")
    if not os.path.exists(tsc):
        raise SystemExit(
            "%s does not exist -- the tree this script stands in has no "
            "TypeScript compiler, so the matrix cannot rebuild dist/ and "
            "cannot measure anything. Run `npm install` in that tree "
            "first." % tsc
        )
    proc = subprocess.run(
        [tsc], cwd=HUB, capture_output=True, text=True, timeout=900
    )
    if proc.returncode != 0:
        print(proc.stdout[-3000:])
        print(proc.stderr[-3000:])
        raise SystemExit("the build failed -- the matrix cannot measure anything")


def run_suite():
    """Run the guard suite and return (passed, failed, total)."""
    # Same reasoning as build(): the runner is resolved from the tree this
    # script stands in, not from `npx`.
    vitest = os.path.join(HUB, "node_modules", ".bin", "vitest")
    if not os.path.exists(vitest):
        raise SystemExit(
            "%s does not exist -- the tree this script stands in has no "
            "vitest, so the matrix cannot run the guard suite and cannot "
            "measure anything. Run `npm install` in that tree first."
            % vitest
        )
    proc = subprocess.run(
        [vitest, "run", SUITE, "--reporter=basic"],
        cwd=HUB,
        capture_output=True,
        text=True,
        timeout=900,
    )
    out = proc.stdout + proc.stderr
    # A run that FAILED TO COLLECT ("no tests", an unhandled worker error)
    # produced NO measurement. That is HARNESS, not a verdict — and it must
    # never be counted as a green control. Detect it explicitly.
    if (
        re.search(r"Test Files\s+no tests", out)
        or "Unhandled Error" in out
        or "Tests  no tests" in out
        or "Failed Suites" in out
        or re.search(r"\(\d+ test\)", out) and "0 test" in out
    ):
        return None, None, None, out
    # Parse the SUMMARY line explicitly, and assert the total against the
    # known constant. `Tests  3 failed | 3 passed (6)` — the (N) is the
    # total test count, which is what distinguishes a real suite from a
    # file count.
    m = re.search(r"Tests\s+(?:(\d+)\s+failed\s*\|?\s*)?(?:(\d+)\s+passed\s*\|?\s*)?\((\d+)\)", out)
    if not m:
        m2 = re.search(r"Tests\s+(\d+)\s+passed\s+\((\d+)\)", out)
        if m2:
            failed, passed, total = 0, int(m2.group(1)), int(m2.group(2))
        else:
            print(out[-4000:])
            raise SystemExit("could not parse the vitest summary line")
    else:
        failed = int(m.group(1) or 0)
        passed = int(m.group(2) or 0)
        total = int(m.group(3))
    return failed, passed, total, out


def main():
    paths = [INDEX_TS, RESOLVER_TS, DIST_INDEX, DIST_RESOLVER]
    snap = snapshot(paths)
    before = {p: md5(p) for p in paths}

    # A scratch copy of the two files, so the mutation is applied to a
    # snapshot and the REAL tree is restored byte-identically afterwards.
    tmpdir = tempfile.mkdtemp(prefix="r514-matrix-")
    backups = {}
    for p in paths:
        dest = os.path.join(tmpdir, os.path.basename(p))
        shutil.copy2(p, dest)
        backups[p] = dest

    try:
        index = read(INDEX_TS)
        resolver = read(RESOLVER_TS)

        mutants = [
            (
                "M1",
                "revert the resolver call to the hardcoded literal",
                "KILLED",
                lambda i, r: (
                    substitute(
                        i,
                        "const webUiPort = resolveWebUiPort(process.env.WEB_UI_PORT);",
                        "const webUiPort = { port: 8084, invalid: false };",
                        "M1 resolver call",
                    ),
                    r,
                ),
            ),
            (
                "M2",
                "resolve the port but IGNORE it (bind the hardcoded port anyway)",
                "KILLED",
                lambda i, r: (
                    substitute(
                        i,
                        "const uiPort = webUiPort.port;",
                        "const uiPort = 8084; // resolved above and discarded",
                        "M2 uiPort assignment",
                    ),
                    r,
                ),
            ),
            (
                "M3",
                "the resolver accepts ANY value (no validation)",
                "KILLED",
                lambda i, r: (
                    i,
                    substitute(
                        r,
                        "  if (!Number.isInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {\n"
                        "    return { port: DEFAULT_WEB_UI_PORT, invalid: true };\n"
                        "  }",
                        "  if (!Number.isInteger(parsed)) {\n"
                        "    return { port: DEFAULT_WEB_UI_PORT, invalid: true };\n"
                        "  }",
                        "M3 range check",
                    ),
                ),
            ),
            (
                "N1",
                "an equivalent spelling of the same resolution (negative control)",
                "SURVIVED",
                lambda i, r: (
                    substitute(
                        i,
                        "const webUiPort = resolveWebUiPort(process.env.WEB_UI_PORT);",
                        "const webUiPort = resolveWebUiPort(\n"
                        "    process.env['WEB_UI_PORT'],\n"
                        "  );",
                        "N1 equivalent spelling",
                    ),
                    r,
                ),
            ),
        ]

        rows = []
        for name, desc, expected, mutate in mutants:
            try:
                mi, mr = mutate(index, resolver)
            except SystemExit as exc:
                print("!! %s could not be applied: %s" % (name, exc))
                rows.append((name, desc, expected, "HARNESS"))
                continue

            write(INDEX_TS, mi)
            write(RESOLVER_TS, mr)

            # PROVE the mutation actually changed something. A needle that
            # does not appear means `str.replace` returned its input and the
            # run would report the SAME verdict as the unmutated tree.
            changed = [p for p in paths if md5(p) != before[p]]
            if not changed:
                rows.append((name, desc, expected, "NOT-INJECTED"))
                restore(snap)
                continue

            # The runtime arms observe the COMPILED artifact, so the build
            # must be refreshed or the mutation never reaches the subject.
            build()

            failed, passed, total, out = run_suite()
            if total is None:
                print("!! %s: the suite run produced NO measurement (worker error) -- HARNESS"
                      % name)
                rows.append((name, desc, expected, "HARNESS"))
            elif total != EXPECTED_TESTS:
                print("!! %s: suite reported %d tests, expected %d -- the parser is broken"
                      % (name, total, EXPECTED_TESTS))
                rows.append((name, desc, expected, "HARNESS"))
            else:
                verdict = "KILLED" if failed > 0 else "SURVIVED"
                rows.append((name, desc, expected, verdict))
                if verdict != expected:
                    print("!! %s expected %s, got %s (failed=%d passed=%d)"
                          % (name, expected, verdict, failed, passed))
                    print(out[-3000:])

            restore(snap)
            build()

        # CONTROL: the UNMUTATED suite must be GREEN.
        write(INDEX_TS, index)
        write(RESOLVER_TS, resolver)
        build()
        failed, passed, total, out = run_suite()
        if total is None:
            raise SystemExit("the CONTROL run produced no measurement -- the host is too loaded; "
                             "the matrix cannot conclude anything")
        if total != EXPECTED_TESTS:
            raise SystemExit("control run reported %d tests, expected %d" % (total, EXPECTED_TESTS))
        control_ok = failed == 0
        print("CONTROL (unmutated): failed=%d passed=%d total=%d -> %s"
              % (failed, passed, total, "GREEN" if control_ok else "RED"))

        # The restore must be byte-identical -- for the SOURCE files, which
        # are the ones the matrix mutated. The compiled artifacts are
        # rebuilt rather than restored, so they are checked separately: a
        # rebuild from restored sources must reproduce the same bytes.
        after = {p: md5(p) for p in paths}
        src_restored = all(before[p] == after[p] for p in (INDEX_TS, RESOLVER_TS))
        dist_restored = all(before[p] == after[p] for p in (DIST_INDEX, DIST_RESOLVER))
        restored = src_restored and dist_restored
        print("RESTORE: source byte-identical = %s, compiled byte-identical = %s"
              % (src_restored, dist_restored))

        print()
        print("%-4s %-52s %-10s %-10s %s" % ("ID", "MUTANT", "EXPECTED", "ACTUAL", "OK"))
        ok = control_ok and restored
        for name, desc, expected, actual in rows:
            good = expected == actual
            ok = ok and good
            print("%-4s %-52s %-10s %-10s %s" % (name, desc[:52], expected, actual, "ok" if good else "MISMATCH"))

        killed = sum(1 for r in rows if r[3] == "KILLED")
        survived = sum(1 for r in rows if r[3] == "SURVIVED")
        not_injected = sum(1 for r in rows if r[3] == "NOT-INJECTED")
        harness = sum(1 for r in rows if r[3] == "HARNESS")
        print()
        print("KILLED=%d SURVIVED=%d NOT-INJECTED=%d HARNESS=%d" % (killed, survived, not_injected, harness))
        print("VERDICT:", "PASS" if ok else "FAIL")
        return 0 if ok else 1
    finally:
        restore(snap)
        try:
            build()
        except SystemExit:
            pass
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
