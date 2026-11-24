#!/usr/bin/env python3
"""
R556 mutation matrix — the ROSTER plane (the census's output).

House rules (from R553/R554/R555 methodology addenda):

  1. CONTROL FIRST — run the unmutated suite, require it GREEN, before any
     mutation is applied.  A matrix on a red baseline proves nothing.
  2. BYTE-LEVEL RESTORE — every mutated file is restored from its git blob
     and the md5 is verified.  A dirty tree is a REFUSAL, not a verdict.
  3. PER-VARIANT EXPECTED VERDICT — carried in this table, not derived from
     "some arm went red".  A non-repair that the suite reports as a kill is
     worse than no matrix (R554-P3).
  4. CRASH SIGNATURE == HARNESS, NEVER KILL (R553-12).  A mutant that throws
     is not evidence the suite measures the defect.
  5. KILL EVERY REPAIR SHAPE (R554-P4).  Two plausible repairs here: filter
     the roster to the caller's memberships, vs refuse private topics
     entirely on the WS roster.  Both must be killed.
  6. REPORT THE EXACT RED-ARM NAMES, not a count (R553-11).
  7. READ EVERY FILE BEFORE WRITING ANY FILE (R555-P6).  `open(p,'w')`
     truncates AT OPEN — the naive shape reads the truncated file and
     leaves a 0-byte source in the tree.  The restore list is declared
     BEFORE the try, so a raising mutation is still restored.

Variants
--------
M1  REAL REPAIR (shape A): the roster handlers take the caller's agentId and
    filter the roster to topics the caller is a member of.
M2  REAL REPAIR (shape B): the roster handlers refuse private topics
    outright (a topic with isPrivate is never listed).
M3  NEGATIVE CONTROL: lazy comment only — no behaviour change.
M4  NEGATIVE CONTROL: "recognises but refuses" — the roster learns the
    caller's identity but STILL returns everything (the R555-P4 shape).
M5  PARTIAL REPAIR (DISCRIMINATOR): ONLY the `topic_members` identity leak
    is fixed. The `topics_list` count leak and the `welcome` name leak both
    remain. The suite must kill it (the identity leak IS fixed) AND its
    red-arm set must be EXACTLY {F2c}.
M6  PARTIAL REPAIR (DISCRIMINATOR, the mirror): ONLY the WELCOME frame's
    name leak is fixed. The whole roster still leaks. Red-arm set must be
    EXACTLY {F2e}.

Expected verdicts
-----------------
M1  KILLED   (a real repair must flip the DEFECT-PIN arms)
M2  KILLED   (the other real repair shape — different shape, must also die)
M3  SURVIVED (lazy comment: nothing behavioural changed)
M4  SURVIVED (recognise-but-refuse: reads the identity, does not use it)
M5  KILLED   (partial repair: the identity leak is real and is fixed)
M6  KILLED   (partial repair, mirror: the welcome leak is real and is fixed)

RED-ARM EXPECTATIONS (R553-11: report exact arm names, not a count)
-------------------------------------------------------------------
M1  {F2b, F2c, F2d}   — the whole roster plane is repaired
M2  {F2b, F2c, F2d}   — the whole roster plane is repaired
M5  {F2c}            — ONLY the identity leak is repaired
M6  {F2e}            — ONLY the welcome leak is repaired
"""

import hashlib
import json
import os
import re
import subprocess
import sys
import time

REPO = "/root/.hermes/workspace/woclaw"
HUB = os.path.join(REPO, "hub")
SUITE = "test/r556_roster_plane_census.test.ts"
VITEST = os.path.join(HUB, "node_modules", ".bin", "vitest")

EXPECTED = {
    "M1": "KILLED",     # real repair, shape A (filter to caller's memberships)
    "M2": "KILLED",     # real repair, shape B (refuse private topics outright)
    "M3": "SURVIVED",   # lazy comment
    "M4": "SURVIVED",   # recognise-but-refuse
    "M5": "KILLED",     # partial repair: the roster leak is fixed
    "M6": "KILLED",     # partial repair, mirror: the welcome leak is fixed
}

