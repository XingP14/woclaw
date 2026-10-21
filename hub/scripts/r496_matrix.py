#!/usr/bin/env python3
"""
R496 mutation matrix.

DISCIPLINE (per R475-2 / R469-8 / R477):
  - OWNED file list is declared BEFORE any injection.
  - Before EACH injection: assert the owned file is byte-identical to its
    snapshot. Abort BEFORE injecting if not (never `git checkout` on a dirty
    tree — R446-1's rule only holds on a clean baseline).
  - Restore is BYTE-LEVEL from the snapshot, then re-verify md5.
  - CONTROL runs FIRST, and again at the end.
  - No needle is ever applied twice; `assert new != old` after the replace.
  - Every mutation is followed by `tsc --noEmit` so a mutation that breaks
    the build is reported as HARNESS, not as a survivor.
"""
import hashlib, os, shutil, subprocess, sys, time

HUB = "/root/.hermes/workspace/woclaw/hub"
TEST = "test/r496_graph_durability.test.ts"
OWNED = [
    "src/db.ts",
    "src/memory.ts",
    "src/graph/store.ts",
    "src/index.ts",
    "src/scheduler.ts",
    "src/extraction/engine.ts",
]

SNAP = "/root/.hermes/cache/scratch/r496_snap"
BASE = {}


def md5(p):
    return hashlib.md5(open(p, "rb").read()).hexdigest()


def snap():
    os.makedirs(SNAP, exist_ok=True)
    for rel in OWNED:
        dst = os.path.join(SNAP, rel.replace("/", "__"))
        shutil.copyfile(os.path.join(HUB, rel), dst)
        BASE[rel] = md5(dst)


def restore():
    for rel in OWNED:
        dst = os.path.join(SNAP, rel.replace("/", "__"))
        shutil.copyfile(dst, os.path.join(HUB, rel))


def assert_clean(stage):
    bad = [r for r in OWNED if md5(os.path.join(HUB, r)) != BASE[r]]
    if bad:
        print(f"ABORT[{stage}]: owned files not at baseline: {bad}")
        sys.exit(2)
    print(f"  [clean-ok {stage}]")


def inject(rel, old, new, name):
    p = os.path.join(HUB, rel)
    src = open(p, encoding="utf-8").read()
    n = src.count(old)
    if n != 1:
        return None, f"needle count {n} (expected 1) in {rel}"
    out = src.replace(old, new)
    if out == src:
        return None, "replace was a no-op"
    open(p, "w", encoding="utf-8").write(out)
    return True, "injected"


def run_tests():
    r = subprocess.run(["npx", "vitest", "run", TEST], cwd=HUB,
                       capture_output=True, text=True, timeout=600)
    return r.stdout + r.stderr


def run_tsc():
    r = subprocess.run(["npx", "tsc", "--noEmit"], cwd=HUB,
                       capture_output=True, text=True, timeout=600)
    return r.returncode


def verdict(out):
    if "Test Files  1 failed" in out or "FAIL " in out:
        if "Tests  no tests" in out or "Failed Suites" in out:
            return "HARNESS"
        return "KILLED"
    if "Test Files  1 passed" in out:
        return "SURVIVED"
    return "UNKNOWN"


def control(stage):
    assert_clean(stage)
    out = run_tests()
    v = verdict(out)
    print(f"  [control {stage}] {v}")
    return v, out


