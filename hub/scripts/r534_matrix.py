#!/usr/bin/env python3
"""
R534 mutation matrix -- the "semantic" edge must be killable.

CONTROL FIRST, then mutations.  Every mutation must be VERIFIED INJECTED
(the file's md5 must change) -- an inert mutation is NOT-INJECTED, never
SURVIVED (R456-10c / R507).

A CRASH IS NOT A KILL (R461-M2 / R517-6).  A mutation that makes the suite
throw is HARNESS, not a kill: the suite went red because the HARNESS broke,
not because the probe detected the defect.

WHAT THIS MATRIX MEASURES
-------------------------
The subject is `hub/test/r534_semantic_edge_compares_key.test.ts`, which pins
the OBSERVED (defective) behaviour of the identifier/content plane:

  F1  a `semantic` edge appears between two memories whose CONTENTS are
      unrelated, because their KEYS share a token set;
  F2  two memories with IDENTICAL contents get NO semantic edge, because
      their keys share no token;
  F3  every semantic edge carries the THRESHOLD as its weight -- the computed
      score is discarded;
  F4  the "already linked" check is directional, so the same pair accumulates
      RECIPROCAL semantic edges;
  F5  N extraction-shaped fact keys form a COMPLETE graph;
  F6  the write path creates O(N^2) semantic edges;
  F7  the wrong edge is reachable through the PUBLIC graph query surface;
  F8  the VALUE is present on the node the whole time.

The suite asserts the OBSERVED (defective) behaviour, so a REPAIR makes it
RED.  That is the point: the arms below are the REPAIRS, and each one must
turn the suite red.  A repair that leaves the suite green means the suite
was not measuring that plane at all -- the failure mode this matrix exists
to catch.

  M1  REAL REPAIR (the comparison field): similarity must be computed over
      the VALUE, not over the KEY label.  MUST go RED.
  M2  REAL REPAIR (the score): the edge weight must carry the computed
      SCORE, not the threshold constant.  MUST go RED.
  M3  REAL REPAIR (the already-linked check): the check must be SYMMETRIC,
      so a pair cannot accumulate reciprocal edges.  MUST go RED.
  M4  REAL REPAIR (the cost): the similarity scan must be bounded, so the
      write path stops producing a complete graph.  MUST go RED.
  N1  NEGATIVE CONTROL: a comment mentioning values changes nothing.
      Must SURVIVE.

WHY M1/M2/M3/M4 ARE THE RIGHT MUTATIONS
---------------------------------------
The defect has FOUR independent carriers, each repaired in a different place:

  M1  `graph/store.ts` -- the COMPARISON FIELD (label vs metadata.value).
  M2  `memory.ts`      -- the EDGE WEIGHT (threshold constant vs score).
  M3  `graph/store.ts` -- the LINKED CHECK (source-only vs symmetric).
  M4  `graph/store.ts` -- the SCAN (all nodes vs bounded candidates).

Closing one does not close the others.  If the suite could not tell them
apart, one would survive, and the surviving arm would be the evidence that
the suite is measuring the right surface.

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

GRAPH_TS = os.path.join(HUB, "src", "graph", "store.ts")
MEM_TS = os.path.join(HUB, "src", "memory.ts")
SUITE = "test/r534_semantic_edge_compares_key.test.ts"

OWNED_FILES = [
    ("hub/src/graph/store.ts", GRAPH_TS),
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

SNAPSHOT_DIR = os.path.join(HERE, ".r534_snapshot")


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
    """Run the suite.  Returns (failed, passed, errored, assertion_failed,
    compile_err, suite_broken, ran, out).

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

# M1: the COMPARISON FIELD.  The real repair of F1/F2: similarity must be
# computed over the memory's VALUE (node.metadata.value), not over its KEY
# label.  Both endpoints must use the value.
M1_ANCHOR = """        const score = this.computeTextSimilarity(memory.label, other.label);"""

M1_REPLACEMENT = """        const score = this.computeTextSimilarity(
          String(memory.metadata?.value ?? ''),
          String(other.metadata?.value ?? ''),
        );"""