# R553-11: the EXACT red arm names each variant must produce. A count
# cannot tell "one of mine" from "one of theirs"; a named set can.
# An empty set = the variant must produce NO red arm at all.
EXPECTED_RED = {
    "M1": {"F2b", "F2c", "F2d"},
    "M2": {"F2b", "F2c", "F2d"},
    "M3": set(),
    "M4": set(),
    "M5": {"F2c"},       # only the topic_members identity leak is fixed
    "M6": {"F2e"},       # only the welcome name leak is fixed
}

OWNED = {k: ["src/ws_server.ts"] for k in EXPECTED}


def md5(path):
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def git_blob_md5(rel):
    """md5 of the HEAD blob for a hub/-relative path.

    R552-13: the git root is the REPO root, not `hub/`.  The path must be
    prefixed accordingly, or the pre-flight reports "no HEAD blob" — which
    is a conclusion about the PATH, not about the tree.
    """
    repo_rel = f"hub/{rel}"
    out = subprocess.run(
        ["git", "show", f"HEAD:{repo_rel}"],
        cwd=REPO, capture_output=True, text=True,
    )
    if out.returncode != 0:
        raise RuntimeError(f"no HEAD blob for {repo_rel}: {out.stderr.strip()}")
    return hashlib.md5(out.stdout.encode()).hexdigest()


def preflight():
    """Refuse to run on a dirty tree."""
    problems = []
    for rel in sorted({f for fs in OWNED.values() for f in fs}):
        p = os.path.join(HUB, rel)
        if not os.path.exists(p):
            problems.append(f"missing subject file: hub/{rel}")
            continue
        cur = md5(p)
        head = git_blob_md5(rel)
        if cur != head:
            problems.append(f"DIRTY: hub/{rel} md5 {cur} != HEAD blob {head}")
    if problems:
        print("PREFLIGHT REFUSAL:")
        for p in problems:
            print("  " + p)
        sys.exit(2)
    print("PREFLIGHT OK — all owned files match their HEAD blobs")


def run_suite(timeout=600):
    """Run the focused suite; return (verdict, red_arm_names, output).

    R556: the timeout is 600s, not 300s. On this host vitest's PROCESS
    startup costs ~2 minutes (a trivial one-test file reports "Duration
    3.05s" but takes 2m12s of wall clock — the host's swap is exhausted and
    every process spawn pays an I/O wait). The suite's own duration is 4s.
    A 300s timeout was measured to be marginal.
    """
    t0 = time.time()
    proc = subprocess.run(
        [VITEST, "run", SUITE, "--reporter=basic"],
        cwd=HUB, capture_output=True, text=True, timeout=timeout,
    )
    out = proc.stdout + proc.stderr
    dt = time.time() - t0

    m = re.search(r"Tests\s+(\d+) failed \| (\d+) passed", out)
    if m:
        failed = int(m.group(1))
    elif re.search(r"Tests\s+(\d+) passed", out):
        failed = 0
    else:
        return "HARNESS", [], out, dt

    # Exact red arm names — the discriminators (R553-11).
    red = []
    for mm in re.finditer(r"FAIL\s+test/r556_roster_plane_census\.test\.ts\s+>\s*(.+)", out):
        name = mm.group(1).strip()
        if name not in red:
            red.append(name)
    for mm in re.finditer(r"❯\s+test/r556_roster_plane_census\.test\.ts\s+>\s*(.+?)\s*\(\d+ms\)", out):
        name = mm.group(1).strip()
        if name not in red:
            red.append(name)

    if failed == 0:
        return "PASS", red, out, dt
    if re.search(r"TypeError|ReferenceError|is not a function|Cannot read propert", out):
        return "HARNESS", red, out, dt
    return "FAIL", red, out, dt


def restore(files):
    for rel in files:
        p = os.path.join(HUB, rel)
        blob = subprocess.run(
            ["git", "show", f"HEAD:hub/{rel}"], cwd=REPO, capture_output=True, text=True,
        ).stdout
        with open(p, "w") as f:
            f.write(blob)
        os.utime(p, (0, 0))


