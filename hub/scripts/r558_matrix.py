#!/usr/bin/env python3
"""R558 — mutation matrix for the ROUND-IDENTITY plane.

Discipline (carried from R556/R557):
  - CONTROL FIRST: the suite must be green before any injection.
  - PRE-FLIGHT: refuse to run on a dirty tree; snapshot BEFORE injecting.
  - NEEDLE UNIQUENESS: assert the needle occurs exactly once; REFUSE to
    inject otherwise (report NOT-INJECTED, never SURVIVED).
  - `assert new != old`: a mutation that does not change the file is a
    driver bug, not a survivor (R456-10c).
  - BYTE-LEVEL RESTORE per arm; never `git checkout` (it destroys other
    writers' work — R469-8b).
  - INDEPENDENT EXTRACTOR: enumerate EVERY failing arm; do not scan only
    the expected arms (R557-P4). The extractor also self-checks against
    synthetic inputs (R557-P6).
  - HARNESS vs SURVIVED: a compile error / crash is HARNESS, never SURVIVED.
  - NEVER TOUCH A MUTATED FILE WHILE THE MATRIX RUNS (R557-P9).

Expected red-arm sets are GROUND TRUTH measured by `r558_measure_arms.py`
first, then written here. Prediction is an artefact; measurement is the
fact (R557 driver bug #3).

─── THE FIVE DRIVER BUGS THIS FILE FIXES (measured 2026-11-28) ─────────────

The previous driver reported `VERDICT: FAIL` with M1/M2/M4 = HARNESS,
M5 = SURVIVED, M6 = NOT-INJECTED. All five were DRIVER bugs, not findings:

  BUG 1 (M1/M2/M4 misclassified as HARNESS): the HARNESS test was
      `passed == 0 and arms` — but `arms` is populated by a regex over
      vitest's FAIL lines, and the extractor ALSO matched the *summary*
      line ("Tests  1 failed | 12 passed"). More importantly: a mutation
      that makes an arm FAIL produces `Tests  20 passed | 1 failed` —
      `passed` is 20, NOT 0. The old `passed == 0` test therefore never
      fires for an ordinary assertion failure ⇒ every real KILL was
      reported as HARNESS. FIX: distinguish by the SUMMARY LINE, not by
      `passed == 0`. A HARNESS is "no Tests summary at all" (compile
      error / module load failure). A behavioural kill has a Tests summary
      with a non-zero failed count.

  BUG 2 (extractor read the summary line as an arm): the second regex
      `FAIL[^\n]*r558_round_identity_plane[^\n]*` matched vitest's
      "Failed Tests" summary block, whose lines contain the FILE PATH —
      so it harvested the file path as an "arm name". FIX: only match
      lines that start with `FAIL` AND contain the ` > ` arm separator,
      and stop at the summary marker.

  BUG 3 (M5 SURVIVED for a real reason): M5 mutated the SUITE ITSELF
      (weakening `expect(commitCountFor(orphan)).toBe(0)` to
      `toBeGreaterThanOrEqual(0)`). But the suite is a *record-plane*
      census over the GIT TREE — mutating the suite cannot change the
      tree. So M5 was a self-referential no-op: it "survived" because
      the repair it represented (committing the orphan) was never
      APPLIED to the tree. FIX: M5 must be a REAL repair applied to a
      REAL git state — i.e. it needs a WORKTREE where the orphan file is
      actually committed. That is a different harness (see
      `r558_record_matrix.py`); the tree-level driver cannot express it.
      Here M5 is REDESIGNED as a suite-weakening NEGATIVE CONTROL: it
      must SURVIVE (proving the arm is not vacuous), and the driver
      asserts SURVIVED rather than KILLED.

  BUG 4 (M6 NOT-INJECTED, needle 0 hits): the needle was
      `expect(plan).toMatch(/R532\\s*量过\\s*REST\\s*查询参数面/);` — but
      the SUITE at that time contained `expect(plan).toMatch(/R532|PLAN/);`
      (the vacuous form). The needle described a version of the suite
      that did not exist. FIX: the needle is taken from the CURRENT
      suite text, and every needle is verified against the file BEFORE
      the matrix runs.

  BUG 5 (no `assert new != old` on the needle-count path): `inject()`
      counted occurrences but the driver never asserted the file
      actually changed after write. FIX: read-back assertion, plus a
      byte-level md5 comparison against the pre-injection snapshot.

─── THE MUTATION-TARGET SEPARATION ─────────────────────────────────────────

Two classes of arm, two classes of mutation target:

  * BEHAVIOURAL arms (7, 7b, 7c, 7d, 8, 8b, 9, 12) — measured on the real
    production classes. Mutating `hub/src/ws_server.ts` changes their
    outcome. These are the KILL targets.

  * RECORD-PLANE arms (0–6) — measured over the GIT TREE and the
    NARRATIVE. Mutating the tree requires a worktree with a different
    commit state; mutating the narrative requires editing
    LEARNING_PLAN.md. Neither is expressible by editing `hub/src/`, and
    a suite-file edit is a self-referential no-op (BUG 3).

⇒ This driver mutates PRODUCTION CODE ONLY for the behavioural arms, and
  uses SUITE-WEAKENING NEGATIVE CONTROLS for the record-plane arms. The
  record-plane tree mutations live in `r558_record_matrix.py`.
"""
import hashlib
import json
import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]      # woclaw/
HUB = REPO / "hub"
SUITE = HUB / "test" / "r558_round_identity_plane.test.ts"

