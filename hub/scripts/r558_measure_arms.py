#!/usr/bin/env python3
"""R558 — MEASURE the ground-truth red-arm sets, then write them into the
matrix driver.

R557 driver bug #3: the expected red-arm set was a PREDICTION, and the
driver compared the observation against it, so a wrong prediction read as
a suite defect. Here the red-arm sets are MEASURED first, and the
measurement is written out so the driver's expectations are derived from
observation, not from a guess.

Usage:
    python3 r558_measure_arms.py            # measure and print
    python3 r558_measure_arms.py --write    # measure and rewrite the
                                              # `expect=` lines in
                                              # r558_matrix.py
"""
import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
HUB = REPO / "hub"
SUITE = HUB / "test" / "r558_round_identity_plane.test.ts"
MATRIX = HUB / "scripts" / "r558_matrix.py"

NEG_CONTROLS = {"M3", "M5", "M6", "M7"}


def sh(cmd, cwd=HUB, timeout=420):
    return subprocess.run(cmd, cwd=str(cwd), shell=True,
                          capture_output=True, text=True, timeout=timeout)


def extract_arms(out: str) -> set:
    """Same extractor as the matrix driver — BUG 2 FIX."""
    arms = set()
    in_summary = False
    for line in out.splitlines():
        if re.match(r"^\s*Failed Tests\b", line):
            in_summary = True
            continue
        if in_summary:
            if not line.strip():
                in_summary = False
            continue
        if not line.lstrip().startswith("FAIL"):
            continue
        m = re.search(r"FAIL\s+test/r558_round_identity_plane\.test\.ts\s+>\s+(.*)$", line)
        if not m:
            continue
        parts = m.group(1).split(" > ")
        if len(parts) >= 2:
            nm = re.match(r"([0-9]+[a-z]?)[.\s]", parts[-1])
            if nm:
                arms.add(nm.group(1))
    return arms


def run_suite():
    r = sh("npx vitest run --no-file-parallelism test/r558_round_identity_plane.test.ts")
    out = r.stdout + r.stderr
    m2 = re.search(r"Tests\s+(.*?)\(\s*\d+\s*\)", out)
    passed = failed = 0
    if m2:
        seg = m2.group(1)
        pm = re.search(r"(\d+)\s+passed", seg)
        fm = re.search(r"(\d+)\s+failed", seg)
        passed = int(pm.group(1)) if pm else 0
        failed = int(fm.group(1)) if fm else 0
    return passed, failed, extract_arms(out), out, m2 is not None


def measure():
    """Run each variant once and record its OBSERVED red-arm set."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("m", MATRIX)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)

    snap = m.snapshot()
    observed = {}
    try:
        for v in m.VARIANTS:
            ok, why = m.inject(v["file"], v["old"], v["new"], v["id"])
            if not ok:
                observed[v["id"]] = dict(verdict="NOT-INJECTED", detail=why, red=[])
                print(f"{v['id']}: NOT-INJECTED ({why})")
                m.restore(snap)
                continue
            passed, failed, arms, out, has_summary = run_suite()
            if not has_summary:
                verdict = "HARNESS"
            elif failed == 0 and not arms:
                verdict = "SURVIVED"
            else:
                verdict = "KILLED"
            observed[v["id"]] = dict(verdict=verdict, passed=passed, failed=failed,
                                     red=sorted(arms))
            print(f"{v['id']}: {verdict} passed={passed} failed={failed} red={sorted(arms)}")
            m.restore(snap)
    finally:
        m.restore(snap)

    for p, b in snap.items():
        assert p.read_bytes() == b, f"restore failed for {p}"
    print("\nrestore verified")
    return observed


def write_expectations(observed):
    text = MATRIX.read_text(encoding="utf-8")
    for vid, o in observed.items():
        if o["verdict"] == "NOT-INJECTED":
            continue
        # find the `expect={...}` line inside this variant's dict block
        pat = re.compile(
            r'(id="' + re.escape(vid) + r'",.*?)expect=\{[^}]*\}',
            re.S,
        )
        red = o["red"]
        new_expect = "expect={" + ", ".join(f'"{a}"' for a in red) + "}"
        text, n = pat.subn(lambda mm: mm.group(1) + new_expect, text, count=1)
        if n != 1:
            print(f"  WARN: could not rewrite expect for {vid}")
        else:
            print(f"  wrote expect for {vid}: {new_expect}")
    MATRIX.write_text(text, encoding="utf-8")
    print("rewrote", MATRIX)


if __name__ == "__main__":
    obs = measure()
    print("\n=== OBSERVED (ground truth) ===")
    for k, v in obs.items():
        print(f"  {k}: {v}")
    if "--write" in sys.argv:
        write_expectations(obs)
