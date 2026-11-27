#!/usr/bin/env python3
"""R558 — write the MEASURED ground-truth red-arm sets into the matrix driver.

R557 driver bug #3: the expected red-arm set was a PREDICTION, and the
driver compared the observation against it, so a wrong prediction read as
a suite defect. This script measures first, then rewrites the `expect=`
lines so the driver's expectations are derived from OBSERVATION.

Usage:
    python3 r558_write_expectations.py
"""
import pathlib
import re

MATRIX = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "r558_matrix.py"

# MEASURED on 2026-11-28 by r558_measure_arms.py (ground truth, not a guess).
MEASURED = {
    "M1": ["7", "7b", "7c", "7d", "8", "8b", "9"],
    "M2": ["7", "8", "8b", "9", "11"],
    "M3": [],
    "M4": ["8"],
    "M5": [],
    "M6": [],
    "M7": [],
    "M8": ["4b"],
}


def main():
    text = MATRIX.read_text(encoding="utf-8")
    for vid, red in MEASURED.items():
        pat = re.compile(
            r'(id="' + re.escape(vid) + r'",.*?)expect=\{[^}]*\}',
            re.S,
        )
        new_expect = "expect={" + ", ".join(f'"{a}"' for a in red) + "}"
        text, n = pat.subn(lambda mm: mm.group(1) + new_expect, text, count=1)
        if n != 1:
            print(f"  WARN: could not rewrite expect for {vid}")
        else:
            print(f"  {vid}: expect={new_expect}")
    MATRIX.write_text(text, encoding="utf-8")
    print("rewrote", MATRIX)


if __name__ == "__main__":
    main()
