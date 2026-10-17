#!/usr/bin/env python3
"""R482 mutation matrix.

Discipline (R475-2 / R477 / R481):
  - declare OWNED files, assert each is byte-identical to a snapshot,
  - inject ONE mutation per arm, restore IMMEDIATELY (not only in finally),
  - assert the needle was uniquely anchored BEFORE writing,
  - assert the text actually changed after writing,
  - classify on the presence of the `Tests` line (r479 lesson).
"""
import hashlib, json, os, shutil, subprocess, sys, tempfile
from pathlib import Path

HUB = Path("/root/.hermes/workspace/woclaw/hub")
SUITE = HUB / "test/r482_dedup_predicate_column_set.test.ts"
OWNED = [HUB / "src/memory.ts", HUB / "src/ws_server.ts", HUB / "src/rest_server.ts"]
BASE = {p: p.read_bytes() for p in OWNED}
# snapshot BEFORE any injection, and assert every OWNED file is TRACKED-CLEAN first
import subprocess as _sp
_st = _sp.run(['git','status','--short','--'] + [str(p) for p in OWNED], cwd=HUB.parent, capture_output=True, text=True)
assert _st.stdout.strip() == '', f'ABORT pre-injection: OWNED files dirty -> {_st.stdout}'
EXPECT = {p: hashlib.md5(p.read_bytes()).hexdigest() for p in OWNED}

def md5(p): return hashlib.md5(p.read_bytes()).hexdigest()

def run(label):
    r = subprocess.run(["npx", "vitest", "run", str(SUITE.name)],
                       cwd=HUB, capture_output=True, text=True, timeout=600)
    out = r.stdout + r.stderr
    # r482 driver defect #2: the r479 "presence of the Tests line" rule is NOT
    # sufficient -- a compile failure prints "Tests  no tests", which contains
    # "Tests " and was scored SURVIVED. Require the SUMMARY SHAPE too.
    line = [l for l in out.splitlines()
            if l.strip().startswith("Tests ") and "no tests" not in l]
    if not line:
        return label, "HARNESS", [l for l in out.splitlines() if "Error" in l][:2] or out[-300:]
    res = line[-1].strip()
    if "failed" in res:
        return label, "KILLED", res
    return label, "SURVIVED", res

def mutate(path, old, new, count=1):
    text = path.read_text()
    assert text.count(old) == count, f"anchor count {text.count(old)} != {count} in {path.name}"
    path.write_text(text.replace(old, new))
    assert path.read_text() != text, "injection did not change the file"

ARMS = [
    # (name, path, old, new)
    ("M1 REPAIR: predicate compares ttl too (F1 killed)", OWNED[0],
     "const duplicate = !!existing && existing.value === serialized;",
     "const duplicate = !!existing && existing.value === serialized && existing.ttl === ttl;"),
    ("M2 REPAIR: predicate compares tags too (F2 killed)", OWNED[0],
     "const duplicate = !!existing && existing.value === serialized;",
     "const duplicate = !!existing && existing.value === serialized && JSON.stringify(existing.tags) === JSON.stringify(tags);"),
    ("M3 REPAIR: skip the UPDATE on a duplicate (F3 killed)", OWNED[0],
     "    await this.db.setMemory(key, serialized, updatedBy, tags, ttl);",
     "    if (duplicate) { const e = await this.db.getMemory(key); return { mem: e!, duplicate: true, conflict: false, previousValue: existing?.value, previousUpdatedAt: existing?.updatedAt, previousUpdatedBy: existing?.updatedBy }; }\n    await this.db.setMemory(key, serialized, updatedBy, tags, ttl);"),
    ("M4 REPAIR: ws handleMemoryWrite suppresses the duplicate frame (F5 killed)", OWNED[1],
     "    this.memory.notifySubscribers(notification);",
     "    if (!duplicate && !conflict) this.memory.notifySubscribers(notification);"),
    ("M5 REPAIR: REST write notifies the pool (F6 killed)", OWNED[2],
     "      const { mem, duplicate, conflict, previousValue } = await this.memory.write(key, value ?? '', 'rest-api', tags ?? [], ttl ?? 0);",
     "      const { mem, duplicate, conflict, previousValue } = await this.memory.write(key, value ?? '', 'rest-api', tags ?? [], ttl ?? 0);\n      this.memory.notifySubscribers({ type: 'memory_write', key, value: mem.value, updatedBy: 'rest-api' });"),
    # M6 was LABELLED a pure rename and was NOT: renaming the method while its
    # callers keep the old name is a real behaviour change at runtime, so its
    # red is not evidence about the suite. Relabelled INVALID (R449-15 shape).
    ("M8 REPAIR OF F4: production subscribe() call site (must turn F4 red)", OWNED[1],
     "    this.memory.notifySubscribers(notification);",
     "    this.memory.subscribe('__r482_probe__', () => {});\n    this.memory.notifySubscribers(notification);"),
    ("M10 REPAIR OF F5: guard the PER-AGENT send loop, not notifySubscribers (M4 survived because this loop is a second delivery path)", OWNED[1],
     "    for (const [agentId, agent] of this.agents) {\n      if (agent.ws.readyState === 1) {\n        this.send(agent.ws, notification);\n      }\n    }",
     "    for (const [agentId, agent] of this.agents) {\n      if (agent.ws.readyState === 1 && !duplicate && !conflict) {\n        this.send(agent.ws, notification);\n      }\n    }"),
    ("M7 NEGATIVE CONTROL: no-op reference (the first attempt appended `{` and was a HARNESS)",
     OWNED[0],
     "    const serialized = typeof value === 'string' ? value : JSON.stringify(value);",
     "    const serialized = typeof value === 'string' ? value : JSON.stringify(value); void serialized;"),
]

