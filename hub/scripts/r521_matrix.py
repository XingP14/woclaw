#!/usr/bin/env python3
"""R521 mutation matrix -- the two plaintext planes must be killable.

CONTROL FIRST, then mutations.  Every mutation must be VERIFIED INJECTED
(the file's md5 must change) -- an inert mutation is NOT-INJECTED, never
SURVIVED (R456-10c / R507).

A CRASH IS NOT A KILL (R461-M2 / R517-6).  A mutation that makes the suite
throw is HARNESS, not a kill: the suite went red because the HARNESS broke,
not because the probe detected the defect.

WHAT THIS MATRIX MEASURES
-------------------------
The subject is `hub/test/r521_encryption_plaintext_planes.test.ts`, which
pins TWO plaintext planes that survive encryption-at-rest:

  C1  the GRAPH MIRROR -- `MemoryPool.write()` hands `graphStore
      .syncMemoryNode(key, serialized, ...)` the PLAINTEXT, so
      `GET /graph/nodes?type=memory` serves the plaintext while the memory
      table holds ciphertext.
  C2  the LEGACY IMPORT -- `importLegacyData()` writes `mem.value` and
      `version.value` into the memory / memory_versions tables with NO
      encryption, so an imported legacy value is stored AND served as
      plaintext.

The suite asserts the OBSERVED (defective) behaviour, so a REPAIR makes it
RED.  That is the point: the arms below are the REPAIRS, and each one must
turn the suite red.  A repair that leaves the suite green means the suite
was not measuring that plane at all -- which is the failure mode this
matrix exists to catch.

  M1  REAL REPAIR: the graph mirror is fed the ENCRYPTED form.  The
      plaintext no longer reaches `GET /graph/nodes`.  MUST go RED.
  M2  REAL REPAIR (partial -- C2's memory half): the legacy import
      encrypts the imported memory value.  The import is no longer a
      plaintext plane.  MUST go RED.
  M3  REAL REPAIR (partial -- C2's version-history half): the legacy import
      encrypts the imported VERSION value.  MUST go RED.
  N1  NEGATIVE CONTROL: a comment that changes nothing.  Must SURVIVE.

WHY M1/M2/M3 ARE THE RIGHT MUTATIONS
-------------------------------------
The suite's subject is a PLAINTEXT PLANE, so the mutations must CLOSE the
plane.  M1 closes the graph mirror; M2 and M3 close the two halves of the
legacy import separately, because they are separate writes in separate
tables -- closing one does not close the other, and a suite that only
pinned "some plaintext exists" could pass with either half still open.

M2 and M3 are deliberately PARTIAL: they close one write each.  If the
suite's C2 arms could not tell them apart, one of them would survive, and
the surviving arm would be the evidence that the suite is measuring the
right write.

PORTABILITY (the defect class R514/R511/R513 cured in the sibling
repository -- and that class had just been fixed in llm-benchmark one hour
before R517's tick, commit a190464):

  * the tree it measures is DERIVED from this file's own location;
  * the runner is resolved from THAT tree's node_modules/.bin -- never
    `npx`, which resolves against the CWD and DOWNLOADS a different
    version when the network is up (R514's R498 family);
  * the snapshot is taken IN MEMORY, so the restore cannot depend on any
    external file (a restore from a pruned scratch path is a silent NO-OP);
  * the restore happens in a `finally`, so an exception cannot leave the
    tracked source mutated (R507's failure mode);
  * the driver REFUSES TO RUN on a dirty owned file, and says why;
  * there is a hard TIMEOUT on each suite run;
  * the expected test count is DERIVED from the suite's own arms, not
    transcribed (R511/R513: a transcribed constant is a pinned path).
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

MEMORY_TS = os.path.join(HUB, "src", "memory.ts")
DBTS = os.path.join(HUB, "src", "db.ts")
SUITE = "test/r521_encryption_plaintext_planes.test.ts"

# The suite has 9 arms and none of them is environment-dependent: there is
# no live-MySQL arm here (both defects are in the SQLite-agnostic write
# path), so the count is a constant of the suite -- but it is asserted
# against the suite's OWN `it(` count rather than transcribed, so a suite
# that gains or loses an arm cannot silently be measured by a stale
# expectation (R511/R513's lesson).
#
# The count is read from the suite file itself: the number of top-level
# `it(` call sites.  This is a DERIVATION, not a transcription.
def expected_total() -> int:
    src = open(os.path.join(HUB, SUITE), encoding="utf-8").read()
    # Count only `it(` at the start of a line (indented) -- the arms.
    n = len(re.findall(r"^\s+it\(", src, re.M))
    if n == 0:
        sys.exit("ABORT: could not derive the arm count from %s" % SUITE)
    return n


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
    """Run the suite.  Returns (failed, passed, errored, assertion_failed,
    compile_err, ran, out)."""
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
        r"Cannot read properties|is not a function|"
        r"\[vitest-worker\]", out))
    compile_err = "error TS" in out or "Failed to load" in out
    assertion_failed = "AssertionError" in out
    # "ran" means the suite EXECUTED and reported the EXPECTED test count.
    # A run that matched no files, that died before the summary, or that
    # ran a different number of tests, did not run THIS suite.
    ran = m is not None and (passed + failed) == expected_total()
    return failed, passed, errored, assertion_failed, compile_err, ran, out


# ── the mutations ───────────────────────────────────────────────────────────
# The needles are DERIVED from the source file, not transcribed by hand: a
# transcribed needle silently drifts (R511/R513's lesson -- a pinned
# constant is a pinned path).

# The graph-mirror producer call.  Located by CONTENT (the argument name
# and the method), so a rename of the local variable does not move it.
MIRROR_CALL_RE = re.compile(
    r"(this\.graphStore\.syncMemoryNode\(\s*key\s*,\s*)serialized(\s*,)"
)


def inject_memory(src, mode):
    """Return (new_src, note) for a mutation of hub/src/memory.ts."""
    if mode == "N1":
        # A comment that changes nothing.  It goes AFTER the statement, on
        # the same line, so it cannot swallow the following argument -- a
        # comment placed between two arguments would comment out the comma
        # and break the call, which is a HARNESS, not a SURVIVAL.
        out = src.replace(
            "this.graphStore.syncMemoryNode(key, serialized, updatedBy, tags);",
            "this.graphStore.syncMemoryNode(key, serialized, updatedBy, tags); "
            "// r521 negative control: this comment changes nothing",
            1,
        )
        if out == src:
            raise RuntimeError("N1 did not change anything")
        return out, "comment"

    if mode == "M1":
        # REAL REPAIR: the mirror is fed the ENCRYPTED form instead of the
        # plaintext.  The mirror no longer holds a plaintext copy, so the
        # suite's C1 arms -- which pin the PLAINTEXT in the mirror -- must
        # go RED.
        #
        # The encrypted form is what the STORE holds.  `MemoryPool` does not
        # have the provider, so the repair is expressed the way the product
        # would express it: the mirror receives the value as stored.  The
        # driver only needs the mutation to be REAL and OBSERVABLE -- it
        # changes the value the mirror receives from the plaintext to a
        # different, marked form, which is exactly the property the suite
        # pins.
        out = MIRROR_CALL_RE.sub(r"\1'ENC:v1:REDACTED'\2", src, count=1)
        if out == src:
            raise RuntimeError("M1 did not change anything")
        if "ENC:v1:REDACTED" not in out:
            raise RuntimeError("M1 partially applied")
        return out, "the graph mirror is fed the stored form"

    raise RuntimeError("unknown memory mode %r" % mode)


# The legacy import's memory insert.  The SQLite path uses a PREPARED
# STATEMENT (`insertMemory.run(...)`), not a chained `.run(` -- so the needle
# is located by the CALL SITE, and only the VALUE argument is rewritten.
LEGACY_MEM_RE = re.compile(
    r"(insertMemory\.run\(\s*\n"
    r"\s*mem\.key,\s*\n"
    r"\s*)(mem\.value \?\? '')(,)"
)


def inject_db(src, mode):
    """Return (new_src, note) for a mutation of hub/src/db.ts."""
    if mode == "M2":
        # REAL REPAIR (memory half): the imported memory value is encrypted
        # before it is written, so the import is no longer a plaintext
        # plane.  The suite's C2a / C2c / C2d arms pin the plaintext and
        # must go RED.
        out = LEGACY_MEM_RE.sub(r"\1encryptValueForLegacy(mem.value ?? '')\3", src)
        if out == src:
            raise RuntimeError("M2 did not change anything")
        if "encryptValueForLegacy" not in out:
            raise RuntimeError("M2 partially applied")
        return out, "the legacy memory import is encrypted"

    if mode == "M3":
        # REAL REPAIR (version-history half): the imported VERSION value is
        # encrypted.  This is a DIFFERENT write -- a different table, a
        # different column -- so it must be a separate arm: a suite that
        # could not tell the two apart would let one of them survive.
        out = src.replace(
            "          version.key,\n          version.value ?? '',\n",
            "          version.key,\n          encryptValueForLegacy(version.value ?? ''),\n",
            1,
        )
        if out == src:
            raise RuntimeError("M3 did not change anything")
        return out, "the legacy version import is encrypted"

    raise RuntimeError("unknown db mode %r" % mode)


# The helper the two db mutations call must EXIST for the suite to run at
# all -- a mutation that fails to compile is a HARNESS, not a kill.  It is
# added as part of the injection.
HELPER = """
/** r521 matrix helper: encrypt a legacy-imported value for storage. */
function encryptValueForLegacy(plaintext: string): string {
  return `ENC:v1:legacy${Buffer.from(plaintext, 'utf8').toString('base64')}`;
}
"""


def inject_with_helper(src, new_src):
    """Add the helper the db mutations need, if it is not already there."""
    if "encryptValueForLegacy" in src and "function encryptValueForLegacy" in src:
        return new_src
    marker = "function legacyStoragePath(dataDir: string): string {"
    if marker not in new_src:
        raise RuntimeError("could not find the helper insertion point")
    return new_src.replace(marker, HELPER + "\n" + marker, 1)


MUTATIONS = [
    ("M1 real repair (the graph mirror is fed the stored form)", "KILLED", "memory", "M1"),
    ("M2 real repair (the legacy memory import is encrypted)", "KILLED", "db", "M2"),
    ("M3 real repair (the legacy version import is encrypted)", "KILLED", "db", "M3"),
    ("N1 negative control (a comment that changes nothing)", "SURVIVED", "memory", "N1"),
]


def main():
    # The owned files must be at the repository's HEAD baseline.  A driver
    # that mutates a file somebody else owns measures THAT person's tree.
    owned = [("hub/src/memory.ts", MEMORY_TS), ("hub/src/db.ts", DBTS)]
    for rel, path in owned:
        actual = md5(path)
        baseline = head_blob_md5(rel)
        if actual != baseline:
            print("ABORT: the owned file is not at the repository baseline:")
            print("  %s md5 %s != HEAD baseline %s" % (rel, actual, baseline))
            print("  commit or stash the change first -- this driver measures HEAD.")
            return 2

    # The pristine content, captured ONCE, in memory.  A restore that reads
    # from an external file (a scratch path that may have been pruned) is a
    # silent NO-OP that leaves the tree mutated (R511/R513's lesson).
    originals = {rel: open(path, encoding="utf-8").read() for rel, path in owned}
    baselines = {rel: md5(path) for rel, path in owned}

    print("suite %s" % SUITE)
    print("expected arms %d (derived from the suite file)" % expected_total())
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

    for label, expected, target, mode in MUTATIONS:
        rel, path = owned[0] if target == "memory" else owned[1]
        try:
            src = open(path, encoding="utf-8").read()
            if target == "memory":
                new_src, note = inject_memory(src, mode)
            else:
                new_src, note = inject_db(src, mode)
                new_src = inject_with_helper(src, new_src)
        except RuntimeError as e:
            print("%-62s HARNESS  (%s)" % (label, e))
            ok = False
            results.append((label, expected, "HARNESS"))
            continue

        # VERIFY INJECTED: the file's md5 must change.  An inert mutation is
        # NOT-INJECTED, never SURVIVED (R456-10c / R507).
        if hashlib.md5(new_src.encode()).hexdigest() == baselines[rel]:
            print("%-62s NOT-INJECTED" % label)
            ok = False
            results.append((label, expected, "NOT-INJECTED"))
            continue

        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(new_src)
            failed, passed, errored, assertion_failed, compile_err, ran, out = run_tests()
        finally:
            # The restore happens in a `finally`, so an exception cannot
            # leave the tracked source mutated (R507's failure mode).
            with open(path, "w", encoding="utf-8") as f:
                f.write(originals[rel])

        if md5(path) != baselines[rel]:
            print("%-62s RESTORE-FAILED" % label)
            ok = False
            results.append((label, expected, "RESTORE-FAILED"))
            continue

        if not ran:
            verdict = "HARNESS"
        elif errored or compile_err:
            verdict = "HARNESS"
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
    print("-- summary --")
    for label, expected, verdict in results:
        mark = "ok " if verdict == expected else "MISMATCH"
        print("  %s %-62s expected %-8s observed %s" % (mark, label, expected, verdict))

    final_ok = True
    for rel, path in owned:
        final = md5(path)
        print("%s final md5 %s  match=%s" % (rel, final, final == baselines[rel]))
        if final != baselines[rel]:
            final_ok = False
    print("MATRIX " + ("PASS" if ok and final_ok else "FAIL"))
    return 0 if (ok and final_ok) else 1


if __name__ == "__main__":
    sys.exit(main())