# ---------------------------------------------------------------------------
# The mutations.
#
# R555-P6: EVERY file is read into memory FIRST, and written only afterwards.
# The naive shape `with open(p,'w') as f: f.write(apply(open(p).read()))`
# truncates the file AT OPEN and then reads the truncated (empty) file.
# ---------------------------------------------------------------------------

M1_ANCHOR = """  private handleTopicsList(ws: WS): void {
    const topics = this.topics.getAllTopics().map(t => ({
      name: t.name,
      agents: t.agents.size,
    }));
    this.send(ws, { type: 'topics_list', topics, timestamp: Date.now() });
  }
"""

M1_NEW = """  private handleTopicsList(ws: WS, agentId?: string): void {
    const topics = this.topics.getAllTopics()
      .filter(t => !agentId || t.agents.has(agentId))
      .map(t => ({
        name: t.name,
        agents: t.agents.size,
      }));
    this.send(ws, { type: 'topics_list', topics, timestamp: Date.now() });
  }
"""

M2_ANCHOR = """  private handleTopicsList(ws: WS): void {
    const topics = this.topics.getAllTopics().map(t => ({
      name: t.name,
      agents: t.agents.size,
    }));
    this.send(ws, { type: 'topics_list', topics, timestamp: Date.now() });
  }
"""

M2_NEW = """  private handleTopicsList(ws: WS): void {
    const topics = this.topics.getAllTopics()
      .filter(t => !t.isPrivate)
      .map(t => ({
        name: t.name,
        agents: t.agents.size,
      }));
    this.send(ws, { type: 'topics_list', topics, timestamp: Date.now() });
  }
"""

M3_ANCHOR = """  private handleTopicsList(ws: WS): void {"""
M3_NEW = """  // M3: R556 lazy-comment negative control. No behavioural change.
  private handleTopicsList(ws: WS): void {"""

M4_ANCHOR = """  private handleTopicMembers(ws: WS, topic: string): void {
    const agents = this.topics.getTopicAgents(topic);
    this.send(ws, { type: 'topic_members', topic, agents, timestamp: Date.now() });
  }
"""

M4_NEW = """  private handleTopicMembers(ws: WS, topic: string, agentId?: string): void {
    // M4: R556 recognise-but-refuse negative control. It now KNOWS the
    // caller's identity — and still returns exactly what it returned before.
    const callerKnown = typeof agentId === 'string' && agentId.length > 0;
    void callerKnown;
    const agents = this.topics.getTopicAgents(topic);
    this.send(ws, { type: 'topic_members', topic, agents, timestamp: Date.now() });
  }
"""

M5_ANCHOR = """  private handleTopicsList(ws: WS): void {
    const topics = this.topics.getAllTopics().map(t => ({
      name: t.name,
      agents: t.agents.size,
    }));
    this.send(ws, { type: 'topics_list', topics, timestamp: Date.now() });
  }
"""

M5_NEW = """  private handleTopicsList(ws: WS): void {
    const topics = this.topics.getAllTopics()
      .filter(t => !t.isPrivate)
      .map(t => ({
        name: t.name,
        agents: t.agents.size,
      }));
    this.send(ws, { type: 'topics_list', topics, timestamp: Date.now() });
  }
"""

M5_WELCOME_OLD = """      topics: this.topics.getAllTopics().map(t => t.name),"""
M5_WELCOME_NEW = """      topics: this.topics.getAllTopics().filter(t => !t.isPrivate).map(t => t.name),"""


def m1(src):
    """REAL REPAIR (shape A): filter the roster to the caller's memberships."""
    assert M1_ANCHOR in src, "M1 anchor not found"
    src = src.replace(M1_ANCHOR, M1_NEW)
    # pass the caller's identity through
    old = "      this.handleTopicsList(agent.ws);"
    assert old in src, "M1 call-site anchor not found"
    src = src.replace(old, "      this.handleTopicsList(agent.ws, agentId);")
    # and filter the members list too
    old2 = """  private handleTopicMembers(ws: WS, topic: string): void {
    const agents = this.topics.getTopicAgents(topic);
    this.send(ws, { type: 'topic_members', topic, agents, timestamp: Date.now() });
  }
"""
    new2 = """  private handleTopicMembers(ws: WS, topic: string, agentId?: string): void {
    const all = this.topics.getTopicAgents(topic);
    const topic_ = this.topics.getTopic(topic);
    const agents = (agentId && topic_ && !topic_.agents.has(agentId)) ? [] : all;
    this.send(ws, { type: 'topic_members', topic, agents, timestamp: Date.now() });
  }
"""
    assert old2 in src, "M1 members anchor not found"
    src = src.replace(old2, new2)
    old3 = "      this.handleTopicMembers(agent.ws, msg.topic);"
    assert old3 in src, "M1 members call-site anchor not found"
    src = src.replace(old3, "      this.handleTopicMembers(agent.ws, msg.topic, agentId);")
    return src


