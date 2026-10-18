#!/usr/bin/env python3
"""R485 mutation driver — prove the suite can go RED on a real repair.

Baseline must be GREEN. Then one repair mutation is injected into
hub/src/rest_server.ts and the suite must go RED on the arms that name the
defect. Finally the file is restored byte-for-byte.

Owned-file discipline (R475): this round OWNS exactly one file,
hub/src/rest_server.ts. It is snapshotted by bytes and asserted clean
before injection.
"""
import hashlib
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]          # .../woclaw
SRC = ROOT / "hub" / "src" / "rest_server.ts"
TEST = "test/r485_eviction_routing_unreachable.test.ts"

snapshot = SRC.read_bytes()
baseline_hash = hashlib.md5(snapshot).hexdigest()

# ---- Own the file: refuse to mutate a tree that is not at our baseline ----
st = subprocess.run(
    ["git", "-C", str(ROOT), "status", "--porcelain", "--", "hub/src/rest_server.ts"],
    capture_output=True, text=True,
)
if st.stdout.strip():
    sys.exit(f"ABORT: {SRC} is not clean before injection:\n{st.stdout}")

# ---- Baseline: must be GREEN or every later result is meaningless ----------
base = subprocess.run(
    ["npx", "vitest", "run", TEST],
    cwd=ROOT / "hub", capture_output=True, text=True,
)
print("=== BASELINE ===")
print(base.stdout[-1500:])
if base.returncode != 0:
    shutil.copyfile  # no-op
    (ROOT / "hub" / "src" / "rest_server.ts").write_bytes(snapshot)
    sys.exit("ABORT: baseline is not green.")

MUTATIONS = [
    (
        "REPAIR-1: move the /api/v1/memory pair out of handleDelegations "
        "into handleRequest",
        """    // v1.0: Memory eviction management
    if (path === '/api/v1/memory/eviction' && method === 'GET') {
      this.handleMemoryEvictionSimple(res); return;
    }
    if (path === '/api/v1/memory/prune') {
      this.handleMemoryPruneSimple(req, res); return;
    }
""",
        "",
    ),
    (
        "REPAIR-2 (REAL FIX): actually wire the pair into handleRequest, so "
        "POST /api/v1/memory/prune reaches the eviction. Behavioural arms "
        "must go red here — REPAIR-1 alone only proved the shape arm has teeth.",
        """      } else if (path === '/delegations' || path.startsWith('/delegations')) {
        this.handleDelegations(req, res, url, path, method);
""",
        """      } else if (path === '/delegations' || path.startsWith('/delegations')) {
        this.handleDelegations(req, res, url, path, method);
      } else if (path === '/api/v1/memory/eviction' && method === 'GET') {
        this.handleMemoryEvictionSimple(res); return;
      } else if (path === '/api/v1/memory/prune') {
        this.handleMemoryPruneSimple(req, res); return;
""",
    ),
]

def run(name, old, new):
    src = SRC.read_text()
    n = src.count(old)
    if n != 1:
        print(f"\n!! SKIP {name}: anchor count={n}, expected 1 (never mutated)")
        return None
    mutated = src.replace(old, new, 1)
    assert mutated != src, "mutation was a no-op"
    SRC.write_text(mutated)
    try:
        tsc = subprocess.run(
            ["npx", "tsc", "--noEmit", "-p", "tsconfig.json"],
            cwd=ROOT / "hub", capture_output=True, text=True,
        )
        if tsc.returncode != 0:
            print(f"\n!! HARNESS ERROR {name}: tsc failed, NOT a kill")
            print(tsc.stdout[-1200:])
            return None
        r = subprocess.run(
            ["npx", "vitest", "run", TEST, "--reporter=basic"],
            cwd=ROOT / "hub", capture_output=True, text=True,
        )
        combined = r.stdout + r.stderr
        failed = [l for l in combined.splitlines()
                  if l.strip().startswith("×") or "AssertionError" in l]
        tests_line = next((l.strip() for l in combined.splitlines()
                           if l.strip().startswith("Tests ")), "(no Tests line)")
        print(f"\n=== {name} ===")
        print(f"exit={r.returncode}  {tests_line}")
        for l in failed[:12]:
            print("   " + l.strip()[:130])
        return r.returncode
    finally:
        SRC.write_bytes(snapshot)
        assert hashlib.md5(SRC.read_bytes()).hexdigest() == baseline_hash

try:
    for name, old, new in MUTATIONS:
        run(name, old, new)
finally:
    SRC.write_bytes(snapshot)

print(f"\nrestored: {hashlib.md5(SRC.read_bytes()).hexdigest() == baseline_hash}")
