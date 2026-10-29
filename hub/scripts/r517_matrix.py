#!/usr/bin/env python3
"""R517 mutation matrix -- the eviction query must agree with itself.

CONTROL FIRST, then mutations.  Every mutation must be VERIFIED INJECTED
(the file's md5 must change) -- an inert mutation is NOT-INJECTED, never
SURVIVED (R456-10c / R507).

A CRASH IS NOT A KILL (R461-M2 / R517-6).  A mutation that makes the query
throw (`ambiguous column name`, `near ")": syntax error`) is HARNESS, not a
kill: the suite went red because the PRODUCT broke, not because the probe
detected the defect.

WHAT THIS MATRIX MEASURES
-------------------------
The subject is a fix to the session-eviction query, and the question is not
"does the suite go red when the defect is present" -- the defect IS present
and r463 (tracked) already pins that.  The question is:

    does the new suite distinguish a REAL fix from a HALF fix?

  M1  REAL FIX: the adjustment is added to the score AND the filter uses
      the adjusted value.  The suite must stay GREEN -- the invariant holds.
  M2  HALF FIX (score only): the adjustment is added to the SELECT list but
      the filter still reads the base column.  The suite must go RED -- this
      is the fix that LOOKS right and is not, and it is the whole point.
  M3  HALF FIX (filter only): the filter uses the adjusted value but the
      SELECT list still reports the unadjusted score.  The suite must go
      RED -- the mirror-image half fix.
  N1  NEGATIVE CONTROL: a comment that changes nothing.  Must SURVIVE.
  N2  NEGATIVE CONTROL: a consistent rename of a local variable.  Must
      SURVIVE.

EVERY MUTATION PATCHES BOTH BACKENDS.  The two session-eviction blocks
differ only in the recency term of their ORDER BY (`MIN(...)` vs
`LEAST(...)`); the part a score/filter fix touches is byte-identical in
both.  Patching only one backend would make the suite's SHAPE arm red for a
reason unrelated to the half fix, and M1 (a real fix) would be misreported
as KILLED.  The subject under test is the SHAPE OF THE FIX, so the mutation
must apply the same shape to both backends.

PORTABILITY (this driver used to carry the defect class R514/R511/R513
cured in the sibling repository -- and that class had just been fixed in
llm-benchmark one hour before this tick, commit a190464):

  * the tree it measures is DERIVED from this file's own location;
  * the runner is resolved from THAT tree's node_modules/.bin -- never
    `npx`, which resolves against the CWD and DOWNLOADS a different
    version when the network is up;
  * the snapshot is taken IN MEMORY, so the restore cannot depend on any
    external file (a restore from a pruned scratch path is a silent NO-OP);
  * the restore happens in a `finally`, so an exception cannot leave the
    tracked source mutated (R507's failure mode);
  * the driver REFUSES TO RUN on a dirty owned file, and says why;
  * there is a hard TIMEOUT on each suite run.
"""
import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
HUB = os.path.dirname(HERE)
REPO = os.path.dirname(HUB)

# The tree this driver stands in -- derived, never transcribed.
if not os.path.isfile(os.path.join(HUB, "package.json")):
    sys.exit(
        "ABORT: cannot derive the hub tree above %s (no package.json) -- this "
        "driver must live inside a checkout of the repository it measures."
        % HERE
    )

DBTS = os.path.join(HUB, "src", "db.ts")
SUITE = "test/r517_eviction_filter_consistency.test.ts"
EXPECTED_TOTAL = 4

# The runner, resolved from THIS tree.  `npx` resolves against the CWD's
# package tree and -- when the network is available -- DOWNLOADS one
# instead of failing, so a driver validated on exactly one tree is a driver
# validated on exactly one tree.
VITEST = os.path.join(HUB, "node_modules", ".bin", "vitest")
if not os.path.exists(VITEST):
    sys.exit(
        "ABORT: %s does not exist -- the tree this driver stands in has no "
        "vitest, so it cannot measure anything. Run `npm ci` there first."
        % VITEST
    )


