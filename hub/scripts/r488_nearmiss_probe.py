#!/usr/bin/env python3
"""R488 near-miss probe: does a WRITE-ONLY repair die in the R488 suite?

The suite's P1d comment claims the write-only mutation is "killed ONLY by the
two census arms above" (P1b/P1c). This probe MEASURES that claim: it applies
the write-only repair (persist the rotated token, never read it back) and
reports the suite's verdict. Snapshot/restore discipline per R477.

Arms
----
  M4  NEAR-MISS REPAIR: the rotation is written to disk but NEVER read back.
      A restarted hub still does not honour the rotated token.
  M6  NEGATIVE CONTROL: semantically equivalent, MUST survive.
"""
import hashlib
import re
import subprocess
import sys
from pathlib import Path

REPO = Path("/root/.hermes/workspace/woclaw")
HUB = REPO / "hub"
SUITE = HUB / "test/r488_rotation_durability.test.ts"
OWNED = [HUB / "src/ws_server.ts", HUB / "src/index.ts"]
MARKER = Path("/tmp/r488-rotated-token.json")


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


_st = subprocess.run(
    ["git", "status", "--short", "--"] + [str(p.relative_to(REPO)) for p in OWNED],
    cwd=REPO, capture_output=True, text=True,
)
assert _st.stdout.strip() == "", f"ABORT pre-injection: OWNED dirty -> {_st.stdout!r}"

BASE = {p: p.read_bytes() for p in OWNED}
EXPECT = {p: md5(p) for p in OWNED}
W, I = OWNED


def run(label):
    if MARKER.exists():
        MARKER.unlink()
    r = subprocess.run(
        ["npx", "vitest", "run", "test/r488_rotation_durability.test.ts"],
        cwd=HUB, capture_output=True, text=True, timeout=1200,
    )
    out = r.stdout + r.stderr
    line = [l for l in out.splitlines()
            if re.match(r"^\s*Tests\s+\d+", l) and "no tests" not in l]
    if not line:
        errs = [l for l in out.splitlines() if "error TS" in l][:3]
        return label, "HARNESS", (errs or out[-500:])
    res = line[-1].strip()
    return label, ("KILLED" if "failed" in res else "SURVIVED"), res


def mutate(path, old, new):
    text = path.read_text()
    n = text.count(old)
    assert n == 1, f"anchor count {n} != 1 in {path.name} for {old[:60]!r}"
    path.write_text(text.replace(old, new))
    assert path.read_text() != text, f"injection did not change {path.name}"


ARMS = [
    ("M4 NEAR-MISS: write-only -- persisted, never read back",
     [(W, "import { readFileSync } from 'fs';",
       "import { readFileSync, writeFileSync } from 'fs';"),
      (W,
       "    hubLog(`Token rotated. Grace ends at ${new Date(this.gracePeriodEnd).toISOString()}`);",
       "    writeFileSync('/tmp/r488-rotated-token.json', JSON.stringify({ token: newToken }));\n"
       "    hubLog(`Token rotated. Grace ends at ${new Date(this.gracePeriodEnd).toISOString()}`);")],
     "KILLED"),
    ("M6 NEGATIVE CONTROL: semantically equivalent, MUST survive",
     [(W, "  private gracePeriodMs: number = 5 * 60 * 1000;",
       "  private gracePeriodMs: number = 5 * 60 * 1000; // a comment that changes nothing")],
     "SURVIVED"),
]

for p in OWNED:
    assert md5(p) == EXPECT[p], f"PRE-INJECTION: {p.name} not the snapshot"
label, verdict, detail = run("CONTROL")
print(f"{label}: {verdict} — {detail}", flush=True)
assert verdict == "SURVIVED", f"ABORT: baseline not green ({verdict}: {detail})"

for name, edits, expect in ARMS:
    touched = sorted({e[0] for e in edits})
    for p in touched:
        assert md5(p) == EXPECT[p], f"ABORT: {p.name} not at snapshot"
    try:
        for p, old, new in edits:
            mutate(p, old, new)
        label, verdict, detail = run(name)
        print(f"{name}: {verdict} — {detail}   (expected {expect})", flush=True)
    finally:
        for p in touched:
            p.write_bytes(BASE[p])
        for p in touched:
            assert md5(p) == EXPECT[p], f"RESTORE FAILED {p.name}"

if MARKER.exists():
    MARKER.unlink()
bad = [str(p) for p in OWNED if md5(p) != EXPECT[p]]
print("POST-PROBE md5 mismatch:", bad or "none")
sys.exit(0)
