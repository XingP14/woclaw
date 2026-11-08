#!/usr/bin/env python3
"""
R536 mutation matrix -- the CURSOR PLANE must be killable.

CONTROL FIRST, then mutations.  Every mutation must be VERIFIED INJECTED
(the file's md5 must change) -- an inert mutation is NOT-INJECTED, never
SURVIVED (R456-10c / R507).

A CRASH IS NOT A KILL (R461-M2 / R517-6).  A mutation that makes the suite
throw is HARNESS, not a kill: the suite went red because the HARNESS broke,
not because the probe detected the defect.

WHAT THIS MATRIX MEASURES
-------------------------
The subject is `hub/test/r536_cursor_plane.test.ts`, which pins the OBSERVED
(defective) behaviour of the cursor plane:

  F1  the topic string has THREE derivations that disagree:
      POST /streams/<t>   -> stored topic = path.slice(8)  = "/<t>"
      GET  /streams/<t>   -> queried topic = path.slice(8) = "/<t>"
      GET  /streams/<t>/<run> -> matched topic = regex group 1 = "<t>"
      => a REST stream is listed but unfetchable; a WS stream is fetchable
         but unlistable.
  F2  the cursor is a POSITION IN A REPLACEABLE ARRAY (one events_json blob
      per run_id, written INSERT OR REPLACE), not an event identity.
  F3  the replacement need not extend the prefix; a shorter replacement
      silently loses the earlier events.
  F4  the cursor is not validated: NaN and negative values are accepted.
  F5  next_cursor is not the position of the next unread event.
  F6  the reply omits the documented since_cursor.
  F7  the documented URL shape does not resolve a slash-bearing topic.

The suite asserts the OBSERVED (defective) behaviour, so a REPAIR makes it
RED.  That is the point: the arms below are the REPAIRS, and each one must
turn the suite red.  A repair that leaves the suite green means the suite
was not measuring that plane at all -- the failure mode this matrix exists
to catch.

  M1  REAL REPAIR (the topic derivation): the single-stream route must
      derive the topic the SAME way the POST and LIST routes do.  MUST
      go RED.
  M2  REAL REPAIR (the journal write): saveStream must APPEND, not
      REPLACE, so a second publish under the same run_id extends the log
      instead of swapping it.  MUST go RED.
  M3  REAL REPAIR (the cursor validation): the route must reject a
      non-numeric / negative / out-of-range cursor instead of passing it
      to Array.prototype.slice.  MUST go RED.
  M4  REAL REPAIR (next_cursor): next_cursor must be the position of the
      next unread event (and must not echo an out-of-range request back).
      MUST go RED.
  M5  REAL REPAIR (the response shape): the reply must carry the
      documented since_cursor.  MUST go RED.
  M6  REAL REPAIR (the URL shape): the single-stream route must resolve a
      slash-bearing topic (the spec's own example "agent/x/run-y").  MUST
      go RED.
  N1  NEGATIVE CONTROL: a comment mentioning cursors changes nothing.
      Must SURVIVE.

WHY M1..M6 ARE THE RIGHT MUTATIONS
-----------------------------------
The defect has SIX independent carriers, each repaired in a different place:

  M1  `rest_server.ts` -- the TOPIC DERIVATION (regex group vs slice).
  M2  `db.ts`           -- the JOURNAL WRITE (REPLACE vs APPEND).
  M3  `rest_server.ts` -- the CURSOR VALIDATION (parseInt vs a guard).
  M4  `rest_server.ts` -- the next_cursor ARITHMETIC.
  M5  `rest_server.ts` -- the RESPONSE SHAPE.
  M6  `rest_server.ts` -- the URL SHAPE (regex vs a greedy topic match).

M1/M3/M4/M5/M6 all live in `rest_server.ts` but in DIFFERENT statements.
Closing one does not close the others.  If the suite could not tell them
apart, one would survive, and the surviving arm is the evidence that the
suite is measuring the right surface -- M1 and M3/M4/M5/M6 in particular
must be independently killable, because a single "the route is stricter"
edit could otherwise satisfy several arms at once.

PORTABILITY (the defect class R514/R511/R513 cured in the sibling
repository):
  * the tree it measures is DERIVED from this file's own location;
  * the runner is resolved from THAT tree's node_modules/.bin -- never
    `npx`, which resolves against the CWD and DOWNLOADS a different
    version when the network is up (R514's R498 family);
  * the snapshot is taken IN MEMORY **and** ON DISK (R533's recovery path:
    a run killed by a timeout leaves mutated tracked source behind, and
    the on-disk snapshot is the only pristine copy);
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
SUITE = "test/r536_cursor_plane.test.ts"

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

SNAPSHOT_DIR = os.path.join(HERE, ".r536_snapshot")


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
    it still KILLS the mutant.  Conflating the two made the first matrix
    run report a real kill as HARNESS (R461-M2 / R517-6, applied to the
    classifier rather than to the suite).
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
        "const topic = decodeURIComponent(streamMatch[1]);",
        "const topic = decodeURIComponent('/' + streamMatch[1]);",
        "REPAIR: derive the single-stream topic the SAME way POST/LIST do "
        "(path.slice(8) keeps the leading slash).",
    ),
    (
        "M2",
        "hub/src/db.ts",
        "INSERT OR REPLACE INTO streams (run_id, topic, agent_id, schema_version, started_at, events_json, exit_code, created_at)",
        "INSERT INTO streams (run_id, topic, agent_id, schema_version, started_at, events_json, exit_code, created_at)",
        "REPAIR: the journal must APPEND, not REPLACE -- a second publish "
        "under the same run_id must extend the log, not swap it.",
    ),
    (
        "M3",
        "hub/src/rest_server.ts",
        "const sinceCursor = parseIntParam(url, 'since_cursor', 0);",
        "const sinceCursor = Math.max(0, parseIntParam(url, 'since_cursor', 0) || 0);",
        "REPAIR: validate the cursor -- reject/normalize a non-numeric or "
        "negative position instead of handing NaN / a negative to slice().",
    ),
    (
        "M4",
        "hub/src/rest_server.ts",
        "next_cursor: sinceCursor + events.length,",
        "next_cursor: sinceCursor + events.length + 1,",
        "REPAIR: next_cursor must be the position of the next unread event "
        "(and must not echo an out-of-range request back unchanged).",
    ),
    (
        "M5",
        "hub/src/rest_server.ts",
        "next_cursor: sinceCursor + events.length,",
        "since_cursor: sinceCursor,\n              next_cursor: sinceCursor + events.length,",
        "REPAIR: the reply must carry the documented since_cursor.",
    ),
    (
        "M6",
        "hub/src/rest_server.ts",
        "const streamMatch = path.match(/^\\/streams\\/([^/]+)\\/(.+)$/);",
        "const streamMatch = path.match(/^\\/streams\\/(.+)\\/([^/]+)$/);",
        "REPAIR: the single-stream route must resolve a slash-bearing topic "
        "(the spec's own example 'agent/x/run-y').",
    ),
    (
        "N1",
        "hub/src/rest_server.ts",
        "const sinceCursor = parseIntParam(url, 'since_cursor', 0);",
        "const sinceCursor = parseIntParam(url, 'since_cursor', 0); // cursor cursor cursor",
        "NEGATIVE CONTROL: a comment mentioning cursors changes nothing.",
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
