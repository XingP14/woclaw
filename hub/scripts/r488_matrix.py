#!/usr/bin/env python3
"""R488 mutation matrix (woclaw).

Discipline (R475-2 / R477 / R481 / R482 / R487 driver fixes), applied to
vitest this time:
  - declare OWNED files, assert each is TRACKED-CLEAN before injecting;
  - snapshot BEFORE any injection, assert byte-identical (md5) before each arm;
  - assert the needle was UNIQUELY anchored BEFORE writing (R477);
  - assert the text actually changed after writing (R456);
  - inject ONE mutation per arm, restore IMMEDIATELY, not only in finally;
  - classify on the SUMMARY SHAPE, not on the mere presence of "Tests";
  - a COMPILE-BROKEN arm is HARNESS, never a verdict (r487).

Arms
----
  M1  REPAIR of D3: the grace slot becomes a SET, so several tokens can be
      in grace at once (the shape the suite says a real repair would take).
  M2  REPAIR of D2: rotateToken stops recording the superseded token.
  M3  REPAIR of D1: rotation is persisted to disk (the write half).
  M4  NEAR-MISS: the write half only -- a rotated token is written but never
      read back, so a restarted hub still does not honour it.
  M5  NEGATIVE CONTROL: semantically equivalent, MUST survive.
"""
import hashlib
import re
import subprocess
import sys
from pathlib import Path

REPO = Path("/root/.hermes/workspace/woclaw")
HUB = REPO / "hub"
SUITE = HUB / "test/r488_rotation_durability.test.ts"
OWNED = [
    HUB / "src/ws_server.ts",
    HUB / "src/index.ts",
    HUB / "src/config_file.ts",
    HUB / "src/types.ts",
]


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


# ── pre-injection: OWNED must be TRACKED-CLEAN (R477 D1) ──────────────────
_st = subprocess.run(
    ["git", "status", "--short", "--"] + [str(p.relative_to(REPO)) for p in OWNED],
    cwd=REPO, capture_output=True, text=True,
)
assert _st.stdout.strip() == "", f"ABORT pre-injection: OWNED files dirty -> {_st.stdout!r}"

BASE = {p: p.read_bytes() for p in OWNED}
EXPECT = {p: md5(p) for p in OWNED}

W = OWNED[0]   # src/ws_server.ts
I = OWNED[1]   # src/index.ts

ARMS = [
    ("M1 REPAIR: the grace slot becomes a SET (D3 -- several tokens in grace)",
     [(W,
       "  private gracePeriodEnd: number | null = null;",
       "  private gracePeriodEnd: number | null = null;\n"
       "  private graceSlots: Set<string> = new Set<string>();"),
      (W,
       "    return this.gracePeriodEnd !== null && token === this.config.nextAuthToken;",
       "    return this.gracePeriodEnd !== null && this.graceSlots.has(token);"),
      (W,
       "    this.config.nextAuthToken = oldToken;",
       "    this.config.nextAuthToken = oldToken;\n"
       "    this.graceSlots.add(oldToken);")],
     "KILLED"),

    ("M2 REPAIR: rotateToken stops recording the superseded token (D2)",
     [(W,
       "    this.config.nextAuthToken = oldToken;",
       "    this.config.nextAuthToken = undefined;")],
     "KILLED"),

    ("M3 REPAIR: rotation is written AND read back (D1, the full repair)",
     [(W,
       "import { readFileSync } from 'fs';",
       "import { readFileSync, writeFileSync } from 'fs';"),
      (W,
       "    hubLog(`Token rotated. Grace ends at ${new Date(this.gracePeriodEnd).toISOString()}`);",
       "    writeFileSync('/tmp/r488-rotated-token.json', JSON.stringify({ token: newToken }));\n"
       "    hubLog(`Token rotated. Grace ends at ${new Date(this.gracePeriodEnd).toISOString()}`);"),
      (I,
       "import { existsSync } from 'fs';",
       "import { existsSync, readFileSync } from 'fs';"),
      (I,
       "      config = loadConfigFile(configPath, config);",
       "      config = loadConfigFile(configPath, config);\n"
       "      if (existsSync('/tmp/r488-rotated-token.json')) {\n"
       "        const persisted = JSON.parse(readFileSync('/tmp/r488-rotated-token.json', 'utf-8'));\n"
       "        if (persisted && typeof persisted.token === 'string') config.authToken = persisted.token;\n"
       "      }")],
     "KILLED"),

    ("M5 NEGATIVE CONTROL: semantically equivalent, MUST survive",
     [(W,
       "  private gracePeriodMs: number = 5 * 60 * 1000;",
       "  private gracePeriodMs: number = 5 * 60 * 1000; // a comment that changes nothing")],
     "SURVIVED"),
]