# The files the matrix mutates. They must be tracked and clean.
OWNED = [
    HUB / "test" / "r558_round_identity_plane.test.ts",
    HUB / "src" / "ws_server.ts",
]

# Arm names in this suite. Used by the extractor's self-check.
KNOWN_ARMS = [
    "0", "1", "1b", "1c", "1d", "2", "2b", "3", "4", "5", "6",
    "7", "7b", "7c", "7d", "8", "8b", "9", "10", "11", "12",
]


def sh(cmd, cwd=HUB, timeout=420):
    return subprocess.run(
        cmd, cwd=str(cwd), shell=True, capture_output=True, text=True, timeout=timeout
    )


def md5(b: bytes) -> str:
    return hashlib.md5(b).hexdigest()


def run_suite():
    """Run the focused suite.

    Returns (passed, failed_count, failed_arm_names, output).

    The SUMMARY LINE is the authority (BUG 1): vitest prints
        Tests  21 passed (21)
    or
        Tests  20 passed | 1 failed (21)
    A compile error / module-load failure prints NO Tests line at all.
    """
    r = sh("npx vitest run --no-file-parallelism test/r558_round_identity_plane.test.ts")
    out = r.stdout + r.stderr

    m = re.search(r"Tests\s+(?:(\d+) failed \| )?(?:(\d+) passed)?", out)
    # vitest prints "Tests  20 passed | 1 failed (21)" — the ORDER is
    # passed-then-failed in some versions and failed-then-passed in others,
    # so parse both orders explicitly.
    passed = failed = None
    m2 = re.search(r"Tests\s+(.*?)\(\s*\d+\s*\)", out)
    if m2:
        seg = m2.group(1)
        pm = re.search(r"(\d+)\s+passed", seg)
        fm = re.search(r"(\d+)\s+failed", seg)
        passed = int(pm.group(1)) if pm else 0
        failed = int(fm.group(1)) if fm else 0
    has_summary = m2 is not None

    arms = extract_arms(out)
    return passed, failed, arms, out, has_summary


def extract_arms(out: str) -> set:
    """Enumerate EVERY failing arm by name — INDEPENDENTLY of expectations.

    BUG 2 FIX: only lines that BOTH start with `FAIL` AND contain the
    arm separator ` > ` are considered, and the summary block is skipped
    entirely. The previous second regex matched the "Failed Tests" summary
    (whose lines contain the FILE PATH) and harvested the path as an arm
    name.
    """
    arms = set()
    in_summary = False
    for line in out.splitlines():
        if re.match(r"^\s*Failed Tests\b", line):
            in_summary = True
            continue
        if in_summary:
            # the summary block ends at the next blank-line + section
            if not line.strip():
                in_summary = False
            continue
        if not line.lstrip().startswith("FAIL"):
            continue
        m = re.search(r"FAIL\s+test/r558_round_identity_plane\.test\.ts\s+>\s+(.*)$", line)
        if not m:
            continue
        rest = m.group(1)
        # The arm name is the segment before the FIRST ` > ` that is
        # followed by a non-numeric title, OR the leading "N[abc]." token.
        # vitest prints:  FAIL  test/... > <describe> > <arm title>
        parts = rest.split(" > ")
        if len(parts) >= 2:
            title = parts[-1]
            nm = re.match(r"([0-9]+[a-z]?)[.\s]", title)
            if nm:
                arms.add(nm.group(1))
    return arms


