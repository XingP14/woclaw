#!/usr/bin/env python3
"""
R538 mutation matrix -- the LOWER BOUND plane must be killable.

CONTROL FIRST, then mutations.  Every mutation must be VERIFIED INJECTED
(the file's md5 must change) -- an inert mutation is NOT-INJECTED, never
SURVIVED (R456-10c / R507).

A CRASH IS NOT A KILL (R461-M2 / R517-6).  A mutation that makes the suite
throw is HARNESS, not a kill: the suite went red because the HARNESS broke,
not because the probe detected the defect.

WHAT THIS MATRIX MEASURES
-------------------------
The subject is `hub/test/r538_negative_bound_plane.test.ts`, which pins the
OBSERVED (defective) behaviour of a numeric parameter that PARSES but is
NEGATIVE:

  F1  the carriers DISAGREE on the same `?limit=-1`:
        /memory/search  -> 39 rows  (JS slice: slice(0,-1) drops ONE)
        /memory/recall  -> 39 rows  (the same slice carrier)
        /streams/:topic -> 40 rows  (SQLite: negative LIMIT = NO LIMIT)
        /graph/traverse ->  0 nodes  (guard: results.length < limit is false)
      all four answer HTTP 200.
  F1c the magnitude is NOT monotonic on the slice carrier (-9999 -> 0 rows)
       and is IGNORED on the SQLite carrier (-1 and -9999 both -> 40).
  F2  the negative class is the OPPOSITE of R532's NaN class.
  F3  the unbounded stream listing is reachable with NO credential.
  F4  ONE data-layer carrier has a lower bound the others lack.
  F5  the clamp lives in exactly two storage call sites, and the REST
      extraction layer has none.

The suite asserts the OBSERVED (defective) behaviour, so a REPAIR makes it
RED.  That is the point: the arms below are the REPAIRS, and each one must
turn the suite red.  A repair that leaves the suite green means the suite
was not measuring that plane at all -- the failure mode this matrix exists
to catch.

  M1  REAL REPAIR (the extraction helper): `parseIntParam` must establish a
      LOWER BOUND (reject/normalize a negative value) instead of passing it
      through.  MUST go RED.
  M2  REAL REPAIR (the slice carrier): the search route's cap must have a
      lower bound, so a negative limit cannot invert into "almost
      everything".  MUST go RED.
  M3  REAL REPAIR (the SQLite carrier): the stream route's cap must have a
      lower bound, so a negative limit cannot become "no upper bound".
      MUST go RED.
  M4  REAL REPAIR (the comparison-guard carrier): the traverse guard must
      have a lower bound, so a negative limit cannot make the loop condition
      vacuously false.  MUST go RED.
  M5  REAL REPAIR (the CLAMP's constancy): the storage clamp must be
      generalised so it is no longer exactly two call sites -- i.e. the
      "safety" of that one carrier becomes a property of the system.
      MUST go RED.
  N1  NEGATIVE CONTROL: a comment mentioning limits changes nothing.
      Must SURVIVE.

WHY M1..M5 ARE THE RIGHT MUTATIONS
-----------------------------------
The defect has FIVE independent carriers, each repaired in a different
place.  A single "make the helper stricter" edit could otherwise satisfy
several arms at once, so each arm must be independently killable:

  M1  `rest_server.ts` -- the EXTRACTION HELPER (parseIntParam).
  M2  `rest_server.ts` -- the SLICE CARRIER (search route's cap).
  M3  `rest_server.ts` -- the SQLITE CARRIER (stream route's cap).
  M4  `rest_server.ts` -- the COMPARISON-GUARD CARRIER (traverse route).
  M5  `db.ts`           -- the STORAGE CLAMP (the "safe by accident" arm).

PORTABILITY (the defect class R514/R511/R513 cured in the sibling
repository):
  * the tree it measures is DERIVED from this file's own location;
  * the runner is resolved from THAT tree's node_modules/.bin -- never
    `npx`, which resolves against the CWD and DOWNLOADS a different
    version when the network is up (R514's R498 family);
  * the snapshot is taken IN MEMORY **and** ON DISK (R533's recovery path);
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

REST_TS = os.path.join(HUB, "src", "rest_server.ts")
DB_TS = os.path.join(HUB, "src", "db.ts")
SUITE = "test/r538_negative_bound_plane.test.ts"

OWNED_FILES = [
    ("hub/src/rest_server.ts", REST_TS),
    ("hub/src/db.ts", DB_TS),
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

SNAPSHOT_DIR = os.path.join(HERE, ".r538_snapshot")


def restore_from_leftover_snapshot():
    """R533's recovery path: a previous run killed by a timeout leaves the
    on-disk snapshot as the ONLY pristine copy of the tracked source."""
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
    """Run the suite.  Returns a dict of the verdict signals.

    `suite_broken` means "the SUITE ITSELF broke" (a module failed to load,
    a hook threw) -- that is a HARNESS verdict.  A TypeError raised INSIDE
    an assertion is NOT harness breakage: it is the assertion failing, and
    it still KILLS the mutant.
    """
    r = subprocess.run(
        [VITEST, "run", SUITE, "--reporter=basic", "--no-coverage"],
        cwd=HUB, capture_output=True, text=True, timeout=900)
    out = r.stdout + r.stderr
    m = re.search(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed", out)
    failed = int(m.group(1)) if (m and m.group(1)) else 0
    passed = int(m.group(2)) if m else 0
    suite_broken = ("Failed to load" in out) or bool(
        re.search(r"Failed Suites \d+", out))
    errored = bool(re.search(
        r"ReferenceError:|SqliteError:|SQLITE_ERROR|is not defined|"
        r"\[vitest-worker\]", out))
    compile_err = "error TS" in out
    ran = m is not None and (passed + failed) == expected_total()
    return {
        "failed": failed, "passed": passed, "errored": errored,
        "compile_err": compile_err, "suite_broken": suite_broken,
        "ran": ran, "out": out,
    }


def classify(v):
    """Turn a run result into a verdict string.

    HARNESS beats KILL: if the suite itself failed to load, the red tells us
    nothing about the probe.  Otherwise a failure is a KILL.
    """
    if v["suite_broken"] or v["compile_err"] or not v["ran"]:
        return "HARNESS"
    if v["failed"] > 0:
        return "KILLED"
    return "SURVIVED"


# ---------------------------------------------------------------------------
# The mutations.  Each is (name, file, old, new, description).
# `old` MUST appear EXACTLY ONCE in the file -- the driver refuses to inject
# otherwise (R475-3: a non-unique needle means the mutation would edit the
# wrong copy, and a silent wrong-copy edit is not a mutation at all).
# ---------------------------------------------------------------------------
MUTATIONS = [
    (
        "M1",
        "hub/src/rest_server.ts",
        "  return parseInt(raw, 10);",
        "  return Math.max(0, parseInt(raw, 10) || 0);",
        "REPAIR (the extraction helper): parseIntParam must establish a "
        "LOWER BOUND instead of passing a negative value through.",
    ),
    (
        "M2",
        "hub/src/rest_server.ts",
        "const limit = Math.min(parseIntParam(url, 'limit', 10), 50);",
        "const limit = Math.max(0, Math.min(parseIntParam(url, 'limit', 10), 50));",
        "REPAIR (the slice carrier): the search route's cap must have a "
        "lower bound, so a negative limit cannot invert into 'almost "
        "everything'.",
    ),
    (
        "M3",
        "hub/src/rest_server.ts",
        "const limit = Math.min(parseIntParam(url, 'limit', 20), 100);",
        "const limit = Math.max(0, Math.min(parseIntParam(url, 'limit', 20), 100));",
        "REPAIR (the SQLite carrier): the stream route's cap must have a "
        "lower bound, so a negative limit cannot become 'no upper bound'.",
    ),
    (
        "M4",
        "hub/src/rest_server.ts",
        "const limit = parseIntParam(url, 'limit', 50);",
        "const limit = Math.abs(parseIntParam(url, 'limit', 50));",
        "REPAIR (the comparison-guard carrier): the traverse guard must "
        "normalise a negative limit, so it cannot make the loop condition "
        "vacuously false and return NOTHING.",
    ),
    (
        "M5",
        "hub/src/db.ts",
        "  async getMessages(topic: string, limit: number = 100, before?: number): Promise<DBMessage[]> {\n"
        "    const safeLimit = Math.max(0, limit);\n"
        "    let rows: MessageRowMysql[];",
        "  async getMessages(topic: string, limit: number = 100, before?: number): Promise<DBMessage[]> {\n"
        "    const safeLimit = Math.max(0, Math.abs(limit));\n"
        "    let rows: MessageRowMysql[];",
        "REPAIR (the clamp's constancy): the storage clamp's behaviour "
        "changes at one of its two sites, so the 'safe by accident' carrier "
        "is no longer the lower bound the suite pins -- and the count of "
        "clamp sites drops from two to one.",
    ),
    (
        "N1",
        "hub/src/rest_server.ts",
        "  return parseInt(raw, 10);",
        "  return parseInt(raw, 10); // limit limit limit",
        "NEGATIVE CONTROL: a comment mentioning limits changes nothing.",
    ),
]


def main():
    restore_from_leftover_snapshot()

    # Refuse to run on a dirty owned file (R475-2: an in-flight edit by
    # another agent would be silently destroyed by the restore).
    for rel, path in OWNED_FILES:
        if not os.path.isfile(path):
            sys.exit("ABORT: %s does not exist" % rel)
        r = subprocess.run(["git", "status", "--short", "--", rel],
                           cwd=REPO, capture_output=True, text=True)
        if r.stdout.strip():
            sys.exit(
                "ABORT: %s is dirty (%s) -- the restore would destroy an "
                "uncommitted change. Commit or stash it first."
                % (rel, r.stdout.strip())
            )

    originals = {}
    for rel, path in OWNED_FILES:
        with open(path, "r", encoding="utf-8") as f:
            originals[rel] = f.read()

    baselines = {rel: md5(path) for rel, path in OWNED_FILES}
    write_snapshot(originals)

    results = []
    try:
        # ---- CONTROL ----
        ctrl = run_tests()
        verdict = classify(ctrl)
        print("CONTROL: %s  (%d passed / %d failed)" %
              (verdict, ctrl["passed"], ctrl["failed"]))
        if verdict != "SURVIVED":
            print(ctrl["out"][-4000:])
            sys.exit("ABORT: the control is not green -- fix the suite "
                     "before running the matrix.")
        results.append(("CONTROL", "SURVIVED", 0, 0))

        for name, target_rel, old, new, desc in MUTATIONS:
            path = dict((rel, p) for rel, p in OWNED_FILES)[target_rel]
            src = originals[target_rel]
            n = src.count(old)
            if n != 1:
                print("%-4s NOT-INJECTED: needle occurs %d times in %s"
                      % (name, n, target_rel))
                results.append((name, "NOT-INJECTED", 0, n))
                continue
            with open(path, "w", encoding="utf-8") as f:
                f.write(src.replace(old, new))
            # The injection must actually change the file (R456-10c).
            if md5(path) == baselines[target_rel]:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(src)
                print("%-4s NOT-INJECTED: the file's md5 did not change" % name)
                results.append((name, "NOT-INJECTED", 0, 1))
                continue
            v = run_tests()
            verdict = classify(v)
            print("%-4s %-12s (%d passed / %d failed)  %s"
                  % (name, verdict, v["passed"], v["failed"], desc))
            if verdict == "HARNESS":
                print(v["out"][-2500:])
            results.append((name, verdict, v["passed"], v["failed"]))
            # Restore IMMEDIATELY, before the next mutation (R475-2).
            with open(path, "w", encoding="utf-8") as f:
                f.write(originals[target_rel])
            if md5(path) != baselines[target_rel]:
                sys.exit("ABORT: restore of %s did not reproduce the baseline "
                         "md5 -- the tree is not what we started with."
                         % target_rel)
    finally:
        for rel, path in OWNED_FILES:
            with open(path, "w", encoding="utf-8") as f:
                f.write(originals[rel])
        drop_snapshot()

    # ---- SUMMARY ----
    print()
    killed = [r[0] for r in results if r[1] == "KILLED"]
    # The NEGATIVE CONTROL is EXPECTED to survive: it is the control, not a
    # survivor (R475-7 / R482-10: a negative control that gets killed means
    # the probe is red on a no-op, i.e. it measures nothing).
    negative = [r[0] for r in results if r[1] == "SURVIVED" and r[0].startswith("N")]
    survived = [r[0] for r in results
                if r[1] == "SURVIVED" and r[0] != "CONTROL" and not r[0].startswith("N")]
    harness = [r[0] for r in results if r[1] == "HARNESS"]
    notinj = [r[0] for r in results if r[1] == "NOT-INJECTED"]
    print("KILLED=%d SURVIVED=%d HARNESS=%d NOT-INJECTED=%d"
          % (len(killed), len(survived), len(harness), len(notinj)))
    print("killed:   %s" % ", ".join(killed))
    print("survived: %s" % (", ".join(survived) or "(none)"))
    print("negative control survived: %s" % (", ".join(negative) or "(none)"))
    print("harness:  %s" % (", ".join(harness) or "(none)"))
    print("not-inj:  %s" % (", ".join(notinj) or "(none)"))
    ok = (not survived and not harness and not notinj and len(negative) == 1)
    print("VERDICT: %s" % ("PASS" if ok else "FAIL"))
    for rel, path in OWNED_FILES:
        assert md5(path) == baselines[rel], "baseline md5 drift on %s" % rel
    print("restore verified OK (all owned files back at their baseline md5)")


if __name__ == "__main__":
    main()
