#!/usr/bin/env python3
"""R558 — the ROUND-IDENTITY census.

Question: for every round ID that the workspace's own narrative (LEARNING_PLAN.md
+ memory/*.md) treats as a MEASURED, COMPLETED woclaw round, does the
repository at HEAD actually carry that round's artefact?

Method (R557's discipline: derive the subject set with NO window, and assert
the derivation's own completeness):
  - subject set  = round IDs claimed as completed by the narrative
  - witness set  = files at HEAD (git ls-tree) whose name encodes a round ID
  - the finding  = claimed round IDs with NO witness at HEAD

This is a RECORD-plane census, not a code audit. It does not read product
logic. It compares two independently maintained indexes:
  (a) the narrative index (what was claimed to have happened)
  (b) the repository index (what is actually there)
"""
import json
import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]          # woclaw/
WORKSPACE = pathlib.Path(__file__).resolve().parents[3]      # workspace/


def git(*args):
    return subprocess.run(
        ["git", "-C", str(REPO), *args], capture_output=True, text=True, check=True
    ).stdout


def head_files():
    out = git("ls-tree", "-r", "--name-only", "HEAD")
    return out.splitlines()


def head_round_ids():
    """Every round ID that has a file at HEAD."""
    ids = {}
    for f in head_files():
        m = re.search(r"/r(\d+)_", f)
        if m:
            ids.setdefault(int(m.group(1)), []).append(f)
    return ids


def narrative_round_ids():
    """Round IDs the workspace narrative treats as completed woclaw rounds.

    Derived from LEARNING_PLAN.md checkbox lines that name a woclaw round.
    The subject set is derived by a SINGLE rule (a checked box whose text
    names a round), with NO line window -- the R557 discipline.
    """
    plan = (WORKSPACE / "LEARNING_PLAN.md").read_text(encoding="utf-8", errors="replace")
    claimed = {}
    for line in plan.splitlines():
        if not re.match(r"^- \[x\]", line):
            continue
        for m in re.finditer(r"\bR(\d{3})\b", line):
            rid = int(m.group(1))
            # only count rounds that are attributed to woclaw in this line
            if "woclaw" not in line.lower() and "hub" not in line.lower():
                continue
            claimed.setdefault(rid, []).append(line.strip()[:160])
    return claimed


def stash_only_files():
    """Files present in any stash's untracked-component but absent at HEAD."""
    stash_list = git("stash", "list", "--format=%gd").split()
    out = set()
    for s in stash_list:
        try:
            names = git("show", f"{s}^3", "--name-only", "--pretty=format:")
        except subprocess.CalledProcessError:
            continue
        for n in names.splitlines():
            if n.strip():
                out.add(n.strip())
    return out


def main():
    head_ids = head_round_ids()
    claimed = narrative_round_ids()
    head_files_set = set(head_files())
    stash = stash_only_files()
    stash_only = sorted(f for f in stash if f not in head_files_set
                        and re.search(r"/r\d+_", f))

    # --- the census -----------------------------------------------------
    # claimed round IDs are those the narrative says are DONE. A round ID is
    # "witnessed" if a file at HEAD carries it.
    unwitnessed = sorted(r for r in claimed if r not in head_ids)

    result = {
        "head_round_ids": sorted(head_ids),
        "claimed_round_ids": sorted(claimed),
        "claimed_without_head_witness": unwitnessed,
        "stash_only_suite_files": stash_only,
        "head_file_count": len(head_files_set),
    }

    print("=== HEAD round IDs (witness set) ===")
    print(f"  {len(head_ids)} distinct round IDs, {len(head_files_set)} files at HEAD")
    print()
    print("=== stash-only suite files (present in a stash, NOT at HEAD) ===")
    for f in stash_only:
        print("  " + f)
    print()
    print("=== narrative-claimed rounds with NO file at HEAD ===")
    for r in unwitnessed:
        print(f"  R{r}: {claimed[r][0][:120]}")
    print()

    pathlib.Path("/tmp/r558_census.json").write_text(json.dumps(result, indent=2))
    print(f"wrote /tmp/r558_census.json")
    return result


if __name__ == "__main__":
    main()
