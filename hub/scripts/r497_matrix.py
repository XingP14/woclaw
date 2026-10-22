#!/usr/bin/env python3
"""
R497 mutation matrix — prove the restore-plane suite actually kills the real
fixes, and that its negative controls really are no-ops.

Discipline carried from R456 / R469 / R475 / R482 / R496:
  * control FIRST (the suite must be green before any mutation);
  * OWNED-FILE snapshot/restore by BYTES (never `git checkout` -- R446-1:
    `git checkout` destroys other agents' uncommitted work; R475-2: assert
    the owned files are clean BEFORE injecting);
  * every injection asserts (a) the needle was found exactly N times and
    (b) the file actually CHANGED (R456-10c: `str.replace` returns the
    string unchanged when the needle is absent, and a `count==1` assertion
    still passes -- `assert new != old` is the check that catches it);
  * a mutation that fails to inject is reported as NOT-INJECTED, never
    counted as SURVIVED;
  * a tsc/compile failure is HARNESS, never SURVIVED.
"""
import hashlib, json, os, re, shutil, subprocess, sys, time

HUB = "/root/.hermes/workspace/woclaw/hub"
TEST = "test/r497_restore_verification.test.ts"
OWNED = ["src/crypto.ts", "src/rest_server.ts", "src/db.ts"]

def md5(path):
    try:
        return hashlib.md5(open(path, "rb").read()).hexdigest()
    except FileNotFoundError:
        return None

def snapshot():
    return {f: open(os.path.join(HUB, f), "rb").read() for f in OWNED}

def restore(snap):
    for f, data in snap.items():
        with open(os.path.join(HUB, f), "wb") as fh:
            fh.write(data)

def clean_check():
    """The owned files must be unmodified vs git HEAD before we inject."""
    r = subprocess.run(["git", "status", "--short", "--"] + OWNED,
                       cwd=HUB, capture_output=True, text=True)
    return r.stdout.strip() == "", r.stdout.strip()

def inject(f, old, new, expect_count=1):
    """Returns (status, detail). status in: injected | not-injected."""
    p = os.path.join(HUB, f)
    before = open(p, "r", encoding="utf-8").read()
    n = before.count(old)
    if n != expect_count:
        return "not-injected", f"needle count {n} != {expect_count}"
    after = before.replace(old, new, expect_count)
    if after == before:
        # R456-10c: the needle was absent in the sense that mattered.
        return "not-injected", "replacement was a no-op"
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(after)
    return "injected", f"{expect_count} site(s)"

def run_suite():
    r = subprocess.run(
        ["npx", "vitest", "run", TEST, "--reporter=basic"],
        cwd=HUB, capture_output=True, text=True, timeout=420)
    out = r.stdout + r.stderr
    # R482-10(2): "has a Tests line" is NOT a sufficient discriminator, and
    # neither is counting the ✓/× glyphs -- with --reporter=basic the glyph
    # count is the number of TEST FILES (1), not the number of tests (7).
    # Parse the summary line explicitly:
    #   "Tests  7 passed (7)"            -> 7 passed, 0 failed
    #   "Tests  1 failed | 6 passed (7)" -> 6 passed, 1 failed
    m = re.search(r"Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed", out)
    if m:
        failed = int(m.group(1) or 0)
        passed = int(m.group(2))
    else:
        # Fall back to the verbose reporter's per-test lines.
        passed = len(re.findall(r"^\s*✓\s", out, re.M))
        failed = len(re.findall(r"^\s*×\s", out, re.M))
    # Sanity: the suite has a known size. If the parser disagrees with it,
    # treat that as a PARSER failure, not as a green control.
    return passed, failed, out

EXPECTED_TESTS = 7

