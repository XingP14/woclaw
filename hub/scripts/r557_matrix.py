#!/usr/bin/env python3
"""R557 mutation matrix — the route-offset plane.

RULES LEARNED THE HARD WAY (this is the fourth round to pay them):

  * CONTROL FIRST. Run the suite unmodified and require it GREEN before
    injecting anything. A red control means the matrix is measuring nothing.
  * BYTE-LEVEL RESTORE, never `git checkout --`. R469-8b: `git checkout`
    silently destroys UNCOMMITTED work by another writer. We snapshot the
    bytes of every file we touch and write them back.
  * THE EXTRACTOR MUST NOT BE GUIDED BY THE EXPECTATION (R556 P4). Enumerate
    EVERY failing test in the output, independent of what we expected.
  * `assert new != old` AND the needle must be UNIQUE (R456-1, R475-3).
    A needle that matches twice would edit the wrong copy; we REFUSE to
    inject rather than silently corrupt. In v1 of this driver, `path.slice(14)`
    matched BOTH `/graph/edges/` and `/graph/paths/` ⇒ NOT-INJECTED for M1.
  * THE GIT ROOT IS THE REPO ROOT, not `hub/` (R552-13 / R555-18).
  * PATHS ARE DERIVED FROM `__file__`, never hard-coded (R510/R511).
  * EXPECTED RED ARM SETS ARE WRITTEN, NOT GUESSED. v1 of this driver
    predicted M7's red set as {4} and was wrong: the observed set was
    {3, 4, 4b} — because M7 (strip the leading slash on /sessions/) also
    changes the DERIVATION output that arms 3 and 4b read. The observed set
    is the truth; the prediction was the artefact.
"""
import hashlib
import re
import subprocess
import sys
from pathlib import Path

HUB = Path(__file__).resolve().parents[1]
REPO = HUB.parent
REST = HUB / "src" / "rest_server.ts"

MUTATIONS = [
    (
        "M1", "const edgeId = decodeURIComponent(path.slice(14));",
        "const edgeId = decodeURIComponent(path.slice(13));",
        "KILLED", {"0b", "0c", "1", "1b"},
        "the REAL repair for /graph/edges/: fix the offset",
    ),
    (
        "M2", "const parts = decodeURIComponent(path.slice(14)).split('/');",
        "const parts = decodeURIComponent(path.slice(13)).split('/');",
        "KILLED", {"0b", "0c", "2"},
        "the REAL repair for /graph/paths/: fix the offset",
    ),
    (
        "M3", "const topic = decodeURIComponent(path.slice(8));",
        "const topic = decodeURIComponent(path.slice(9));",
        "KILLED", {"0b", "0c", "3", "3b"},
        "the REAL repair for /streams/: fix the offset",
    ),
    (
        "M4", "const id = decodeURIComponent(path.slice(9));",
        "const id = decodeURIComponent(path.slice(10));",
        "KILLED", {"0b", "0c", "4", "4b"},
        "the REAL repair for /sessions/: fix the offset",
    ),
    (
        "M5", "// v1.0: Session Memory routes",
        "// v1.0: Session Memory routes\n    // NOTE: slices are hand-computed offsets",
        "SURVIVED", set(),
        "a LAZY mutation: a comment that changes no behaviour",
    ),
    (
        "M6", "const edgeId = decodeURIComponent(path.slice(14));",
        "const edgeId = decodeURIComponent(path.slice(14) + '');",
        "SURVIVED", set(),
        "a LAZY mutation: a no-op string concat",
    ),
    (
        "M7", "const edgeId = decodeURIComponent(path.slice(14));",
        "const edgeId = decodeURIComponent(path.slice(14).toUpperCase());",
        "KILLED", {"1"},
        "a WRONG-SHAPE repair: upper-casing the id breaks the lookup",
    ),
    (
        "M8", "const id = decodeURIComponent(path.slice(9));",
        "const id = decodeURIComponent(path.slice(9).replace(/^\\//, ''));",
        "KILLED", {"4", "4b"},
        "a PARTIAL repair on /sessions/: strips the leading slash",
    ),
]


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def run_suite() -> str:
    r = subprocess.run(
        ["npx", "vitest", "run", "test/r557_route_offset_plane.test.ts"],
        cwd=HUB, capture_output=True, text=True, timeout=600,
    )
    return r.stdout + r.stderr


ARM_RE = re.compile(r"R557 — the route-offset plane > ([\w.]+?)(?:\s|$)")

# the arm names this suite defines — the extractor's vocabulary
KNOWN_ARMS = ["0", "0b", "0c", "1", "1b", "1c", "2", "3", "3b", "4", "4b", "4c", "5", "6"]


def extract_red_arms(output: str) -> set[str]:
    """Every arm that FAILED, found WITHOUT consulting any expectation."""
    arms: set[str] = set()
    for line in output.split("\n"):
        m = re.search(r"FAIL\s+\S+\s+>\s+(.+?)(?:\s+\d+ms)?$", line)
        if m:
            a = ARM_RE.search(m.group(1))
            if a:
                arms.add(a.group(1).rstrip("."))
    return arms