# M9: F6's repair is only observable once F4 is false. Apply M5+M8 together.
COMBO = ("M9 M5+M8 TOGETHER: F6 repair becomes observable once a subscriber exists", [
    (OWNED[2], "      const { mem, duplicate, conflict, previousValue } = await this.memory.write(key, value ?? '', 'rest-api', tags ?? [], ttl ?? 0);",
     "      const { mem, duplicate, conflict, previousValue } = await this.memory.write(key, value ?? '', 'rest-api', tags ?? [], ttl ?? 0);\n      this.memory.notifySubscribers({ type: 'memory_write', key, value: mem.value, updatedBy: 'rest-api' });"),
    (OWNED[1], "    this.memory.notifySubscribers(notification);",
     "    this.memory.subscribe('__r482_probe__', () => {});\n    this.memory.notifySubscribers(notification);"),
])

results = []
# CONTROL FIRST (R479: a broken control is worse than a broken suite)
for p in OWNED:
    assert md5(p) == EXPECT[p], f"PRE-INJECTION: {p.name} is not the snapshot (dirty tree)"
label, verdict, detail = run("CONTROL")
results.append((label, verdict, detail))
print(f"{label}: {verdict} — {detail}", flush=True)

for name, path, old, new in ARMS:
    assert md5(path) == EXPECT[path], f"ABORT: {path.name} not at snapshot"
    try:
        mutate(path, old, new)
        label, verdict, detail = run(name)
        results.append((name, verdict, detail))
        print(f"{name}: {verdict} — {detail}", flush=True)
    finally:
        # restore IMMEDIATELY, per arm, byte-exact (R477/R481)
        path.write_bytes(BASE[path])  # BYTES restore; copyfile(bytes, path) is ENAMETOOLONG (r482 driver defect #1)
        assert md5(path) == EXPECT[path], f"RESTORE FAILED {path.name}"

# combo arm
for pth in OWNED:
    assert md5(pth) == EXPECT[pth], f"ABORT: {pth.name} not at snapshot"
try:
    for pth, old, new in COMBO[1]:
        mutate(pth, old, new)
    label, verdict, detail = run(COMBO[0])
    results.append((label, verdict, detail))
    print(f"{label}: {verdict} — {detail}", flush=True)
finally:
    for pth in OWNED:
        pth.write_bytes(BASE[pth])
        assert md5(pth) == EXPECT[pth], f"RESTORE FAILED {pth.name}"

print("\n=== SUMMARY ===")
for n, v, d in results:
    print(f"{v:9s} {n}")
bad = [p for p in OWNED if md5(p) != EXPECT[p]]
print("POST-MATRIX md5 mismatch:", bad or "none")
