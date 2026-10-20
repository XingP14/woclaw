"""R476 mutation matrix.

OWNED files (byte-snapshot restored, NEVER git checkout — tree has other rounds'
untracked scripts):
    hub/src/ws_server.ts   (send(): void -> boolean, ack derives from width)
    hub/src/db.ts          (delivered_to column absent/present)
    hub/src/rest_server.ts (rejection derived from the boolean / hardcoded)

Guard: assert every OWNED file is CLEAN in git BEFORE injecting.
"""
import hashlib, os, re, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HUB = os.path.join(ROOT, "hub")
SUITE = os.path.join(HUB, "test", "r476_delivery_outcome.test.ts")
OWNED: dict[str, bytes] = {
    "hub/src/ws_server.ts": None,
    "hub/src/db.ts": None,
    "hub/src/rest_server.ts": None,
}

TEST = ["npx", "vitest", "run", "test/r476_delivery_outcome.test.ts"]


def sh(*a, cwd=HUB):
    return subprocess.run(a, cwd=cwd, capture_output=True, text=True)


def dirty_owned():
    out = sh("git", "status", "--porcelain", "--", *OWNED, cwd=ROOT).stdout
    return [l for l in out.strip().splitlines() if l.strip()]


def snapshot():
    for rel in OWNED:
        src = os.path.join(ROOT, rel)
        OWNED[rel] = open(src, "rb").read()


def restore():
    for rel, blob in OWNED.items():
        with open(os.path.join(ROOT, rel), "rb") as f:
            if f.read() != blob:
                print(f"    restoring {rel}")
                with open(os.path.join(ROOT, rel), "wb") as f:
                    f.write(blob)


def arm(name, mutate, expect_kill):
    """expect_kill: test ids (regex) that must FAIL under the mutation, or [] to
    assert the mutation SURVIVES (recorded as an artefact, not a defect)."""
    blob = dict(OWNED)
    mutate()
    assert any(
        open(os.path.join(ROOT, r), "rb").read() != b for r, b in blob.items()
    ), f"{name}: MUTATION WAS A NO-OP — needle never matched"
    r = sh(*TEST)
    out = r.stdout + r.stderr
    failed = re.findall(r"^\s*(?:×|FAIL).*?> (.*)$", out, re.M)
    failed = [f.strip() for f in failed]
    restore()
    killed = [e for e in expect_kill if any(e in f for f in failed)]
    survived = [e for e in expect_kill if e not in killed]
    ok = not survived
    print(f"\n=== {name}: {'KILLED' if ok else 'SURVIVED'} ({len(failed)} failing)")
    for f in failed:
        print("    fail:", f[:150])
    if survived:
        print("    !! expected-fail arms that stayed green:", survived)
    return ok, failed


# ── arm 1: give send() a real boolean return ────────────────────────────────
def m1():
    p = os.path.join(ROOT, "hub/src/ws_server.ts")
    s = open(p).read()
    old = ("  private send(ws: WS, msg: OutboundMessage): void {\n"
           "    if (ws.readyState === 1) {\n"
           "      ws.send(JSON.stringify(msg));\n"
           "    }\n"
           "  }")
    assert s.count(old) == 1, f"M1 needle count={s.count(old)}"
    new = ("  private send(ws: WS, msg: OutboundMessage): boolean {\n"
           "    if (ws.readyState !== 1) return false;\n"
           "    ws.send(JSON.stringify(msg));\n"
           "    return true;\n"
           "  }")
    mutated = s.replace(old, new)
    assert mutated != s, "M1 no-op"
    open(p, "w").write(mutated)


# ── arm 2: ack gains a fanout-outcome field ────────────────────────────────
def m2():
    p = os.path.join(ROOT, "hub/src/ws_server.ts")
    s = open(p).read()
    old = "this.send(sender.ws, { ...message, sent: true });"
    assert s.count(old) == 1, "M2 needle not unique"
    new = ("const okCount = [...recipients].filter((id) => {\n"
           "        const a = this.agents.get(id);\n"
           "        return !!a && a.ws.readyState === 1;\n      }).length;\n"
           "      this.send(sender.ws, { ...message, sent: true, recipients: okCount });")
    mutated = s.replace(old, new)
    assert mutated != s, "M2 no-op"
    open(p, "w").write(mutated)


# ── arm 3: add a delivered_to column to BOTH DDLs ─────────────────────────
def m3():
    p = os.path.join(ROOT, "hub/src/db.ts")
    s = open(p).read()
    mutated = s
    for ddl in re.findall(r"CREATE TABLE IF NOT EXISTS messages \([^)]*\)", s):
        mutated = mutated.replace(ddl, ddl[:-1].rstrip() + ", delivered_to TEXT")
    assert mutated != s, "M3 no-op — no messages DDL matched"
    assert mutated.count("delivered_to TEXT") == s.count("CREATE TABLE IF NOT EXISTS messages"), \
        f"M3 must hit BOTH backends, not one"
    open(p, "w").write(mutated)


# ── arm 4: hardcode the delegation rejection (defeat the source pin) ──────
def m4():
    p = os.path.join(ROOT, "hub/src/rest_server.ts")
    new_full = open(p).read()
    mutated = new_full.replace(
        "if (!delivered) {",
        "if (true) {", 1)
    assert mutated != new_full, "M4 needle absent"
    open(p, "w").write(mutated)


ARMS = [
    ("M1 send() returns a delivery boolean", m1, ["D"]),
    ("M2 the ack carries the fanout width", m2, ["C acknowledgements"]),
    ("M3 the messages table gains delivered_to", m3, ["E the messages record"]),
    ("M4 the rejection is hardcoded, not derived", m4, ["F the hub DOES report"]),
]

if __name__ == "__main__":
    pre = dirty_owned()
    if pre:
        print("ABORT: OWNED files dirty before injection:\n  " + "\n  ".join(pre))
        sys.exit(2)
    snapshot()
    try:
        results = [arm(*a) for a in ARMS]
        ctrl = sh(*TEST)
        ctl_ok = " 6 passed" in ctrl.stdout or re.search(r"Tests\s+6 passed", ctrl.stdout)
        print(f"\n=== control run after all restores: {'GREEN' if ctl_ok else 'RED'}")
        for f in os.listdir(os.path.join(ROOT, "hub/src")):
            pass
        blobs_ok = all(
            open(os.path.join(ROOT, r), "rb").read() == b for r, b in OWNED.items()
        )
        print("=== byte-restore verified:", blobs_ok)
        print("=== SUMMARY killed:", sum(1 for ok, _ in results if ok), "/", len(results))
    finally:
        restore()