MUTATIONS = [
    # ---- the REAL FIXES. Each is what a maintainer would actually write. ----
    ("M1", "src/crypto.ts",
     # Real fix, half 1: make the decrypt failure VISIBLE instead of silent.
     "  try {\n    return deserializeAndDecrypt(value, provider);\n  } catch {\n    // If decryption fails (e.g. wrong passphrase, corrupted data), return as-is\n    return value;\n  }",
     "  try {\n    return deserializeAndDecrypt(value, provider);\n  } catch {\n    throw new Error('[Encryption] Decryption failed: wrong passphrase or corrupted value');\n  }",
     "crypto.ts safeDecryptValue throws instead of swallowing"),

    ("M2", "src/rest_server.ts",
     # NEGATIVE CONTROL (was the M2/M2b split): make handleReady async but
     # add NO check. A signature change with no behaviour change must NOT
     # kill the suite -- if it does, the suite is detecting the shape of
     # the code rather than the behaviour.
     "  private handleReady(res: http.ServerResponse): void {",
     "  private async handleReady(res: http.ServerResponse): Promise<void> {",
     "rest_server.ts handleReady: sync -> async, NO check added (negative control)"),

    ("M2b", "src/rest_server.ts",
     # Real fix (the actual check): /ready probes for still-sealed values.
     # Self-contained: it ALSO makes handleReady async, because a probe that
     # awaits cannot live inside a `void` function. (M2 alone -- the
     # signature change by itself -- is a no-op probe and is expected to
     # SURVIVE; that is the point of the pair.)
     "  private handleReady(res: http.ServerResponse): void {\n    const checks: Record<string, { ok: boolean; detail?: string }> = {\n      db: { ok: this.db != null },\n      topics: { ok: this.topics != null },\n      memoryPool: { ok: this.memory != null },\n      wsServer: { ok: this.wsServer != null }\n    };\n    const allOk = Object.values(checks).every(c => c.ok);",
     "  private async handleReady(res: http.ServerResponse): Promise<void> {\n    const checks: Record<string, { ok: boolean; detail?: string }> = {\n      db: { ok: this.db != null },\n      topics: { ok: this.topics != null },\n      memoryPool: { ok: this.memory != null },\n      wsServer: { ok: this.wsServer != null },\n      decryptable: { ok: true, detail: 'unchecked' }\n    };\n    try {\n      const all = await this.memory.getAll('all');\n      const sealed = all.filter(m => typeof m.value === 'string' && m.value.startsWith('ENC:v1:'));\n      checks.decryptable = { ok: sealed.length === 0, detail: sealed.length + ' undecryptable' };\n    } catch { checks.decryptable = { ok: false, detail: 'probe threw' }; }\n    const allOk = Object.values(checks).every(c => c.ok);",
     "rest_server.ts /ready gains a REAL decryptability check (self-contained)"),

    ("M3b", "src/db.ts",
     # Real fix, half 2: the storage layer refuses to serve an unreadable value.
     # R475-3: the needle must be UNIQUE. The three-line body occurs TWICE
     # (the SQLite class and the MySQL class), so it is anchored on the
     # SQLite-only SQL fragment (`FROM memory` + `WHERE key = ?` without
     # backticks) that only the SQLite class has.
     "    `).get(key) as MemoryRowSqlite | undefined;\n    if (!row) return undefined;\n\n    const mem = mapMemoryRow(row);\n    mem.value = safeDecryptValue(mem.value, this.encryption);\n    if (mem.expireAt > 0 && mem.expireAt < Date.now()) {",
     "    `).get(key) as MemoryRowSqlite | undefined;\n    if (!row) return undefined;\n\n    const mem = mapMemoryRow(row);\n    mem.value = safeDecryptValue(mem.value, this.encryption);\n    if (this.encryption.enabled && mem.value.startsWith('ENC:v1:')) {\n      throw new Error('[Encryption] stored value could not be decrypted');\n    }\n    if (mem.expireAt > 0 && mem.expireAt < Date.now()) {",
     "db.ts getMemory REFUSES to serve a still-sealed value (the real fix)"),

    # ---- NEGATIVE CONTROLS: must NOT kill the suite ----
    ("M4", "src/crypto.ts",
     "export function safeDecryptValue(value: string, provider: EncryptionProvider): string {",
     "export function safeDecryptValue(value: string, provider: EncryptionProvider): string {\n  // negative control: a comment that changes nothing",
     "crypto.ts: pure comment added (no behaviour change)"),

    ("M5", "src/rest_server.ts",
     "    const allOk = Object.values(checks).every(c => c.ok);",
     "    const allOk = Object.values(checks).every(c => c.ok !== false);",
     "rest_server.ts: equivalent boolean expression (no behaviour change)"),

    ("M6", "src/crypto.ts",
     "  if (enabled && (!passphrase || passphrase.length < 8)) {\n    throw new Error('[Encryption] Passphrase must be at least 8 characters when encryption is enabled');\n  }",
     "  if (enabled && (!passphrase || passphrase.length < 8)) {\n    throw new Error('[Encryption] Passphrase must be at least 8 characters when encryption is enabled');\n  }\n  // negative control: comment only",
     "crypto.ts: comment added next to the passphrase guard (no behaviour change)"),
]