def md5(p):
    with open(p, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def head_blob_md5(rel):
    """The md5 of `rel` as the repository's HEAD records it.

    The baseline is DERIVED, not transcribed (R511/R513/R507's lesson: a
    pinned constant is a pinned path -- one benign commit later it goes
    stale and the driver misfires).  The guard's INTENT is "has somebody
    else edited this file since the last commit?"; deriving the baseline
    from HEAD preserves that intent while dropping the constant.
    """
    out = subprocess.run(
        ["git", "-C", REPO, "show", "HEAD:" + rel],
        capture_output=True, check=True).stdout
    return hashlib.md5(out).hexdigest()


def run_tests():
    """Run the suite.  Returns (failed, passed, errored, assertion_failed, ran, out)."""
    r = subprocess.run(
        [VITEST, "run", SUITE, "--reporter=basic", "--no-coverage"],
        cwd=HUB, capture_output=True, text=True, timeout=600)
    out = r.stdout + r.stderr
    # The summary is parsed EXPLICITLY and asserted against the known suite
    # size.  A parser that cannot tell "the suite passed" from "the suite
    # never ran" turns a broken harness into a GREEN control.
    #
    # MEASURED 2026-10-29: the first draft of this parser reported
    # failed=0 passed=0 for FOUR different broken runs -- a missing suite
    # file, a crashed vitest, a missing runner -- and the control gate
    # PASSED all four, because `failed != 0` was false and `errored` was
    # false.  A "no test files" run is not a green run.
    m = re.search(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed", out)
    failed = int(m.group(1)) if (m and m.group(1)) else 0
    passed = int(m.group(2)) if m else 0
    # The patterns must be SPECIFIC: a bare "Error:" matches vitest's own
    # assertion output ("AssertionError: expected ...") and would classify
    # every real kill as HARNESS.
    errored = bool(re.search(
        r"ReferenceError:|SqliteError:|SQLITE_ERROR|TypeError:|is not defined|"
        r"ambiguous column name|syntax error|SyntaxError:|"
        r"Cannot read properties|is not a function|"
        r"Incorrect number of bindings|"
        r"\[vitest-worker\]", out))
    compile_err = "error TS" in out or "Failed to load" in out
    assertion_failed = "AssertionError" in out
    # "ran" means the suite EXECUTED and reported the EXPECTED test count.
    # A run that matched no files, that died before the summary, or that
    # ran a different number of tests, did not run THIS suite.
    ran = m is not None and (passed + failed) == EXPECTED_TOTAL
    return failed, passed, errored, assertion_failed, compile_err, ran, out


# ── the mutations ───────────────────────────────────────────────────────────
# The needle is DERIVED from the source file, not transcribed by hand: a
# transcribed needle silently drifts (R511/R513's lesson -- a pinned
# constant is a pinned path).

# The current (unfixed) session-eviction block, sqlite flavour.  It is
# located by CONTENT (the only template literal that selects from `sessions`
# and carries `access_count`), so a rename of the local variable does not
# move it.
BLOCK_RE = re.compile(
    r"SELECT id, importance, COALESCE\(last_accessed_at, ended_at, created_at\) "
    r"as last_accessed_at, access_count\n"
    r"      FROM sessions WHERE importance < \?"
)
EXPECTED_SITES = 2

# M1 -- THE REAL FIX.  A correlated scalar subquery supplies the adjustment;
# it appears in BOTH the score and the filter, so the two agree.  No GROUP BY
# is introduced, and the WHERE clause qualifies the base column (`s.importance`)
# so the alias cannot shadow it.
#
# THE ALIAS STAYS `importance`, NOT `eff_importance`.  MEASURED 2026-10-29:
# the first draft of this fix renamed the alias, and the row map still reads
# `r.importance` -- so the returned object's `importance` became `undefined`
# and the matrix reported the REAL FIX as KILLED.  The fix must keep the
# OUTPUT COLUMN named `importance`; the SHADOWING problem is confined to
# `HAVING`, which this fix does not use (it filters in `WHERE`).
FIX = """SELECT s.id, s.importance + COALESCE((SELECT SUM(f.adjustment) FROM session_feedback f WHERE f.session_id = s.id), 0) AS importance,
             COALESCE(s.last_accessed_at, s.ended_at, s.created_at) AS last_accessed_at,
             s.access_count
      FROM sessions s
      WHERE s.importance + COALESCE((SELECT SUM(f.adjustment) FROM session_feedback f WHERE f.session_id = s.id), 0) < ?"""

# M2 -- HALF FIX, score only.  The adjustment reaches the SELECT list; the
# filter still reads the base column `importance`.  The query therefore
# reports the adjusted score but filters on the unadjusted one.
HALF_SCORE_ONLY = """SELECT s.id, s.importance + COALESCE((SELECT SUM(f.adjustment) FROM session_feedback f WHERE f.session_id = s.id), 0) AS importance,
             COALESCE(s.last_accessed_at, s.ended_at, s.created_at) AS last_accessed_at,
             s.access_count
      FROM sessions s
      WHERE s.importance < ?"""

# M3 -- HALF FIX, filter only.  The filter uses the adjusted value but the
# SELECT list still reports the unadjusted score.
HALF_FILTER_ONLY = """SELECT id, importance, COALESCE(last_accessed_at, ended_at, created_at) as last_accessed_at, access_count
      FROM sessions
      WHERE importance + COALESCE((SELECT SUM(f.adjustment) FROM session_feedback f WHERE f.session_id = sessions.id), 0) < ?"""

MUTATIONS = [
    ("M1 real fix (adjustment in BOTH the score and the filter)", "SURVIVED", "M1"),
    ("M2 half fix (score only -- the filter still reads the base column)", "KILLED", "M2"),
    ("M3 half fix (filter only -- the score is still the unadjusted one)", "KILLED", "M3"),
    ("N1 negative control (comment)", "SURVIVED", "N1"),
    ("N2 negative control (consistent rename)", "SURVIVED", "N2"),
]


def inject(src, mode):
    """Return (new_src, note).  Raises RuntimeError when it cannot inject."""
    if mode == "N2":
        # A consistent rename of the local variable.  Derived from the
        # source, not transcribed: the declaration and its one use.
        new = src.replace("const sessRows =", "const sessRowsRenamed =", 1)
        new = new.replace("sessions: sessRows.map(", "sessions: sessRowsRenamed.map(", 1)
        if new == src:
            raise RuntimeError("N2 did not change anything")
        return new, "renamed sessRows"

    sites = list(BLOCK_RE.finditer(src))
    if len(sites) != EXPECTED_SITES:
        raise RuntimeError(
            "the session-eviction block was found %d time(s), expected %d -- "
            "the needle drifted" % (len(sites), EXPECTED_SITES))

    if mode == "N1":
        # A comment that changes nothing.  It goes at the FIRST site only:
        # a comment is behaviour-neutral in both backends, and adding it to
        # both would exercise nothing extra.
        m = sites[0]
        return src[:m.start()] + "      -- r517 negative control: this comment changes nothing\n" + src[m.start():], "comment"

    new_block = {"M1": FIX, "M2": HALF_SCORE_ONLY, "M3": HALF_FILTER_ONLY}[mode]
    # Replace from the LAST site backwards so the earlier offsets stay valid.
    out = src
    for m in reversed(sites):
        out = out[:m.start()] + new_block + out[m.end():]
    return out, "replaced %d site(s)" % len(sites)


def main():
    # The owned file must be at the repository's HEAD baseline.  A driver
    # that mutates a file somebody else owns measures THAT person's tree.
    # MEASURED 2026-10-29: a foreground run of this driver was killed by a
    # 180s timeout MID-MUTATION and left `db.ts` in a mutated state; the
    # next run found the tree dirty.  The driver refused to score it --
    # which is right -- but refusing is only useful if the message says
    # what to do.
    head_md5 = head_blob_md5("hub/src/db.ts")
    actual_md5 = md5(DBTS)
    if actual_md5 != head_md5:
        sys.exit(
            "ABORT: the owned file is not at the repository baseline:\n"
            "  hub/src/db.ts md5 %s != HEAD baseline %s\n"
            "  Somebody (or an interrupted run) left it modified.  Inspect\n"
            "  `git diff -- hub/src/db.ts` and restore it before measuring."
            % (actual_md5[:12], head_md5[:12])
        )

    baseline = actual_md5
    # The snapshot is taken IN MEMORY, so the restore cannot depend on any
    # external file.  A restore from a pruned scratch path is a silent
    # NO-OP, and the driver's own md5 check runs AFTER the failed restore,
    # so it reports the damage only after doing it (R507).
    with open(DBTS, "rb") as f:
        pristine = f.read()

    print("baseline md5 %s" % baseline)
    print("tree        %s" % HUB)
    print("runner      %s" % VITEST)

    print("\n=== CONTROL ===")
    failed, passed, errored, assertion_failed, compile_err, ran, out = run_tests()
    print("control: failed=%d passed=%d errored=%s compile_err=%s ran=%s"
          % (failed, passed, errored, compile_err, ran))
    if not ran:
        print(out[-3000:])
        print("CONTROL DID NOT RUN -- aborting (a suite that never ran is not a control)")
        return 2
    if compile_err or errored or failed != 0:
        print(out[-3000:])
        print("CONTROL NOT GREEN -- aborting")
        return 2
    if passed != EXPECTED_TOTAL:
        print("control reported %d tests, expected %d -- aborting"
              % (passed, EXPECTED_TOTAL))
        return 2

    results = []
    try:
        for name, expected, mode in MUTATIONS:
            src = pristine.decode("utf-8")
            try:
                mutated, note = inject(src, mode)
            except RuntimeError as e:
                results.append((name, "NOT-INJECTED", expected))
                print("%s: NOT-INJECTED (%s)" % (name, e))
                continue
            if mutated == src:
                results.append((name, "NOT-INJECTED", expected))
                print("%s: NOT-INJECTED (no-op)" % name)
                continue
            # Write, then VERIFY the injection by BYTES (R507): a stale
            # needle or a no-op replace must never read as SURVIVED.
            tmp = DBTS + ".r517tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(mutated)
            os.replace(tmp, DBTS)
            if md5(DBTS) == baseline:
                results.append((name, "NOT-INJECTED", expected))
                print("%s: NOT-INJECTED (md5 unchanged)" % name)
                continue

            failed, passed, errored, assertion_failed, compile_err, ran, out = run_tests()
            if not ran:
                verdict = "HARNESS(did-not-run)"
            elif compile_err:
                verdict = "HARNESS(compile)"
            elif errored and not assertion_failed:
                verdict = "HARNESS(error)"
            elif failed > 0:
                verdict = "KILLED"
            else:
                verdict = "SURVIVED"
            results.append((name, verdict, expected))
            print("%s: %s (failed=%d passed=%d errored=%s ran=%s) expected=%s"
                  % (name, verdict, failed, passed, errored, ran, expected))
    finally:
        # The restore happens in a `finally` (R507's lesson): a timeout or a
        # crash must not leave the tracked source mutated.  The restore is
        # by BYTES (never `git checkout` -- R446-1: it destroys other
        # agents' uncommitted work).
        tmp = DBTS + ".r517restore"
        with open(tmp, "wb") as f:
            f.write(pristine)
        os.replace(tmp, DBTS)

    final = md5(DBTS)
    print("\nfinal md5 %s  match=%s" % (final, final == baseline))
    ok = True
    for name, verdict, expected in results:
        mark = "OK " if verdict == expected else "MISMATCH"
        if verdict != expected:
            ok = False
        print("  %s %s: %s (expected %s)" % (mark, name, verdict, expected))
    print("\nMATRIX " + ("PASS" if ok and final == baseline else "FAIL"))
    return 0 if (ok and final == baseline) else 1


def assertion_failed_of(out):
    """Whether the run red for an ASSERTION reason rather than a crash."""
    return "AssertionError" in out


if __name__ == "__main__":
    sys.exit(main())