MUTATIONS = [
    # ── M1: REPAIR the durable half — rehydrate the graph from SQL at boot ──
    ("M1", "src/index.ts",
     "  const graphStore = new GraphStore();",
     "  const graphStore = new GraphStore();\n"
     "  void (async () => {\n"
     "    const all = await db.getAllMemory();\n"
     "    for (const m of all) {\n"
     "      try { graphStore.syncMemoryNode(m.key, m.value, m.updatedBy, m.tags); } catch { /* */ }\n"
     "    }\n"
     "  })();",
     "REPAIR: rehydrate the graph from SQL at boot"),

    # ── M2: REPAIR the durable half — persist the graph to disk ──
    ("M2", "src/graph/store.ts",
     "  private nodes: Map<string, GraphNode> = new Map();",
     "  private nodes: Map<string, GraphNode> = new Map();\n"
     "  private persisted = false;",
     "REPAIR-ish: add a persistence flag"),

    # ── M3: make the graph write-through durable ──
    ("M3", "src/memory.ts",
     "    await this.db.setMemory(key, serialized, updatedBy, tags, ttl);",
     "    await this.db.setMemory(key, serialized, updatedBy, tags, ttl);\n"
     "    if (this.graphStore) { this.graphStore.persistToDisk?.(); }",
     "REPAIR-ish: persist the graph on every memory write"),

    # ── M4: give the stats a 'rehydrated' field so the empty state is distinguishable ──
    ("M4", "src/graph/store.ts",
     "  getStats(): GraphStats {",
     "  getStats(): GraphStats {\n"
     "    const s = this.computeStats();\n"
     "    return { ...s, rehydrated: true } as unknown as GraphStats;",
     "REPAIR: stats carries a rehydration marker"),

    # ── M5: production produces a temporal edge (so the 'only entity' claim breaks) ──
    ("M5", "src/graph/store.ts",
     "    // Link memory → agent (entity edge)\n    this.linkMemoryToAgent(memNode.id, agentNode.id);",
     "    // Link memory → agent (entity edge)\n    this.linkMemoryToAgent(memNode.id, agentNode.id);\n"
     "    this.addEdge({ source: memNode.id, target: memNode.id, type: 'temporal', metadata: {} });",
     "REPAIR: production creates temporal edges"),

    # ── M6: production produces a causal edge ──
    ("M6", "src/graph/store.ts",
     "    // Link memory → agent (entity edge)\n    this.linkMemoryToAgent(memNode.id, agentNode.id);",
     "    // Link memory → agent (entity edge)\n    this.linkMemoryToAgent(memNode.id, agentNode.id);\n"
     "    this.addEdge({ source: memNode.id, target: memNode.id, type: 'causal', metadata: {} });",
     "REPAIR: production creates causal edges"),

    # ── M7: wire the extraction engine into the boot sequence ──
    ("M7", "src/index.ts",
     "  const graphStore = new GraphStore();",
     "  const graphStore = new GraphStore();\n"
     "  // wire extraction\n"
     "  try {\n"
     "    const mod: any = await import('./extraction/engine.js');\n"
     "    const eng = mod.createExtractionEngine(config);\n"
     "    eng.setGraphStore(graphStore);\n"
     "  } catch { /* optional */ }",
     "REPAIR: construct the extraction engine and wire its graph store"),

    # ── M8: the scheduler gets a non-null extraction engine ──
    ("M8", "src/index.ts",
     "  const forgettingScheduler = new ForgettingScheduler(db, sessionStore, null);",
     "  const forgettingScheduler = new ForgettingScheduler(db, sessionStore, {} as any);",
     "REPAIR-ish: pass a non-null extraction engine"),

    # ── M9: checkpoint the WAL on close (the durable half's repair) ──
    ("M9", "src/db.ts",
     "  async close(): Promise<void> {\n    if (this.db) {\n      this.db.close();\n    }\n  }",
     "  async close(): Promise<void> {\n    if (this.db) {\n"
     "      try { this.db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* */ }\n"
     "      this.db.close();\n    }\n  }",
     "REPAIR: checkpoint the WAL before closing"),

    # ── M10: NEGATIVE CONTROL — a comment that mentions nothing measurable ──
    ("M10", "src/graph/store.ts",
     "  private nodes: Map<string, GraphNode> = new Map();",
     "  private nodes: Map<string, GraphNode> = new Map(); // durability notes",
     "NEGATIVE CONTROL: prose only, must SURVIVE"),
]


def main():
    snap()
    print("=== CONTROL (must be GREEN) ===")
    v, _ = control("start")
    if v != "SURVIVED":
        print("CONTROL NOT GREEN — aborting before any injection (R404-M1)")
        sys.exit(3)

    print("\n=== TSC baseline ===")
    rc = run_tsc()
    print(f"  tsc rc={rc}")
    if rc != 0:
        print("baseline tsc not clean — aborting")
        sys.exit(3)

    results = []
    for name, rel, old, new, desc in MUTATIONS:
        print(f"\n=== {name}: {desc}  [{rel}] ===")
        assert_clean(name)
        ok, why = inject(rel, old, new, name)
        if ok is None:
            print(f"  NOT-INJECTED: {why}")
            restore()
            assert_clean(name + "-restored")
            results.append((name, desc, "NOT-INJECTED", ""))
            continue
        tsc_rc = run_tsc()
        if tsc_rc != 0:
            print(f"  tsc FAILED (rc={tsc_rc}) -> HARNESS")
            restore()
            assert_clean(name + "-restored")
            results.append((name, desc, "HARNESS", "tsc broke"))
            continue
        out = run_tests()
        v = verdict(out)
        print(f"  verdict: {v}")
        if v == "KILLED":
            # which arms fired
            fired = [ln.strip() for ln in out.splitlines() if ln.strip().startswith("×") or "FAIL" in ln and "r496" in ln]
            for f in fired[:8]:
                print(f"    {f}")
        restore()
        assert_clean(name + "-restored")
        results.append((name, desc, v, ""))

    print("\n=== CONTROL (end) ===")
    v, _ = control("end")

    print("\n=== SUMMARY ===")
    for name, desc, v, note in results:
        print(f"  {name:4} {v:14} {desc} {note}")
    killed = sum(1 for r in results if r[2] == "KILLED")
    survived = sum(1 for r in results if r[2] == "SURVIVED")
    harness = sum(1 for r in results if r[2] in ("HARNESS", "NOT-INJECTED", "UNKNOWN"))
    print(f"  KILLED={killed} SURVIVED={survived} HARNESS/NI={harness}")


if __name__ == "__main__":
    main()