ROT_MARKER = Path("/tmp/r488-rotated-token.json")


def run(label: str):
    # The M3 repair persists a rotated token to a file OUTSIDE the repo. If
    # that file survives an arm, the NEXT arm's boot reads it back and the
    # baseline is contaminated -- the same shape as R477's restore defect, one
    # level out (the artefact is not in the repo, so the md5 restore cannot
    # clear it). Remove it before every run.
    if ROT_MARKER.exists():
        ROT_MARKER.unlink()
    r = subprocess.run(
        ["npx", "vitest", "run", "test/r488_rotation_durability.test.ts"],
        cwd=HUB, capture_output=True, text=True, timeout=1200,
    )
    out = r.stdout + r.stderr
    # Require the SUMMARY SHAPE, not just the word "Tests" (r482 defect #2).
    line = [l for l in out.splitlines()
            if re.match(r"^\s*Tests\s+\d+", l) and "no tests" not in l]
    if not line:
        errs = [l for l in out.splitlines() if "error TS" in l][:3]
        return label, "HARNESS", (errs or out[-400:])
    res = line[-1].strip()
    if "failed" in res:
        return label, "KILLED", res
    return label, "SURVIVED", res


def mutate(path: Path, old: str, new: str):
    text = path.read_text()
    n = text.count(old)
    assert n == 1, f"anchor count {n} != 1 in {path.name} for {old[:70]!r}"
    path.write_text(text.replace(old, new))
    assert path.read_text() != text, f"injection did not change {path.name}"


results = []

# ── CONTROL FIRST (R479: a broken control is worse than a broken suite) ───
for p in OWNED:
    assert md5(p) == EXPECT[p], f"PRE-INJECTION: {p.name} is not the snapshot (dirty tree)"
label, verdict, detail = run("CONTROL")
results.append((label, verdict, detail, "SURVIVED"))
print(f"{label}: {verdict} — {detail}", flush=True)
assert verdict == "SURVIVED", f"ABORT: the baseline is not green ({verdict}: {detail})"

for name, edits, expect in ARMS:
    touched = sorted({e[0] for e in edits})
    for p in touched:
        assert md5(p) == EXPECT[p], f"ABORT: {p.name} not at snapshot"
    try:
        for p, old, new in edits:
            mutate(p, old, new)
        label, verdict, detail = run(name)
        results.append((label, verdict, detail, expect))
        print(f"{name}: {verdict} — {detail}   (expected {expect})", flush=True)
    finally:
        # restore IMMEDIATELY, per arm, byte-exact (R477/R481/R482)
        for p in touched:
            p.write_bytes(BASE[p])
        for p in touched:
            assert md5(p) == EXPECT[p], f"RESTORE FAILED {p.name}"

print("\n=== SUMMARY ===")
for n, v, d, e in results:
    flag = "" if v == e or n == "CONTROL" else "   <-- UNEXPECTED"
    print(f"{v:9s} (exp {e:8s}) {n}{flag}")
bad = [str(p) for p in OWNED if md5(p) != EXPECT[p]]
print("POST-MATRIX md5 mismatch:", bad or "none")
sys.exit(0)
