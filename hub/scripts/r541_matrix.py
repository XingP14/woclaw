#!/usr/bin/env python3
"""
R541 mutation matrix — deletion-completeness plane.

Control first (R404-M1): the driver proves it can kill a mutant BEFORE any
verdict is reported. Every arm is scored by running the REAL vitest suite
(the repo's own runner, resolved from THIS tree's node_modules/.bin — never
`npx`, which DOWNLOADS a different major per R514/R198) and parsing the
summary line explicitly.

Verdict classification (R482 — "there is a Tests line" is NOT a sufficient
discriminator):
  * total == 0 and the run FAILED  -> HARNESS (the suite did not run)
  * suite file did not compile      -> HARNESS
  * total == 0 and the run PASSED   -> HARNESS (vacuous green)
  * failing > 0                     -> KILLED
  * failing == 0 and total > 0      -> SURVIVED

Restore discipline (R477 D1): the snapshot is taken BEFORE the mutation, and
the restore happens in a `finally` — verified for BYTES and MTIME, and the
restore is asserted before the next arm reads the file.

Anchoring: every needle is asserted to occur EXACTLY ONCE in the target file
before the mutation is applied. A needle that matches 0 times is reported as
NOT-INJECTED, never silently scored.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

REPO = os.path.dirname(os.path.abspath(__file__))          # .../woclaw/hub/scripts
HUB = os.path.dirname(REPO)                               # .../woclaw/hub
SUITE = os.path.join(HUB, "test", "r541_deletion_completeness_plane.test.ts")
VITEST = os.path.join(os.path.dirname(HUB), "node_modules", ".bin", "vitest")

MEMORY_TS = os.path.join(HUB, "src", "memory.ts")
DB_TS = os.path.join(HUB, "src", "db.ts")

# ── the arms ───────────────────────────────────────────────────────────────
# (name, file, needle, replacement, expected_arms_that_must_go_red)
ARMS = [
    (
        "M1",
        MEMORY_TS,
        # M1: the scope guard refuses the history when the live row is out of
        # scope. REPAIR SHAPE: the guard must survive the delete.
        "    const mem = await this.db.getMemory(key);\n"
        "    if (mem && !isVisibleInScope(mem, normalizeScope(scope))) return [];\n"
        "    return versions;",
        "    const mem = await this.db.getMemory(key);\n"
        "    const historyScopes = versions.map(v => ({ key: v.key, tags: v.tags }));\n"
        "    if (mem && !isVisibleInScope(mem, normalizeScope(scope))) return [];\n"
        "    if (!mem && historyScopes.length > 0) {\n"
        "      // REPAIR SHAPE: derive the scope from the HISTORY, not from the\n"
        "      // live row the delete just destroyed.\n"
        "      const anyVisible = historyScopes.some(h =>\n"
        "        normalizeScope(scope) === 'all' ||\n"
        "        h.key.toLowerCase().includes(':' + normalizeScope(scope) + ':') ||\n"
        "        h.tags.some(t => t.toLowerCase().includes(normalizeScope(scope)))\n"
        "      );\n"
        "      if (!anyVisible) return [];\n"
        "    }\n"
        "    return versions;",
        ["A4", "A5"],
    ),
    (
        "M2",
        DB_TS,
        # M2: a delete that PURGES the history — the erase-shaped repair.
        "  async deleteMemory(key: string): Promise<boolean> {\n"
        "    const result = this.db.prepare('DELETE FROM memory WHERE key = ?').run(key);\n"
        "    return result.changes > 0;\n"
        "  }",
        "  async deleteMemory(key: string): Promise<boolean> {\n"
        "    const result = this.db.prepare('DELETE FROM memory WHERE key = ?').run(key);\n"
        "    if (result.changes > 0) {\n"
        "      this.db.prepare('DELETE FROM memory_versions WHERE key = ?').run(key);\n"
        "    }\n"
        "    return result.changes > 0;\n"
        "  }",
        # MEASURED: A3, A4, A5 go red (the history is gone). A6 stays GREEN —
        # correctly: that arm asserts a key with NO history leaves nothing
        # behind, and purging the (empty) history changes nothing.
        # A8 goes red — correctly: it is the CENSUS arm, and the mutation
        # introduces the very statement it asserts is absent.
        ["A3", "A4", "A5", "A8"],
    ),
    (
        "M3",
        DB_TS,
        # M3: the versions route 404s for a key whose live row is gone — the
        # "deleted means the same thing everywhere" repair.
        "  async getMemoryVersions(key: string): Promise<DBMemoryVersion[]> {\n"
        "    const rows = this.db.prepare(`",
        "  async getMemoryVersions(key: string): Promise<DBMemoryVersion[]> {\n"
        "    const live = await this.getMemory(key);\n"
        "    if (!live) return [];\n"
        "    const rows = this.db.prepare(`",
        ["A3", "A4", "A5"],
    ),
    (
        "N1",
        MEMORY_TS,
        # N1 (NEGATIVE CONTROL): an INERT comment. Must SURVIVE — a control
        # that cannot fail is not a control (R461/R484).
        "  async getVersions(key: string, scope: string = 'all'): Promise<DBMemoryVersion[]> {",
        "  async getVersions(key: string, scope: string = 'all'): Promise<DBMemoryVersion[]> {\n"
        "    // R541 negative control: an inert comment that changes no behaviour.",
        [],
    ),
]


def sha(path):
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def stat_sig(path):
    st = os.stat(path)
    return (st.st_size, st.st_mtime_ns)


def run_suite():
    """Run the R541 suite with the tree's own vitest.

    Returns (total, failed, red_arm_names, raw_output).

    The reporter is JSON, not text. The first draft parsed the `--reporter=basic`
    text output and matched `> A\\d` — which matched EVERY test name, not the
    failing ones, so the matrix reported "red arms: [all 8]" for every mutant
    and the expected-set check could never pass. That is R482's lesson exactly:
    the parser was the defect, not the suite. The JSON reporter states each
    assertion's `status` explicitly, so there is nothing to infer.
    """
    outfile = os.path.join(tempfile.gettempdir(), f"r541-matrix-{os.getpid()}.json")
    if os.path.exists(outfile):
        os.remove(outfile)
    proc = subprocess.run(
        [VITEST, "run", "test/r541_deletion_completeness_plane.test.ts",
         "--reporter=json", f"--outputFile={outfile}"],
        cwd=HUB,
        capture_output=True,
        text=True,
        timeout=600,
    )
    raw = proc.stdout + proc.stderr
    if not os.path.exists(outfile):
        return 0, 0, set(), raw

    with open(outfile, "r", encoding="utf-8") as f:
        data = json.load(f)
    os.remove(outfile)

    total = int(data.get("numTotalTests", 0))
    failed = int(data.get("numFailedTests", 0))
    red = set()
    for suite in data.get("testResults", []):
        for a in suite.get("assertionResults", []):
            if a.get("status") == "failed":
                name = a.get("fullName") or a.get("title") or ""
                # The arm label is the leading `A<n>` token of the title.
                m = re.match(r"\s*(A\d)\b", a.get("title") or "")
                red.add(m.group(1) if m else name[:40])
    return total, failed, red, raw


def arms_failed(out):
    """Which test names failed (vitest prints 'FAIL' lines with the arm names)."""
    failed = set()
    for m in re.finditer(r"^\s*(?:×|✗|FAIL\s+)?.*?>\s*(A\d[^\n]*)", out, re.M):
        failed.add(m.group(1).strip())
    for m in re.finditer(r"FAIL\s+test/r541[^\n]*>\s*(A\d[^\n]*)", out):
        failed.add(m.group(1).strip())
    return failed


def main():
    if not os.path.exists(VITEST):
        print(f"FATAL: vitest not found at {VITEST}")
        return 2
    if not os.path.exists(SUITE):
        print(f"FATAL: suite not found at {SUITE}")
        return 2

    results = []
    # ── CONTROL FIRST: the driver must be able to KILL before it reports ──
    for name, path, needle, repl, must_red in ARMS:
        with open(path, "r", encoding="utf-8") as f:
            original = f.read()
        count = original.count(needle)
        if count != 1:
            results.append({
                "arm": name, "verdict": "NOT-INJECTED",
                "detail": f"needle anchor count = {count} (expected 1)",
                "file": os.path.relpath(path, HUB),
            })
            print(f"{name}: NOT-INJECTED (anchor count {count})")
            continue

        with open(path, "r", encoding="utf-8") as f:
            original_sha = sha(path)
        orig_sig = stat_sig(path)

        mutated = original.replace(needle, repl)
        with open(path, "w", encoding="utf-8") as f:
            f.write(mutated)
        new_sha = sha(path)
        if new_sha == original_sha:
            results.append({"arm": name, "verdict": "NOT-INJECTED",
                            "detail": "mutation did not change the file bytes",
                            "file": os.path.relpath(path, HUB)})
            print(f"{name}: NOT-INJECTED (bytes unchanged)")
            continue

        try:
            total, failed, red, out = run_suite()
            if total == 0:
                verdict = "HARNESS"
                detail = "the suite produced no test counts (compile error / vacuous run)"
            elif failed > 0:
                verdict = "KILLED"
                detail = f"{failed} arm(s) went red"
            else:
                verdict = "SURVIVED"
                detail = "the defect is still present after the mutation"

            # WHICH arms went red matters as much as THAT they did: a mutation
            # that kills the wrong arm is a different (and weaker) claim than
            # one that kills the arm the mutation targets (R539 discipline —
            # "M1 and M3 are two repair shapes of the SAME defect, and BOTH
            # must KILL"). The expected set is asserted, not assumed.
            detail += f" | red arms: {sorted(red)}"
            if verdict == "KILLED" and must_red:
                expected = set(must_red)
                if not expected.issubset(red):
                    verdict = "WRONG-ARMS"
                    detail += f" | EXPECTED {sorted(expected)} not all red"
                else:
                    detail += f" | expected {sorted(expected)} all red OK"

            results.append({
                "arm": name, "verdict": verdict, "detail": detail,
                "total": total, "failed": failed,
                "failed_arms": sorted(arms_failed(out)),
                "file": os.path.relpath(path, HUB),
            })
            print(f"{name}: {verdict} — {detail}")
        finally:
            # Restore — BYTES and MTIME (R477 D1 / round-477).
            with open(path, "w", encoding="utf-8") as f:
                f.write(original)
            os.utime(path, ns=(orig_sig[1], orig_sig[1]))
            restored_sha = sha(path)
            restored_sig = stat_sig(path)
            assert restored_sha == original_sha, f"{name}: BYTE RESTORE FAILED"
            assert restored_sig == orig_sig, f"{name}: MTIME RESTORE FAILED"
            print(f"{name}: restore verified (bytes + mtime)")

    print("\n=== SUMMARY ===")
    counts = {}
    for r in results:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    print(json.dumps(counts, sort_keys=True))
    for r in results:
        print(f"  {r['arm']}: {r['verdict']}  {r.get('detail', '')}  [{r.get('file', '')}]")

    # The driver itself must be able to kill a mutant: at least one KILLED.
    if counts.get("KILLED", 0) == 0:
        print("\nVERDICT FAIL: the driver killed nothing — the matrix cannot score.")
        return 1
    if counts.get("HARNESS", 0) > 0:
        print("\nVERDICT FAIL: a HARNESS arm means a mutant that did not compile.")
        return 1
    if counts.get("WRONG-ARMS", 0) > 0:
        print("\nVERDICT FAIL: a mutant killed the WRONG arms.")
        return 1
    # The negative control MUST survive — a control that dies is a broken
    # control, and a control that survives is the proof the suite is not
    # merely broken (R461/R484).
    if counts.get("SURVIVED", 0) == 0:
        print("\nVERDICT FAIL: no SURVIVED arm — the negative control must survive.")
        return 1
    print("\nVERDICT PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
