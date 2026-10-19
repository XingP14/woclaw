#!/usr/bin/env python3
"""R488 P1d discrimination probe.

Question: does the REWRITTEN P1d arm separate the two repairs that the
census arms cannot?

  M4  write-only   -- the rotation is persisted, never read back
  M3  full repair  -- persisted AND read back at boot

Both add a WRITER, so P1b/P1c kill both equally. P1d is the arm that is
supposed to tell them apart: GREEN under M4 (no rotation state in the boot
path), RED under M3 (the boot path reads a rotation state back).

The probe reports WHICH test fails under each arm, so the claim is measured
rather than inferred from a count.
"""
import hashlib
import re
import subprocess
import sys
from pathlib import Path

REPO = Path("/root/.hermes/workspace/woclaw")
HUB = REPO / "hub"
OWNED = [HUB / "src/ws_server.ts", HUB / "src/index.ts"]
MARKER = Path("/tmp/r488-rotated-token.json")
W, I = OWNED


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


_st = subprocess.run(
    ["git", "status", "--short", "--"] + [str(p.relative_to(REPO)) for p in OWNED],
    cwd=REPO, capture_output=True, text=True,
)
assert _st.stdout.strip() == "", f"ABORT pre-injection: OWNED dirty -> {_st.stdout!r}"

BASE = {p: p.read_bytes() for p in OWNED}
EXPECT = {p: md5(p) for p in OWNED}

WRITE = (W, "import { readFileSync } from 'fs';",
         "import { readFileSync, writeFileSync } from 'fs';")
WRITE_BODY = (W,
              "    hubLog(`Token rotated. Grace ends at ${new Date(this.gracePeriodEnd).toISOString()}`);",
              "    writeFileSync('/tmp/r488-rotated-token.json', JSON.stringify({ token: newToken }));\n"
              "    hubLog(`Token rotated. Grace ends at ${new Date(this.gracePeriodEnd).toISOString()}`);")
READBACK_IMPORT = (I, "import { existsSync } from 'fs';",
                   "import { existsSync, readFileSync } from 'fs';")
READBACK_BODY = (I,
                 "      config = loadConfigFile(configPath, config);",
                 "      config = loadConfigFile(configPath, config);\n"
                 "      if (existsSync('/tmp/r488-rotated-token.json')) {\n"
                 "        const persisted = JSON.parse(readFileSync('/tmp/r488-rotated-token.json', 'utf-8'));\n"
                 "        if (persisted && typeof persisted.token === 'string') config.authToken = persisted.token;\n"
                 "      }")

ARMS = [
    ("M4 write-only (persisted, never read back)", [WRITE, WRITE_BODY]),
    ("M3 full repair (persisted AND read back)", [WRITE, WRITE_BODY, READBACK_IMPORT, READBACK_BODY]),
]


def mutate(path, old, new):
    text = path.read_text()
    n = text.count(old)
    assert n == 1, f"anchor count {n} != 1 in {path.name} for {old[:60]!r}"
    path.write_text(text.replace(old, new))
    assert path.read_text() != text, f"injection did not change {path.name}"


def run():
    if MARKER.exists():
        MARKER.unlink()
    r = subprocess.run(
        ["npx", "vitest", "run", "test/r488_rotation_durability.test.ts", "--reporter=verbose"],
        cwd=HUB, capture_output=True, text=True, timeout=1200,
    )
    out = r.stdout + r.stderr
    summary = [l for l in out.splitlines()
               if re.match(r"^\s*Tests\s+\d+", l) and "no tests" not in l]
    failed = []
    for l in out.splitlines():
        m = re.match(r"^\s*(?:FAIL|×)\s+\S+.*", l)
        if m and ">" in l:
            # keep only the test title, drop the file path
            title = l.split(">")[-1].strip()
            if title and title not in failed:
                failed.append(title)
    return (summary[-1].strip() if summary else "NO SUMMARY"), failed


for p in OWNED:
    assert md5(p) == EXPECT[p], f"PRE-INJECTION: {p.name} not the snapshot"

summary, failed = run()
print(f"CONTROL: {summary}", flush=True)
for t in failed:
    print(f"   failing: {t}", flush=True)
assert "failed" not in summary, f"ABORT: baseline not green ({summary})"

for name, edits in ARMS:
    for p, old, new in edits:
        mutate(p, old, new)
    try:
        summary, failed = run()
        print(f"\n{name}: {summary}", flush=True)
        for t in failed:
            print(f"   failing: {t}", flush=True)
    finally:
        for p in OWNED:
            p.write_bytes(BASE[p])
        for p in OWNED:
            assert md5(p) == EXPECT[p], f"RESTORE FAILED {p.name}"

if MARKER.exists():
    MARKER.unlink()
print("\nPOST-PROBE md5 mismatch:",
      [str(p) for p in OWNED if md5(p) != EXPECT[p]] or "none")
sys.exit(0)
