#!/usr/bin/env python3
"""R558 cross-repo round-ID collision census.

Two repos maintain round IDs in the SAME namespace (woclaw R5xx, llm-benchmark
R5xx). Each repo's LEARNING_PLAN.md / memory/ narrative cites round IDs as
established neighbours. If the two namespaces overlap, a citation like
"R532 measured X" is AMBIGUOUS: it does not say WHICH repo's R532.

Derives the collision set mechanically from two independent indexes:
  - witness set A = round IDs with a file at HEAD in woclaw
  - witness set B = round IDs with a file at HEAD in llm-benchmark
  - collision set = A ∩ B

No window, no hand-listing.
"""
import json
import pathlib
import re
import subprocess

WS = pathlib.Path("/root/.hermes/workspace")
WOCLAW = WS / "woclaw"
LB = WS / "llm-benchmark"


def git(repo, *args):
    return subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True, check=True
    ).stdout


def head_files(repo):
    return git(repo, "ls-tree", "-r", "--name-only", "HEAD").splitlines()


def round_ids(repo):
    ids = {}
    for f in head_files(repo):
        m = re.search(r"/r(\d+)_", f)
        if m:
            ids.setdefault(int(m.group(1)), []).append(f)
    return ids


def main():
    a = round_ids(WOCLAW)
    b = round_ids(LB)
    collisions = sorted(set(a) & set(b))

    print(f"woclaw HEAD: {len(a)} distinct round IDs")
    print(f"llm-benchmark HEAD: {len(b)} distinct round IDs")
    print(f"COLLISIONS: {len(collisions)}")
    for r in collisions:
        print(f"  R{r}")
        for f in a[r]:
            print(f"      woclaw : {f}")
        for f in b[r]:
            print(f"      lb     : {f}")

    out = {
        "woclaw_ids": sorted(a),
        "lb_ids": sorted(b),
        "collisions": collisions,
        "woclaw_files": {str(k): v for k, v in a.items()},
        "lb_files": {str(k): v for k, v in b.items()},
    }
    pathlib.Path("/tmp/r558_collisions.json").write_text(json.dumps(out, indent=2))
    print("wrote /tmp/r558_collisions.json")
    return collisions


if __name__ == "__main__":
    main()