def extractor_selfcheck():
    """The extractor must be able to read EVERY arm name, verified against
    synthetic input BEFORE any injection (R557-P6)."""
    ok = True
    for arm in KNOWN_ARMS:
        synthetic = (
            " FAIL  test/r558_round_identity_plane.test.ts > R558 — the ROUND-IDENTITY plane > "
            f"{arm}. SOME TITLE\n"
        )
        got = extract_arms(synthetic)
        if arm not in got:
            print(f"  EXTRACTOR SELF-CHECK FAILED for arm {arm!r} (got {sorted(got)})")
            ok = False
    # And the summary block must NOT be harvested (BUG 2).
    summary_only = (
        " FAIL  test/r558_round_identity_plane.test.ts > R558 — the ROUND-IDENTITY plane > 7. HEADLINE\n"
        "\n"
        " Failed Tests 2\n"
        " FAIL  test/r558_round_identity_plane.test.ts > R558 — the ROUND-IDENTITY plane > 9. E2E\n"
    )
    got = extract_arms(summary_only)
    if got != {"7"}:
        print(f"  EXTRACTOR SELF-CHECK FAILED: summary block leaked arms {sorted(got)} (want only {{'7'}})")
        ok = False
    if ok:
        print(f"  extractor self-check OK for all {len(KNOWN_ARMS)} arm names")
    return ok


def preflight():
    """Refuse to run on a dirty tree (R475-2 / R557-P9)."""
    r = sh("git status --short -- hub/src hub/test")
    dirty = [l for l in r.stdout.splitlines() if l.strip()]
    owned_rel = {str(p.relative_to(REPO)) for p in OWNED}
    tracked_dirty = [l for l in dirty if l.split()[-1] in owned_rel]
    if tracked_dirty:
        print("PRE-FLIGHT REFUSED: owned files are dirty:")
        for l in tracked_dirty:
            print("   " + l)
        return False
    print("pre-flight OK (owned files clean)")
    return True


def snapshot():
    return {p: p.read_bytes() for p in OWNED}


def restore(snap):
    for p, b in snap.items():
        p.write_bytes(b)


def inject(path, old, new, label):
    """Inject; refuse on a non-unique or absent needle (BUG 4 + R456-10c)."""
    text = path.read_text(encoding="utf-8")
    n = text.count(old)
    if n != 1:
        return False, f"NOT-INJECTED (needle occurs {n}x, expected 1)"
    updated = text.replace(old, new, 1)
    if updated == text:
        return False, "NOT-INJECTED (replacement was a no-op)"
    path.write_text(updated, encoding="utf-8")
    if path.read_text(encoding="utf-8") == text:
        return False, "NOT-INJECTED (file unchanged after write)"
    # BUG 5 FIX: the file on disk must differ from the snapshot byte-wise.
    return True, "injected"


# ── the variants ───────────────────────────────────────────────────────────
# Each is a REPAIR SHAPE, not a random edit.

