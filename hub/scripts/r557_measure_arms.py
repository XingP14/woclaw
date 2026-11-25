#!/usr/bin/env python3
"""R557 — MEASURE the red-arm set of each mutation, one at a time.

No concurrent writers this time (R557's own lesson: the first matrix run
was corrupted because I edited the same file while it ran).

For each mutation: inject, run the focused suite, record the EXACT set of
failing arms (enumerated independently of any expectation — R556 P4),
restore byte-for-byte, verify md5.

The resulting table is the GROUND TRUTH for the matrix's expected sets.
"""
import hashlib
import re
import subprocess
import sys
from pathlib import Path

HUB = Path(__file__).resolve().parents[1]
REST = HUB / "src" / "rest_server.ts"

MUTATIONS = [
    ("M1", "const edgeId = decodeURIComponent(path.slice(14));",
     "const edgeId = decodeURIComponent(path.slice(13));", "real repair: /graph/edges/"),
    ("M2", "const parts = decodeURIComponent(path.slice(14)).split('/');",
     "const parts = decodeURIComponent(path.slice(13)).split('/');", "real repair: /graph/paths/"),
    ("M3", "const topic = decodeURIComponent(path.slice(8));",
     "const topic = decodeURIComponent(path.slice(9));", "real repair: /streams/"),
    ("M4", "const id = decodeURIComponent(path.slice(9));",
     "const id = decodeURIComponent(path.slice(10));", "real repair: /sessions/"),
    ("M5", "// v1.0: Session Memory routes",
     "// v1.0: Session Memory routes\n    // NOTE: slices are hand-computed offsets",
     "lazy: a comment"),
    ("M6", "const edgeId = decodeURIComponent(path.slice(14));",
     "const edgeId = decodeURIComponent(path.slice(14) + '');", "lazy: a no-op concat"),
    ("M7", "const edgeId = decodeURIComponent(path.slice(14));",
     "const edgeId = decodeURIComponent(path.slice(14).toUpperCase());",
     "wrong-shape repair: upper-cases the id"),
    ("M8", "const id = decodeURIComponent(path.slice(9));",
     "const id = decodeURIComponent(path.slice(9).replace(/^\\//, ''));",
     "partial repair on /sessions/: strips the leading slash"),
]

ARM_RE = re.compile(r"R557 — the route-offset plane > ([\w.]+?)\.?(?:\s|$)")


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def run_suite() -> str:
    r = subprocess.run(["npx", "vitest", "run", "test/r557_route_offset_plane.test.ts"],
                       cwd=HUB, capture_output=True, text=True, timeout=900)
    return r.stdout + r.stderr


def red_arms(out: str) -> set[str]:
    arms = set()
    for line in out.split("\n"):
        m = re.search(r"FAIL\s+\S+\s+>\s+(.+?)(?:\s+\d+ms)?$", line)
        if m:
            a = ARM_RE.search(m.group(1))
            if a:
                arms.add(a.group(1).rstrip("."))
    return arms


def n_failed(out: str) -> int:
    m = re.search(r"Tests\s+(?:(\d+) failed \| )?(\d+) (?:failed|passed)", out)
    if not m:
        return 0
    if m.group(1):
        return int(m.group(1))
    return 0 if "failed" not in out.split("Tests")[1].split("\n")[0] else int(m.group(2))


def main() -> int:
    base = REST.read_bytes()
    base_md5 = hashlib.md5(base).hexdigest()
    print(f"baseline md5={base_md5}")

    out = run_suite()
    if "failed" in out.split("Tests")[-1].split("\n")[0] and n_failed(out) != 0:
        print("<<< CONTROL RED — aborting")
        print(out[-3000:])
        return 2
    print("control GREEN ✓\n")

    table = {}
    for name, needle, repl, why in MUTATIONS:
        text = REST.read_text()
        n = text.count(needle)
        if n != 1:
            print(f"{name}: NOT-INJECTED (needle occurs {n}x)")
            table[name] = ("NOT-INJECTED", set(), why)
            continue
        REST.write_text(text.replace(needle, repl))
        if md5(REST) == base_md5:
            print(f"{name}: NOT-INJECTED (no change)")
            REST.write_bytes(base)
            table[name] = ("NOT-INJECTED", set(), why)
            continue
        try:
            out = run_suite()
            arms = red_arms(out)
            fails = n_failed(out)
            verdict = "KILLED" if fails > 0 else "SURVIVED"
            print(f"{name}: {verdict} failed={fails} arms={sorted(arms) or '(none)'}   [{why}]")
            table[name] = (verdict, arms, why)
        finally:
            REST.write_bytes(base)
            assert md5(REST) == base_md5, "RESTORE FAILED"

    print("\n=== GROUND TRUTH ===")
    for name, (verdict, arms, why) in table.items():
        print(f'    "{name}": {sorted(arms)},   # {verdict} — {why}')
    return 0


if __name__ == "__main__":
    sys.exit(main())