def m2(src):
    """REAL REPAIR (shape B): refuse private topics outright."""
    assert M2_ANCHOR in src, "M2 anchor not found"
    src = src.replace(M2_ANCHOR, M2_NEW)
    old2 = """  private handleTopicMembers(ws: WS, topic: string): void {
    const agents = this.topics.getTopicAgents(topic);
    this.send(ws, { type: 'topic_members', topic, agents, timestamp: Date.now() });
  }
"""
    new2 = """  private handleTopicMembers(ws: WS, topic: string): void {
    const topic_ = this.topics.getTopic(topic);
    const agents = (topic_ && topic_.isPrivate) ? [] : this.topics.getTopicAgents(topic);
    this.send(ws, { type: 'topic_members', topic, agents, timestamp: Date.now() });
  }
"""
    assert old2 in src, "M2 members anchor not found"
    src = src.replace(old2, new2)
    return src


def m3(src):
    """NEGATIVE CONTROL: lazy comment only."""
    assert M3_ANCHOR in src, "M3 anchor not found"
    return src.replace(M3_ANCHOR, M3_NEW)


def m4(src):
    """NEGATIVE CONTROL: recognise but refuse."""
    assert M4_ANCHOR in src, "M4 anchor not found"
    src = src.replace(M4_ANCHOR, M4_NEW)
    old = "      this.handleTopicMembers(agent.ws, msg.topic);"
    assert old in src, "M4 call-site anchor not found"
    src = src.replace(old, "      this.handleTopicMembers(agent.ws, msg.topic, agentId);")
    return src


def m5(src):
    """PARTIAL REPAIR (DISCRIMINATOR): ONLY the topic_members identity
    leak is fixed. The topics_list count leak AND the welcome name leak
    both remain. This is the ORTHOGONAL counterpart of M6.

    R556's first M5 fixed the whole roster AND the welcome — which made
    it a second copy of M2, and made the "partial repair" claim false.
    The point of the M5/M6 pair is to prove the suite can tell the two
    SURFACES apart, so each must repair exactly one."""
    old2 = """  private handleTopicMembers(ws: WS, topic: string): void {
    const agents = this.topics.getTopicAgents(topic);
    this.send(ws, { type: 'topic_members', topic, agents, timestamp: Date.now() });
  }
"""
    new2 = """  private handleTopicMembers(ws: WS, topic: string): void {
    const topic_ = this.topics.getTopic(topic);
    const agents = (topic_ && topic_.isPrivate) ? [] : this.topics.getTopicAgents(topic);
    this.send(ws, { type: 'topic_members', topic, agents, timestamp: Date.now() });
  }
"""
    assert old2 in src, "M5 members anchor not found"
    src = src.replace(old2, new2)
    return src


def m6(src):
    """PARTIAL REPAIR (DISCRIMINATOR): ONLY the WELCOME frame's name leak
    is fixed. The whole roster still leaks. The mirror of M5."""
    assert M5_WELCOME_OLD in src, "M6 welcome anchor not found"
    src = src.replace(M5_WELCOME_OLD, M5_WELCOME_NEW)
    return src


MUTANTS = {"M1": m1, "M2": m2, "M3": m3, "M4": m4, "M5": m5, "M6": m6}