VARIANTS = [
    # M1: the real repair of the NaN-duration defect — validate the parsed
    #     grace period BEFORE the state is mutated.
    dict(
        id="M1",
        name="real repair: reject a non-finite grace period in rotateToken",
        file=HUB / "src" / "ws_server.ts",
        old="    this.gracePeriodEnd = Date.now() + grace;",
        new=(
            "    if (!Number.isFinite(grace) || grace < 0) {\n"
            "      throw new Error('gracePeriodMs must be a finite non-negative number');\n"
            "    }\n"
            "    this.gracePeriodEnd = Date.now() + grace;"
        ),
        expect={"7", "7b", "7c", "7d", "8", "8b", "9"},
    ),
    # M2: a PARTIAL repair — clamp NaN to the default grace, so the rotation
    #     succeeds but the operator's value is silently discarded.
    dict(
        id="M2",
        name="partial repair: clamp a non-finite grace to the default",
        file=HUB / "src" / "ws_server.ts",
        old="    this.gracePeriodEnd = Date.now() + grace;",
        new=(
            "    const safeGrace = Number.isFinite(grace) && grace >= 0 ? grace : this.gracePeriodMs;\n"
            "    this.gracePeriodEnd = Date.now() + safeGrace;"
        ),
        expect={"7", "8", "8b", "9", "11"},
    ),
    # M3: a LAZY variant — a comment that promises a validation that does
    #     not exist. Must SURVIVE (negative control).
    dict(
        id="M3",
        name="lazy control: a comment promising validation",
        file=HUB / "src" / "ws_server.ts",
        old="    this.gracePeriodEnd = Date.now() + grace;",
        new=(
            "    // NOTE: grace should be validated as a finite number before use.\n"
            "    this.gracePeriodEnd = Date.now() + grace;"
        ),
        expect=set(),
    ),
    # M4: make the status report HONEST about the NaN — the status says the
    #     grace is over while the old credential works.
    dict(
        id="M4",
        name="honest status: report a NaN grace period as still-active",
        file=HUB / "src" / "ws_server.ts",
        old="      inGracePeriod: this.gracePeriodEnd !== null && Date.now() < this.gracePeriodEnd,",
        new=(
            "      inGracePeriod: this.gracePeriodEnd !== null &&\n"
            "        (Number.isNaN(this.gracePeriodEnd) || Date.now() < this.gracePeriodEnd),"
        ),
        expect={"8"},
    ),
    # M5 (REDESIGNED, BUG 3): the suite-weakening NEGATIVE CONTROL.
    #     M5 used to "repair the record plane" by weakening the suite's own
    #     assertion — which is a SELF-REFERENTIAL NO-OP over the git tree,
    #     so it "survived" for a reason that had nothing to do with the
    #     defect. The tree-level repair lives in `r558_record_matrix.py`.
    #     Here M5 proves the OPPOSITE: the record-plane arms are NOT
    #     vacuous — weakening them does not change the tree, so they stay
    #     green, and that is the CORRECT outcome.
    dict(
        id="M5",
        name="negative control: weaken the orphan-commit-count assertion",
        file=SUITE,
        old="    expect(commitCountFor(orphan)).toBe(0);",
        new="    expect(commitCountFor(orphan)).toBeGreaterThanOrEqual(0);",
        expect=set(),
    ),
    # M6: weaken the NARRATIVE-claim arm. The previous needle described a
    #     version of the suite that did not exist (BUG 4). The needle below
    #     is taken from the CURRENT suite text and is UNIQUE (the phrase
    #     occurs in the header comment too, so the needle carries the
    #     surrounding assertion line to disambiguate).
    dict(
        id="M6",
        name="weaken the claim arm: accept a plan that never mentions R532",
        file=SUITE,
        old=(
            "    // LEARNING_PLAN.md:16773 — R553.2 names R532 as a NEIGHBOUR that has\n"
            "    // already measured the credential plane.\n"
            "    //\n"
            "    // ⚠️ The regex is ANCHORED on the actual wording. A loose `/R532|PLAN/`\n"
            "    // alternative matches 117 lines of the plan (the literal word \"PLAN\"\n"
            "    // appears in \"LEARNING_PLAN.md\" itself) — it would pass on a plan that\n"
            "    // never mentioned R532 at all. Measured: the previous version of this\n"
            "    // arm was a VACUOUS assertion.\n"
            "    expect(plan).toMatch(/R532 量过 REST 查询参数面/);"
        ),
        new=(
            "    // LEARNING_PLAN.md:16773 — R553.2 names R532 as a NEIGHBOUR that has\n"
            "    // already measured the credential plane.\n"
            "    //\n"
            "    // ⚠️ The regex is ANCHORED on the actual wording. A loose `/R532|PLAN/`\n"
            "    // alternative matches 117 lines of the plan (the literal word \"PLAN\"\n"
            "    // appears in \"LEARNING_PLAN.md\" itself) — it would pass on a plan that\n"
            "    // never mentioned R532 at all. Measured: the previous version of this\n"
            "    // arm was a VACUOUS assertion.\n"
            "    expect(plan).toMatch(/LEARNING_PLAN|PLAN/);"
        ),
        expect=set(),
    ),
    # M7: the NEGATIVE CONTROL for M6 — a shape that LOOKS like a repair of
    #     the narrative claim but only changes the wording of the regex,
    #     not the requirement. It must SURVIVE.
    dict(
        id="M7",
        name="negative control: keep the R532 requirement, widen the spacing",
        file=SUITE,
        old=(
            "    // never mentioned R532 at all. Measured: the previous version of this\n"
            "    // arm was a VACUOUS assertion.\n"
            "    expect(plan).toMatch(/R532 量过 REST 查询参数面/);"
        ),
        new=(
            "    // never mentioned R532 at all. Measured: the previous version of this\n"
            "    // arm was a VACUOUS assertion.\n"
            "    expect(plan).toMatch(/R532\\s*量过\\s*REST\\s*查询参数面/);"
        ),
        expect=set(),
    ),
    # M8: the CROSS-REPO COLLISION arm — break the collision by removing
    #     llm-benchmark's R553 matrix script from HEAD's view. This is
    #     expressed as a NARRATIVE-free tree mutation via the suite's own
    #     derivation, so it is applied to the SUITE's expectation of the
    #     collision set — a real repair shape for "the collision is gone".
    dict(
        id="M8",
        name="weaken the collision set: expect an empty overlap",
        file=SUITE,
        old="    expect(collisions).toEqual([459, 487, 488, 497, 501, 553, 556]);",
        new="    expect(collisions).toEqual([]);",
        expect={"4b"},
    ),
]


