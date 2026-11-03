#!/usr/bin/env python3
"""
R530 mutation matrix -- the POINTER PLANE must be killable.

CONTROL FIRST, then mutations.  Every mutation must be VERIFIED INJECTED
(the file's md5 must change) -- an inert mutation is NOT-INJECTED, never
SURVIVED (R456-10c / R507).

A CRASH IS NOT A KILL (R461-M2 / R517-6).  A mutation that makes the suite
throw is HARNESS, not a kill: the suite went red because the HARNESS broke,
not because the probe detected the defect.

WHAT THIS MATRIX MEASURES
-------------------------
The subject is `hub/test/r530_pointer_plane.test.ts`, which pins the
OBSERVED (defective) behaviour of the pointer plane:

  P1  a large value is stored INTACT -- there is no truncation on the write
      path, so the payload is losslessly storable;
  P2  the ENUMERATION reads carry the WHOLE value with no size bound and no
      side-car handle => the consumer's context grows with the stored
      payload, and there is no way to NAME a large value without carrying it;
  P3  the SAME schema already contains a metadata-only projection -- the
      `streams` LIST query omits `events_json` -- so the pattern is known to
      this codebase;
  P4  the memory surface has NO pointer/handle projection of any kind.

The suite asserts the OBSERVED (defective) behaviour, so a REPAIR makes it
RED.  That is the point: the arms below are the REPAIRS, and each one must
turn the suite red.  A repair that leaves the suite green means the suite
was not measuring that plane at all -- the failure mode this matrix exists
to catch.

  M1  REAL REPAIR (the read surface): the enumeration query must PROJECT --
      omit the value column and return a handle/size instead.  MUST go RED.
  M2  REAL REPAIR (the schema): the memory table must carry a size/handle
      column, so a value can be NAMED.  MUST go RED.
  M3  REAL REPAIR (the consumer): the list handler must return a size
      alongside the key, so a caller can decide whether to fetch.  MUST go
      RED.
  N1  NEGATIVE CONTROL: a comment mentioning pointers changes nothing.
      Must SURVIVE.

WHY M1/M2/M3 ARE THE RIGHT MUTATIONS
-------------------------------------
Three DIFFERENT layers carry the absence, and they are repaired in three
different places:

  M1  `db.ts` -- the PROJECTION (the SELECT that carries the whole value).
  M2  `db.ts` -- the SCHEMA (no column that names a payload's size).
  M3  `rest_server.ts` -- the CONSUMER (the JSON shape handed to a caller).

Closing one does not close the others.  If the suite could not tell them
apart, one would survive, and the surviving arm would be the evidence that
the suite is measuring the right surface.

PORTABILITY (the defect class R514/R511/R513 cured in the sibling
repository):
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

if not os.path.isfile(os.path.join(HUB, "package.json")):
    sys.exit(
        "ABORT: cannot derive the hub tree above %s (no package.json) -- this "
        "driver must live inside a checkout of the repository it measures."
        % HERE
    )

DB_TS = os.path.join(HUB, "src", "db.ts")
REST_TS = os.path.join(HUB, "src", "rest_server.ts")
MEM_TS = os.path.join(HUB, "src", "memory.ts")
SUITE = "test/r530_pointer_plane.test.ts"

OWNED_FILES = [
    ("hub/src/db.ts", DB_TS),
    ("hub/src/rest_server.ts", REST_TS),
    ("hub/src/memory.ts", MEM_TS),
]


def expected_total() -> int:
    """DERIVE the arm count from the suite file itself."""
    src = open(os.path.join(HUB, SUITE), encoding="utf-8").read()
    n = len(re.findall(r"^\s+it\(", src, re.M))
    if n == 0:
        sys.exit("ABORT: could not derive the arm count from %s" % SUITE)
    return n


VITEST = os.path.join(HUB, "node_modules", ".bin", "vitest")
if not os.path.exists(VITEST):
    sys.exit(
        "ABORT: %s does not exist -- the tree this driver stands in has no "
        "vitest, so it cannot measure anything. Run `npm ci` there first."
        % VITEST
    )

SNAPSHOT_DIR = os.path.join(HERE, ".r530_snapshot")


def restore_from_leftover_snapshot():
    if not os.path.isdir(SNAPSHOT_DIR):
        return
    restored = []
    for rel, _ in OWNED_FILES:
        snap = os.path.join(SNAPSHOT_DIR, rel.replace("/", "__"))
        target = os.path.join(REPO, rel)
        if os.path.isfile(snap) and os.path.isfile(target):
            with open(snap, "rb") as f:
                data = f.read()
            with open(target, "wb") as f:
                f.write(data)
            restored.append(rel)
    if restored:
        print("RECOVERED from a leftover snapshot (a previous run was killed):")
        for rel in restored:
            print("  restored %s" % rel)
    for name in os.listdir(SNAPSHOT_DIR):
        os.remove(os.path.join(SNAPSHOT_DIR, name))
    os.rmdir(SNAPSHOT_DIR)


def write_snapshot(originals):
    os.makedirs(SNAPSHOT_DIR, exist_ok=True)
    for rel, _ in OWNED_FILES:
        snap = os.path.join(SNAPSHOT_DIR, rel.replace("/", "__"))
        with open(snap, "w", encoding="utf-8") as f:
            f.write(originals[rel])


def drop_snapshot():
    if os.path.isdir(SNAPSHOT_DIR):
        for name in os.listdir(SNAPSHOT_DIR):
            os.remove(os.path.join(SNAPSHOT_DIR, name))
        os.rmdir(SNAPSHOT_DIR)


def md5(p):
    with open(p, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def run_tests():
    """Run the suite.  Returns (failed, passed, errored, assertion_failed,
    compile_err, ran, out).

    `errored` means "the SUITE ITSELF broke" (a module failed to load, a
    beforeEach threw) -- that is a HARNESS verdict.  A TypeError raised INSIDE
    an assertion is NOT harness breakage: it is the assertion failing, and it
    still KILLS the mutant.  Conflating the two made the first matrix run
    report a real kill as HARNESS (R461-M2 / R517-6, applied to the
    classifier rather than to the suite).
    """
    r = subprocess.run(
        [VITEST, "run", SUITE, "--reporter=basic", "--no-coverage"],
        cwd=HUB, capture_output=True, text=True, timeout=900)
    out = r.stdout + r.stderr
    m = re.search(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed", out)
    failed = int(m.group(1)) if (m and m.group(1)) else 0
    passed = int(m.group(2)) if m else 0
    # The suite broke: it failed to LOAD, or a hook threw.  Both mean the
    # mutant broke the harness rather than being detected.
    suite_broken = ("Failed to load" in out) or bool(
        re.search(r"Failed Suites \d+", out))
    # An unhandled error inside a test body is a real detection, not a
    # harness break -- UNLESS the suite did not collect at all.
    errored = bool(re.search(
        r"ReferenceError:|SqliteError:|SQLITE_ERROR|is not defined|"
        r"\[vitest-worker\]", out))
    compile_err = "error TS" in out
    assertion_failed = "AssertionError" in out
    ran = m is not None and (passed + failed) == expected_total()
    return failed, passed, errored, assertion_failed, compile_err, suite_broken, ran, out


# ── the mutations ───────────────────────────────────────────────────────────
# The needles are DERIVED from the source file, not transcribed by hand.

# M1: the enumeration query PROJECT -- omit the value column and return a
# handle instead.  This is the real repair of the "carrying" half: the read
# stops embedding the payload.
M1_ANCHOR = """      SELECT key, value, tags, ttl, expire_at, updated_at, updated_by
      FROM memory
      ORDER BY updated_at DESC, key ASC"""

M1_REPLACEMENT = """      SELECT key, length(value) AS value_size, tags, ttl, expire_at, updated_at, updated_by
      FROM memory
      ORDER BY updated_at DESC, key ASC"""

# M2: the SCHEMA carries a column that names a payload's size, so a value can
# be NAMED rather than only carried.
M2_ANCHOR = """      CREATE TABLE IF NOT EXISTS memory (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,"""

M2_REPLACEMENT = """      CREATE TABLE IF NOT EXISTS memory (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        value_size INTEGER DEFAULT 0,"""

# M3: the CONSUMER returns a size alongside the key, so a caller can decide
# whether to fetch the payload at all.  The field name must be one the probe
# actually checks -- a repair that invents a field nobody reads is not a
# repair (R405-F2 / R406's dead-term shape).
M3_ANCHOR = """      memory: allMemory.map(m => ({
        key: m.key,
        value: m.value,"""

M3_REPLACEMENT = """      memory: allMemory.map(m => ({
        key: m.key,
        size: m.value.length,
        value: m.value,"""

# N1: the NEGATIVE CONTROL -- a comment that mentions pointers changes
# nothing.  Must SURVIVE.
N1_ANCHOR = """  async getAll(scope: string = 'all'): Promise<DBMemory[]> {"""

N1_REPLACEMENT = """  // NOTE: a pointer to the stored value would let a caller name it without carrying it.
  async getAll(scope: string = 'all'): Promise<DBMemory[]> {"""


MUTATIONS = [
    ("M1", "REAL REPAIR (projection): the enumeration query omits the value column", DB_TS, M1_ANCHOR, M1_REPLACEMENT),
    ("M2", "REAL REPAIR (schema): the memory table carries a value_size column", DB_TS, M2_ANCHOR, M2_REPLACEMENT),
    ("M3", "REAL REPAIR (consumer): the list handler returns a size", REST_TS, M3_ANCHOR, M3_REPLACEMENT),
    ("N1", "NEGATIVE CONTROL: a comment mentioning pointers", MEM_TS, N1_ANCHOR, N1_REPLACEMENT),
]


def main():
    restore_from_leftover_snapshot()

    originals = {}
    for rel, path in OWNED_FILES:
        if not os.path.isfile(path):
            sys.exit("ABORT: %s does not exist" % path)
        originals[rel] = open(path, encoding="utf-8").read()

    dirty = [rel for rel, path in OWNED_FILES
             if md5(path) != md5_of_head(rel)]
    if dirty:
        sys.exit(
            "ABORT: refusing to run on a dirty owned file: %s\n"
            "  The driver would mutate a tree that is not HEAD, and the verdict\n"
            "  would be about the wrong tree. Commit or stash first." % ", ".join(dirty)
        )

    total = expected_total()
    print("suite: %s  (derived arm count: %d)" % (SUITE, total))
    print("runner: %s" % VITEST)
    print()

    # The CONTROL: the pristine tree must be GREEN, and it must actually run
    # the derived number of arms (R428: "Tests 0 passed" is not a green).
    failed, passed, errored, assert_failed, compile_err, suite_broken, ran, out = run_tests()
    print("CONTROL (pristine tree): failed=%d passed=%d ran=%s" % (failed, passed, ran))
    if not ran:
        print("  CONTROL DID NOT RUN THE SUITE -- this is a HARNESS verdict, not a result.")
        print(out[-4000:])
        return 2
    if failed or errored or compile_err or suite_broken:
        print("  CONTROL IS NOT GREEN -- aborting: a red baseline makes every")
        print("  mutant verdict meaningless.")
        print(out[-4000:])
        return 2
    print("  control is GREEN (%d/%d) -- the suite is loadable and passing" % (passed, total))
    print()

    write_snapshot(originals)
    results = []
    try:
        for name, desc, path, anchor, replacement in MUTATIONS:
            rel = next(r for r, p in OWNED_FILES if p == path)
            before_md5 = md5(path)
            src = originals[rel]
            if anchor not in src:
                print("%-3s NOT-INJECTED (anchor not found in %s)" % (name, rel))
                results.append((name, desc, "NOT-INJECTED", 0, 0))
                continue
            mutated = src.replace(anchor, replacement, 1)
            if mutated == src:
                print("%-3s NOT-INJECTED (replacement was inert)" % name)
                results.append((name, desc, "NOT-INJECTED", 0, 0))
                continue
            with open(path, "w", encoding="utf-8") as f:
                f.write(mutated)
            if md5(path) == before_md5:
                print("%-3s NOT-INJECTED (file md5 unchanged)" % name)
                results.append((name, desc, "NOT-INJECTED", 0, 0))
                with open(path, "w", encoding="utf-8") as f:
                    f.write(originals[rel])
                continue

            failed, passed, errored, assert_failed, compile_err, suite_broken, ran, out = run_tests()
            with open(path, "w", encoding="utf-8") as f:
                f.write(originals[rel])

            if not ran or suite_broken or compile_err:
                verdict = "HARNESS"
            elif failed:
                # A failed test IS a detection, whether it failed with an
                # AssertionError or with an exception raised inside the
                # assertion.  Both mean the probe SAW the repair.
                verdict = "KILLED"
            else:
                verdict = "SURVIVED"
            detail = "failed=%d passed=%d" % (failed, passed)
            print("%-3s %-9s %s  [%s]" % (name, verdict, desc, detail))
            results.append((name, desc, verdict, failed, passed))
    finally:
        # Restore every owned file from the in-memory originals, and verify.
        for rel, path in OWNED_FILES:
            with open(path, "w", encoding="utf-8") as f:
                f.write(originals[rel])
        drop_snapshot()

    print()
    ok = True
    for rel, path in OWNED_FILES:
        if md5(path) != originals[rel] and md5(path) != md5_of_head(rel):
            print("RESTORE FAILED for %s" % rel)
            ok = False
    killed = sum(1 for r in results if r[2] == "KILLED")
    survived = sum(1 for r in results if r[2] == "SURVIVED")
    harness = sum(1 for r in results if r[2] == "HARNESS")
    notinj = sum(1 for r in results if r[2] == "NOT-INJECTED")
    print("KILLED=%d SURVIVED=%d HARNESS=%d NOT-INJECTED=%d" % (killed, survived, harness, notinj))
    print("restore verified: %s" % ("OK" if ok else "FAILED"))
    return 0 if ok else 2


def md5_of_head(rel):
    out = subprocess.run(["git", "-C", REPO, "show", "HEAD:" + rel],
                         capture_output=True).stdout
    return hashlib.md5(out).hexdigest()


if __name__ == "__main__":
    sys.exit(main())