def main():
    print("=" * 78)
    print("R497 MUTATION MATRIX")
    print("=" * 78)

    ok, dirty = clean_check()
    if not ok:
        print(f"ABORT: owned files are not clean vs HEAD:\n{dirty}")
        return 2
    print("pre-check: owned files clean vs HEAD  [OK]")

    snap = snapshot()
    base_md5 = {f: md5(os.path.join(HUB, f)) for f in OWNED}
    print("baseline md5:", {k: v[:8] for k, v in base_md5.items()})

    print("\n--- CONTROL (must be green before any mutation) ---")
    p, f, out = run_suite()
    print(f"control: {p} passed / {f} failed (expected {EXPECTED_TESTS} passed / 0 failed)")
    if f != 0 or p != EXPECTED_TESTS:
        print("CONTROL NOT GREEN -- aborting")
        print(out[-3000:])
        restore(snap)
        return 3

    results = []
    for mid, f_, old, new, desc in MUTATIONS:
        print(f"\n--- {mid}: {desc} ---")
        restore(snap)
        status, detail = inject(f_, old, new)
        if status != "injected":
            print(f"  {mid} NOT-INJECTED ({detail}) -- NOT counted as SURVIVED")
            results.append((mid, desc, "NOT-INJECTED"))
            continue
        after_md5 = md5(os.path.join(HUB, f_))
        if after_md5 == base_md5[f_]:
            print(f"  {mid} NOT-INJECTED (md5 unchanged) -- NOT counted as SURVIVED")
            results.append((mid, desc, "NOT-INJECTED"))
            restore(snap)
            continue
        # tsc gate: a compile error is HARNESS, never SURVIVED
        tsc = subprocess.run(["npx", "tsc", "--noEmit"], cwd=HUB,
                             capture_output=True, text=True, timeout=300)
        if tsc.returncode != 0:
            print(f"  {mid} HARNESS (tsc failed) -- NOT counted as SURVIVED")
            print("   ", (tsc.stdout + tsc.stderr).strip().splitlines()[-1][:160] if (tsc.stdout + tsc.stderr).strip() else "")
            results.append((mid, desc, "HARNESS"))
            restore(snap)
            continue
        p2, f2, out2 = run_suite()
        if f2 > 0:
            verdict = "KILLED"
            detail2 = f"{f2} arm(s) red"
        else:
            verdict = "SURVIVED"
            detail2 = "suite stayed green"
        print(f"  {mid} {verdict}: {detail2}")
        results.append((mid, desc, verdict))
        restore(snap)
        # verify the restore really restored
        if md5(os.path.join(HUB, f_)) != base_md5[f_]:
            print(f"  !! RESTORE FAILED for {f_}")
            return 4

    print("\n--- POST-CONTROL (suite must be green again) ---")
    p3, f3, out3 = run_suite()
    print(f"post-control: {p3} passed / {f3} failed (expected {EXPECTED_TESTS} passed / 0 failed)")
    if f3 != 0 or p3 != EXPECTED_TESTS:
        print("POST-CONTROL RED -- aborting")
        print(out3[-3000:])
        return 5

    print("\n" + "=" * 78)
    print("SUMMARY")
    for mid, desc, verdict in results:
        print(f"  {mid:4} {verdict:14} {desc}")
    killed = sum(1 for _, _, v in results if v == "KILLED")
    survived = sum(1 for _, _, v in results if v == "SURVIVED")
    ni = sum(1 for _, _, v in results if v == "NOT-INJECTED")
    harness = sum(1 for _, _, v in results if v == "HARNESS")
    print(f"\n  KILLED={killed}  SURVIVED={survived}  NOT-INJECTED={ni}  HARNESS={harness}")
    print(f"  final md5 match: {all(md5(os.path.join(HUB, f)) == base_md5[f] for f in OWNED)}")
    print("=" * 78)
    return 0

if __name__ == "__main__":
    sys.exit(main())