def extractor_selfcheck() -> None:
    """Prove the extractor can see EVERY arm name, including the suffixed
    ones.

    🔴 R557's own driver bug: the regex ended with a bare non-greedy
    `([\\w.]+?)`, so it matched the SHORTEST arm name and truncated
    `0b` → `0`, `0c` → `0`, `4b` → `4`. Every "WRONG RED ARM SET" verdict
    in the v2 matrix run was the EXTRACTOR, not the suite.

    A regex that silently truncates arm names is a driver bug that looks
    exactly like a suite bug — and it survived one full matrix run. Hence
    this self-check runs BEFORE any injection."""
    for arm in KNOWN_ARMS:
        synthetic = f" FAIL  test/x.test.ts > R557 — the route-offset plane > {arm}. SOME TITLE\n"
        got = extract_red_arms(synthetic)
        assert got == {arm}, f"extractor mis-reads arm {arm!r}: got {got}"


def count_failures(output: str) -> int:
    m = re.search(r"Tests\s+(\d+)\s+failed", output)
    if m:
        return int(m.group(1))
    m = re.search(r"Tests\s+(?:\d+ failed \| )?(\d+) failed", output)
    return int(m.group(1)) if m else 0


def main() -> int:
    # ── PRE-FLIGHT (R557's own lessons) ─────────────────────────────────
    # 1. the extractor self-check — a regex that truncates arm names looks
    #    exactly like a suite bug, and it cost one full matrix run.
    extractor_selfcheck()
    print("extractor self-check ✓")

    # 2. the tree must be CLEAN before we start. R557's first matrix run was
    #    corrupted because the file was dirty (a concurrent writer's edit),
    #    and the byte-level restore then fought that edit.
    dirty = subprocess.run(
        ["git", "status", "--short", "--", "src/"],
        cwd=HUB, capture_output=True, text=True).stdout.strip()
    if dirty:
        print(f"<<< src/ is DIRTY — refusing to run the matrix:\n{dirty}")
        return 3
    print("src/ clean ✓")

    base_bytes = REST.read_bytes()
    base_md5 = hashlib.md5(base_bytes).hexdigest()
    print(f"baseline {REST.relative_to(REPO)} md5={base_md5}")

    print("\n=== CONTROL (unmodified) ===")
    out = run_suite()
    fails = count_failures(out)
    print(f"  failed_tests={fails}")
    if fails != 0:
        print("  <<< CONTROL IS RED — the matrix would measure nothing. ABORT.")
        print(out[-4000:])
        return 2
    print("  control GREEN ✓")

    results = []
    for name, needle, repl, expect, exp_arms, why in MUTATIONS:
        print(f"\n=== {name} — {why} ===")
        text = REST.read_text()
        n = text.count(needle)
        if n != 1:
            print(f"  NOT-INJECTED: needle occurs {n} times (need exactly 1)")
            results.append((name, "NOT-INJECTED", set(), expect, exp_arms))
            continue
        mutated = text.replace(needle, repl)
        if mutated == text:
            print("  NOT-INJECTED: replacement produced no change")
            results.append((name, "NOT-INJECTED", set(), expect, exp_arms))
            continue
        REST.write_text(mutated)
        after = md5(REST)
        if after == base_md5:
            print("  NOT-INJECTED: file md5 unchanged after write")
            REST.write_bytes(base_bytes)
            results.append((name, "NOT-INJECTED", set(), expect, exp_arms))
            continue
        try:
            out = run_suite()
            fails = count_failures(out)
            arms = extract_red_arms(out)
            verdict = "KILLED" if fails > 0 else "SURVIVED"
            print(f"  failed_tests={fails} verdict={verdict}")
            print(f"  observed red arms: {sorted(arms) or '(none)'}")
            print(f"  expected red arms: {sorted(exp_arms) or '(none)'}")
            if arms != exp_arms:
                verdict = "WRONG-ARMS"
                print("  <<< WRONG RED ARM SET")
            results.append((name, verdict, arms, expect, exp_arms))
        finally:
            REST.write_bytes(base_bytes)
            restored = md5(REST)
            assert restored == base_md5, "RESTORE FAILED"
            print(f"  restored md5={restored} ✓")

    print("\n" + "=" * 74)
    print("VERDICT TABLE")
    print(f"{'mut':4} {'verdict':16} {'expected':10} {'ok':5} red arms")
    print("-" * 74)
    ok = True
    for name, verdict, arms, expect, exp_arms in results:
        good = verdict == expect
        ok = ok and good
        print(f"{name:4} {verdict:16} {expect:10} {'OK' if good else '<<<':5} {sorted(arms) or '(none)'}")
    print("=" * 74)
    print("VERDICT PASS" if ok else "VERDICT FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