def main():
    preflight()

    # ---- CONTROL: the unmutated suite must be GREEN -------------------
    print("\n=== CONTROL (unmutated) ===")
    verdict, red, out, dt = run_suite()
    print(f"verdict={verdict} red={red} ({dt:.1f}s)")
    if verdict != "PASS":
        print(out[-6000:])
        print("CONTROL FAILED — a matrix on a red baseline proves nothing.")
        sys.exit(3)
    print("CONTROL GREEN — baseline established.")

    results = {}
    owned_before = {rel: md5(os.path.join(HUB, rel)) for fs in OWNED.values() for rel in fs}

    # ---- the mutants ---------------------------------------------------
    for name in sorted(MUTANTS):
        print(f"\n=== {name} ===")
        # R555-P6: read EVERYTHING into memory FIRST.
        # The restore list is declared BEFORE the try, so a raising
        # mutation is still restored.
        owned = OWNED[name]
        try:
            originals = {}
            for rel in owned:
                with open(os.path.join(HUB, rel), "r") as f:
                    originals[rel] = f.read()
            mutated = MUTANTS[name](originals["src/ws_server.ts"])
            assert mutated != originals["src/ws_server.ts"], f"{name} changed nothing"
            # NOW write.
            for rel in owned:
                with open(os.path.join(HUB, rel), "w") as f:
                    f.write(mutated if rel == "src/ws_server.ts" else originals[rel])
            verdict, red, out, dt = run_suite()
        except AssertionError as e:
            print(f"  MUTATION ANCHOR FAILED: {e}")
            verdict, red, out, dt = "ANCHOR_FAIL", [], str(e), 0
        except Exception as e:  # noqa: BLE001
            print(f"  MUTATION RAISED: {e}")
            verdict, red, out, dt = "MUTATION_RAISED", [], str(e), 0
        finally:
            # ALWAYS restore, even when the mutation raised.
            restore(owned)
            for rel in owned:
                cur = md5(os.path.join(HUB, rel))
                assert cur == owned_before[rel], f"RESTORE FAILED for {rel}: {cur} != {owned_before[rel]}"
            print(f"  restored + md5 verified for {owned}")

        observed = "SURVIVED" if verdict == "PASS" else (
            "KILLED" if verdict == "FAIL" else verdict)
        expected = EXPECTED[name]
        ok = observed == expected
        # R553-11: the EXACT red arm set. A count cannot tell "one of mine"
        # from "one of theirs" — a named set can.
        #
        # L556-e: the extractor MUST be INDEPENDENT of the expectation. The
        # first version of this code only looked for arms that were IN the
        # expected set, so two EXTRA red arms (F2d, F2e under M5) were
        # silently masked — the comparison passed while the truth did not.
        # The extractor now enumerates EVERY arm present in the output.
        observed_arms = set()
        for r in red:
            for mm in re.finditer(r"\((F\d+[a-z]?)\)", r):
                observed_arms.add(mm.group(1))
        expected_arms = EXPECTED_RED[name]
        arms_ok = observed_arms == expected_arms
        if not arms_ok:
            ok = False
        print(f"  expected={expected} observed={observed} -> {'PASS' if ok else '*** WRONG VERDICT ***'}")
        print(f"  expected arms={sorted(expected_arms)} observed arms={sorted(observed_arms)}"
              f" -> {'OK' if arms_ok else '*** WRONG ARM SET ***'}")
        if red:
            print(f"  red arms (raw): {red}")
        results[name] = {
            "expected": expected, "observed": observed, "verdict": verdict,
            "red_arms": red,
            "expected_arm_set": sorted(expected_arms),
            "observed_arm_set": sorted(observed_arms),
            "ok": ok,
        }

    # ---- summary --------------------------------------------------------
    print("\n=== MATRIX SUMMARY ===")
    for name in sorted(results):
        r = results[name]
        print(f"  {name}: expected={r['expected']:<9} observed={r['observed']:<9} "
              f"{'OK' if r['ok'] else 'WRONG'}")
    wrong = [n for n, r in results.items() if not r["ok"]]
    if wrong:
        print(f"\nMATRIX FAILED: wrong verdicts for {wrong}")
        sys.exit(4)
    print("\nMATRIX PASS — every variant matched its expected verdict.")

    with open("/tmp/r556_matrix_results.json", "w") as f:
        json.dump(results, f, indent=2)
    print("wrote /tmp/r556_matrix_results.json")


if __name__ == "__main__":
    main()
