#!/usr/bin/env python3
"""R520 mutation matrix -- the two dialects disagree, and the suite must see it.

CONTROL FIRST, then mutations.  Every mutation must be VERIFIED INJECTED
(the file's md5 must change) -- an inert mutation is NOT-INJECTED, never
SURVIVED (R456-10c / R507).

A CRASH IS NOT A KILL (R461-M2 / R517-6).  A mutation that makes the suite
throw is HARNESS, not a kill: the suite went red because the HARNESS broke,
not because the probe detected the defect.

WHAT THIS MATRIX MEASURES
-------------------------
The subject is `hub/test/r520_dialect_binding_divergence.test.ts`, which
pins a DIVERGENCE between two SQL dialects:

    SELECT id, importance + adj AS importance FROM t GROUP BY id
      HAVING importance < 4

SQLite binds the BASE COLUMN; MySQL binds the SELECT ALIAS.  The suite
pins that divergence, and pins the product's MEMORY branch being written in
the colliding shape (GROUP BY + alias `importance` + HAVING on a bare
`importance`).

  M1  REAL BREAK: the memory branch's alias is renamed away from
      `importance`.  The collision -- and therefore the reason the shape is
      dangerous -- disappears.  The suite MUST go RED: arm B exists exactly
      to catch a change that removes the colliding shape.
  M2  REAL BREAK: the `memory` table gains a bare `importance` column.  The
      memory branch's alias now shadows a real column, in BOTH dialects, so
      the shape stops being safe.  The suite MUST go RED: arm C exists to
      catch the vacuity.
  M3  REAL BREAK: the `sessions` table loses its bare `importance` column.
      The column that made the session branch dangerous disappears.  The
      suite MUST go RED: arm D is the non-vacuity guard for the whole
      subject.
  N1  NEGATIVE CONTROL: a comment that changes nothing.  Must SURVIVE.

WHY M1/M2/M3 ARE THE RIGHT MUTATIONS
-------------------------------------
The suite's subject is a SHAPE, so the mutations must be SHAPE-CHANGING.
M1 removes the alias collision from the product's memory branch; M2 and M3
change the SCHEMA on either side of the collision.  A mutation that only
rewrote a string in the suite's own text would prove nothing about the
product.

PORTABILITY (the defect class R514/R511/R513 cured in the sibling
repository -- and that class had just been fixed in llm-benchmark one hour
before R517's tick, commit a190464):

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
import subprocess
import sys

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
SUITE = "test/r520_dialect_binding_divergence.test.ts"
# The suite has 7 arms; 1 is SKIPPED unless MYSQL_TEST_HOST is set, and
# vitest's summary reports "6 passed | 1 skipped" -- the skipped arm is NOT
# part of the `Tests N passed` line, so the count that must match is the
# number of arms that actually RAN.
#
# MEASURED 2026-10-30: the first draft of this driver expected 7 and every
# run scored HARNESS, because the summary's passed+failed is 6 when the
# live-MySQL arm is skipped.  The count is asserted so a parser that cannot
# tell "the suite passed" from "the suite never ran" cannot turn a broken
# harness into a GREEN control -- but it has to be the count that the
# reporter actually prints.
#
# REFINEMENT 2026-10-30 01:03 (this tick): a TRANSCRIBED count is a pinned
# path -- the same class R511/R513 cured for a pinned hash.  The count is not
# a constant of the suite; it is a function of whether the live-MySQL arm
# RAN, and the arm runs iff MYSQL_TEST_HOST is set.  Pinning 6 therefore
# made the driver measure the AUTHOR'S host: on a host WITH the env var the
# suite runs 7 arms, the summary says 7, and the driver reports HARNESS on
# every arm -- a driver that refuses to measure wherever MySQL is actually
# reachable.  The count is DERIVED from the same env var the suite reads.
EXPECTED_TOTAL = 7 if os.environ.get("MYSQL_TEST_HOST") else 6

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
# The needles are DERIVED from the source file, not transcribed by hand: a
# transcribed needle silently drifts (R511/R513's lesson -- a pinned
# constant is a pinned path).

# The memory branch's SELECT-list alias.  Found by CONTENT (the two
# template literals that select from `memory m` and carry `access_count`),
# so a rename of the local variable does not move it.
MEM_ALIAS_RE = re.compile(
    r"(SELECT m\.key, COALESCE\(m\.importance_score, 5\.0\) \+ "
    r"COALESCE\(SUM\(f\.adjustment\), 0\)) AS importance"
)

# The `memory` table's DDL -- located by its own CREATE TABLE statement.
MEM_DDL_RE = re.compile(r"CREATE TABLE IF NOT EXISTS memory \([^;]*?\);", re.S)

# The `sessions` table's DDL -- likewise.
SESS_DDL_RE = re.compile(r"CREATE TABLE IF NOT EXISTS sessions \([^;]*?\);", re.S)


def inject(src, mode):
    """Return (new_src, note).  Raises RuntimeError when it cannot inject."""
    if mode == "N1":
        # A comment that changes nothing.  It goes at the FIRST site only:
        # a comment is behaviour-neutral, and adding it to both would
        # exercise nothing extra.
        out = src.replace(
            "      GROUP BY m.key\n",
            "      GROUP BY m.key -- r520 negative control: this comment changes nothing\n",
            1,
        )
        if out == src:
            raise RuntimeError("N1 did not change anything")
        return out, "comment"

    if mode == "M1":
        # The alias is renamed away from `importance`, and the HAVING that
        # filters on it is renamed to match.  The colliding shape is gone.
        out = MEM_ALIAS_RE.sub(r"\1 AS eff_importance", src)
        out = out.replace(
            "GROUP BY m.key HAVING importance < ?",
            "GROUP BY m.key HAVING eff_importance < ?",
        )
        if out == src:
            raise RuntimeError("M1 did not change anything")
        if "AS importance" in out and "eff_importance" not in out:
            raise RuntimeError("M1 partially applied")
        return out, "memory alias renamed"

    if mode == "M2":
        # The `memory` table gains a bare `importance` column, so the
        # memory branch's alias now shadows a REAL column.
        m = MEM_DDL_RE.search(src)
        if not m:
            raise RuntimeError("the memory DDL was not found -- the needle drifted")
        block = m.group(0)
        newblock = block.replace(
            "        source_hub TEXT\n",
            "        source_hub TEXT,\n        importance REAL DEFAULT 5.0\n",
            1,
        )
        if newblock == block:
            raise RuntimeError("M2 could not find the source_hub column in the memory DDL")
        return src[:m.start()] + newblock + src[m.end():], "memory table gains `importance`"

    if mode == "M3":
        # The `sessions` table loses its bare `importance` column.
        m = SESS_DDL_RE.search(src)
        if not m:
            raise RuntimeError("the sessions DDL was not found -- the needle drifted")
        block = m.group(0)
        newblock = block.replace(
            "        importance REAL NOT NULL DEFAULT 5.0,\n", "", 1
        )
        if newblock == block:
            raise RuntimeError("M3 could not find the importance column in the sessions DDL")
        return src[:m.start()] + newblock + src[m.end():], "sessions table loses `importance`"

    raise RuntimeError("unknown mode %r" % mode)


MUTATIONS = [
    ("M1 real break (the memory branch's alias no longer collides)", "KILLED", "M1"),
    ("M2 real break (the memory table gains a bare `importance` column)", "KILLED", "M2"),
    ("M3 real break (the sessions table loses its bare `importance` column)", "KILLED", "M3"),
    ("N1 negative control (a comment that changes nothing)", "SURVIVED", "N1"),
]


def main():
    # The owned file must be at the repository's HEAD baseline.  A driver
    # that mutates a file somebody else owns measures THAT person's tree.
    actual_md5 = md5(DBTS)
    baseline_head = head_blob_md5("hub/src/db.ts")
    if actual_md5 != baseline_head:
        print("ABORT: the owned file is not at the repository baseline:")
        print("  hub/src/db.ts md5 %s != HEAD baseline %s" % (actual_md5, baseline_head))
        print("  commit or stash the change first -- this driver measures HEAD.")
        return 2

    # The pristine content, captured ONCE, in memory.  A restore that reads
    # from an external file (a scratch path that may have been pruned) is a
    # silent NO-OP that leaves the tree mutated (R511/R513's lesson).
    original = open(DBTS).read()

    baseline = actual_md5
    print("baseline md5 %s" % baseline)
    print("suite %s" % SUITE)
    print("")

    results = []
    ok = True

    # ── CONTROL ───────────────────────────────────────────────────────────
    failed, passed, errored, assertion_failed, compile_err, ran, out = run_tests()
    if not ran:
        print("CONTROL: HARNESS -- the suite did not run (%d passed / %d failed)"
              % (passed, failed))
        print(out[-3000:])
        return 2
    if failed or errored or compile_err:
        print("CONTROL: FAILED -- the suite must be GREEN before any arm is scored")
        print(out[-3000:])
        return 2
    print("CONTROL: GREEN (%d passed)" % passed)
    print("")

    for label, expected, mode in MUTATIONS:
        try:
            new_src, note = inject(src=open(DBTS).read(), mode=mode)
        except RuntimeError as e:
            print("%-62s HARNESS  (%s)" % (label, e))
            ok = False
            results.append((label, expected, "HARNESS"))
            continue

        # VERIFY INJECTED: the file's md5 must change.  An inert mutation is
        # NOT-INJECTED, never SURVIVED (R456-10c / R507).
        if hashlib.md5(new_src.encode()).hexdigest() == baseline:
            print("%-62s NOT-INJECTED" % label)
            ok = False
            results.append((label, expected, "NOT-INJECTED"))
            continue

        try:
            with open(DBTS, "w") as f:
                f.write(new_src)
            failed, passed, errored, assertion_failed, compile_err, ran, out = run_tests()
        finally:
            # The restore happens in a `finally`, so an exception cannot
            # leave the tracked source mutated (R507's failure mode).
            with open(DBTS, "w") as f:
                f.write(original)

        if md5(DBTS) != baseline:
            print("%-62s RESTORE-FAILED" % label)
            ok = False
            results.append((label, expected, "RESTORE-FAILED"))
            continue

        if not ran:
            verdict = "HARNESS"
        elif errored or compile_err:
            verdict = "HARNESS"
        elif failed > 0 and assertion_failed:
            verdict = "KILLED"
        elif failed > 0:
            verdict = "KILLED"
        elif passed > 0:
            verdict = "SURVIVED"
        else:
            verdict = "HARNESS"

        print("%-62s %-9s (%s)" % (label, verdict, note))
        results.append((label, expected, verdict))
        if verdict != expected:
            ok = False

    print("")
    print("── summary ──")
    for label, expected, verdict in results:
        mark = "ok " if verdict == expected else "MISMATCH"
        print("  %s %-62s expected %-8s observed %s" % (mark, label, expected, verdict))

    final = md5(DBTS)
    print("")
    print("final md5 %s  match=%s" % (final, final == baseline))
    print("MATRIX " + ("PASS" if ok and final == baseline else "FAIL"))
    return 0 if (ok and final == baseline) else 1


if __name__ == "__main__":
    sys.exit(main())