# M2: the EDGE WEIGHT.  The real repair of F3: the edge must carry the
# computed SCORE, not the threshold constant.  `memory.ts` already has its own
# module-level `computeTextSimilarity` (memory.ts:20), so the honest minimal
# shape of this repair is single-file: compare the two VALUES and put the
# resulting score on the edge.
M2_ANCHOR = """      const similar = this.graphStore.findSimilarMemories(memNode.id, 0.5);
      for (const sim of similar) {
        try {
          this.graphStore.addEdge({
            source: memNode.id,
            target: sim.id,
            type: 'semantic',
            weight: 0.5,
            metadata: { auto: true, via: 'memory-write' },
          });
        } catch { /* edge may already exist */ }
      }"""

M2_REPLACEMENT = """      const similar = this.graphStore.findSimilarMemories(memNode.id, 0.5);
      for (const sim of similar) {
        try {
          const valA = String(memNode.metadata?.value ?? '');
          const valB = String(sim.metadata?.value ?? '');
          const ta = new Set(valA.toLowerCase().split(/[\\s\\W_]+/).filter((w) => w.length > 2));
          const tb = new Set(valB.toLowerCase().split(/[\\s\\W_]+/).filter((w) => w.length > 2));
          let inter = 0;
          for (const t of ta) if (tb.has(t)) inter++;
          const union = ta.size + tb.size - inter;
          const score = union === 0 ? 0 : inter / union;
          this.graphStore.addEdge({
            source: memNode.id,
            target: sim.id,
            type: 'semantic',
            weight: score,
            metadata: { auto: true, via: 'memory-write' },
          });
        } catch { /* edge may already exist */ }
      }"""

# M3: the ALREADY-LINKED CHECK.  The real repair of F4: before creating the
# semantic edge, check BOTH directions -- a pair that is already linked must
# not accumulate a second, reciprocal edge.
M3_ANCHOR = """      const similar = this.graphStore.findSimilarMemories(memNode.id, 0.5);
      for (const sim of similar) {
        try {"""

M3_REPLACEMENT = """      const similar = this.graphStore.findSimilarMemories(memNode.id, 0.5);
      for (const sim of similar) {
        try {
          const alreadyLinked = [
            ...this.graphStore.getEdges({ source: memNode.id, target: sim.id, type: 'semantic' }),
            ...this.graphStore.getEdges({ source: sim.id, target: memNode.id, type: 'semantic' }),
          ];
          if (alreadyLinked.length > 0) continue;"""

# M4: the SCAN.  The real repair of F5/F6: the similarity scan must be
# BOUNDED (the canonical's blocking phase), so the write path stops
# producing a complete graph.
M4_ANCHOR = """    const memories = this.getNodes('memory').filter(m => m.id !== memoryId);"""

M4_REPLACEMENT = """    const memories = this.getNodes('memory')
      .filter(m => m.id !== memoryId)
      .slice(0, 4);"""

# N1: the NEGATIVE CONTROL -- a comment that mentions values changes
# nothing.  Must SURVIVE.
N1_ANCHOR = """  findSimilarMemories(memoryId: string, threshold: number = 0.7): GraphNode[] {"""

N1_REPLACEMENT = """  // NOTE: similarity should arguably compare the stored value, not the label.
  findSimilarMemories(memoryId: string, threshold: number = 0.7): GraphNode[] {"""


MUTATIONS = [
    ("M1", "REAL REPAIR (comparison field): similarity over metadata.value, not over the label", GRAPH_TS, M1_ANCHOR, M1_REPLACEMENT),
    ("M2", "REAL REPAIR (score): the edge weight carries the computed value-similarity, not the threshold", MEM_TS, M2_ANCHOR, M2_REPLACEMENT),
    ("M3", "REAL REPAIR (linked check): the already-linked check is made symmetric", MEM_TS, M3_ANCHOR, M3_REPLACEMENT),
    ("M4", "REAL REPAIR (bounded scan): the similarity scan is bounded to 4 candidates", GRAPH_TS, M4_ANCHOR, M4_REPLACEMENT),
    ("N1", "NEGATIVE CONTROL: a comment mentioning values", GRAPH_TS, N1_ANCHOR, N1_REPLACEMENT),
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