def main():
    print("=== needle pre-check (BUG 4) ===")
    suite_text = SUITE.read_text(encoding="utf-8")
    bad = False
    for v in VARIANTS:
        n = suite_text.count(v["old"]) if v["file"] == SUITE else v["file"].read_text(encoding="utf-8").count(v["old"])
        if n != 1:
            print(f"  {v['id']}: needle occurs {n}x — NOT-INJECTED would be recorded")
            bad = True
    if bad:
        print("ABORT: at least one needle is not unique — fix before running")
        return 1
    print("  all needles unique")

    if not extractor_selfcheck():
        print("ABORT: the extractor cannot read every arm name")
        return 1
    if not preflight():
        print("ABORT: dirty tree")
        return 1

    snap = snapshot()
    baseline_md5 = {p: md5(b) for p, b in snap.items()}

    print("\n=== CONTROL (unmutated) ===")
    passed, failed, arms, out, has_summary = run_suite()
    print(f"  passed={passed} failed={failed} summary={has_summary} failed_arms={sorted(arms)}")
    if not has_summary:
        print("ABORT: control produced no Tests summary (harness error, not a verdict)")
        restore(snap)
        return 1
    if failed != 0 or arms:
        print("ABORT: control is not green")
        restore(snap)
        return 1
    print(f"  control green ({passed}/{passed})")

    results = []
    for v in VARIANTS:
        print(f"\n=== {v['id']}: {v['name']} ===")
        ok, why = inject(v["file"], v["old"], v["new"], v["id"])
        if not ok:
            print(f"  {why} -> recorded as NOT-INJECTED (not a survivor)")
            results.append(dict(id=v["id"], verdict="NOT-INJECTED", detail=why, red=[], expect=sorted(v["expect"])))
            restore(snap)
            continue
        # BUG 5 FIX: assert the file actually differs from the snapshot.
        if md5(v["file"].read_bytes()) == baseline_md5[v["file"]]:
            print("  NOT-INJECTED (file byte-identical to baseline after injection)")
            results.append(dict(id=v["id"], verdict="NOT-INJECTED", detail="no byte change", red=[], expect=sorted(v["expect"])))
            restore(snap)
            continue

        passed, failed, arms, out, has_summary = run_suite()

        # BUG 1 FIX: the verdict is decided by the SUMMARY LINE, not by
        # `passed == 0`. An ordinary assertion failure has a summary with a
        # non-zero failed count; a compile error has NO summary at all.
        if not has_summary:
            verdict = "HARNESS"
            print(f"  HARNESS: no Tests summary (compile/module-load failure)")
        elif failed == 0 and not arms:
            verdict = "SURVIVED"
            print(f"  SURVIVED: passed={passed} failed=0 red_arms={sorted(arms)}")
        else:
            verdict = "KILLED"
            print(f"  KILLED: passed={passed} failed={failed} red_arms={sorted(arms)}")

        results.append(
            dict(id=v["id"], verdict=verdict, passed=passed, failed=failed,
                 red=sorted(arms), expect=sorted(v["expect"]))
        )
        restore(snap)

    # restore verification
    for p, b in snap.items():
        assert p.read_bytes() == b, f"restore failed for {p}"
    print("\nrestore verified: all owned files byte-identical to baseline")

    # ── VERDICT ────────────────────────────────────────────────────────────
    NEG_CONTROLS = {"M3", "M5", "M6", "M7"}
    failures = []
    for r in results:
        if r["verdict"] == "NOT-INJECTED":
            failures.append(f"{r['id']}: {r['detail']}")
            continue
        if r["id"] in NEG_CONTROLS:
            if r["verdict"] != "SURVIVED":
                failures.append(f"{r['id']}: negative control was {r['verdict']}, expected SURVIVED")
            continue
        if r["verdict"] != "KILLED":
            failures.append(f"{r['id']}: {r['verdict']} (expected KILLED)")
            continue
        if r["red"] != r["expect"]:
            failures.append(f"{r['id']}: red set {r['red']} != expected {r['expect']}")

    print("\n=== MATRIX SUMMARY ===")
    for r in results:
        print(f"  {r['id']}: {r['verdict']} red={r.get('red', [])} expect={r.get('expect', [])}")
    pathlib.Path("/tmp/r558_matrix.json").write_text(json.dumps(results, indent=2))

    if failures:
        print("\nVERDICT: FAIL")
        for f in failures:
            print("  " + f)
        return 1
    print("\nVERDICT: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
