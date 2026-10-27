#!/usr/bin/env python3
"""
R503 -- DECOMPOSE the generated corpus's failures.

The generated corpus fails the detector on 32/60 cases.  Before that is
reported as "the detector is bad", the failures must be ATTRIBUTED: each
one must be explained by a NAMED cause, and the causes must partition the
failure set (no case may be left unexplained, and no case may be counted
twice).

The cause that R503 predicts is the source-list ENUMERATION: the detector
names six HTTP field names, so a request-shaped object whose field is called
`relPath`, `target`, `resource` or `file` is invisible to it -- while the
SAME field under a message-shaped object is a source.

Usage:
    python3 r503_decompose.py [--detector PATH]
"""
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import r503_generator as G
import r502_score_corpus as S

N = 60
SEED = 20261025


def detector_http_fields(path):
    """The HTTP arm's field list, read OUT OF THE DETECTOR'S OWN SOURCE."""
    src = open(path, encoding="utf8").read()
    m = re.search(r"REQ_SOURCE\s*=\s*re\.compile\((.*?)\n\s*\)", src, re.S)
    if not m:
        return None
    body = m.group(1)
    fm = re.search(r"\(\?:url\|originalUrl\|path\|params\|query\|body\)", body)
    if fm:
        return ["url", "originalUrl", "path", "params", "query", "body"]
    # fall back: pull every quoted alternation group out of the first arm
    alt = re.search(r"\(\?:([a-zA-Z|]+)\)", body)
    if alt:
        return alt.group(1).split("|")
    return None


def main() -> int:
    detector = os.path.join(HERE, "r502_detector.py")
    if "--detector" in sys.argv:
        detector = sys.argv[sys.argv.index("--detector") + 1]

    # The scratch directory is DERIVED, never hardcoded: "/root/.hermes/cache"
    # exists on exactly one host, so on any other host this script died with
    # PermissionError before it measured anything.
    d = tempfile.mkdtemp(prefix="r503decomp-")
    manifest = G.generate(d, N, SEED)
    proc = subprocess.run([sys.executable, detector, d],
                          capture_output=True, text=True)
    recs = S.parse(proc.stdout)

    http_fields = detector_http_fields(detector)
    print("detector HTTP field list: %s" % http_fields)
    print()

    causes = {}
    unexplained = []
    for c in manifest:
        hits = recs.get(c["file"], [])
        fired = bool(hits)
        ok = fired
        detail = ""
        if fired and c["kind"] == "SUBJECT":
            m = [h for h in hits if h[0] == c["line"]]
            if not m:
                ok = False
                detail = "hit at %s not gt line %d" % ([h[0] for h in hits], c["line"])
            elif m[0][2] != c["containment"]:
                ok = False
                detail = "containment %s != %s" % (m[0][2], c["containment"])
        if ok:
            continue

        src = open(os.path.join(d, c["file"])).read()
        obj = re.search(r"export function handler\((\w+): any\)", src)
        obj = obj.group(1) if obj else "?"
        field = re.search(r"const \w+ = %s\.(\w+)" % re.escape(obj), src)
        field = field.group(1) if field else "?"

        if not fired:
            if obj in ("req", "request", "ctx") and http_fields \
                    and field not in http_fields:
                cause = "SOURCE-NAME ENUMERATION (http field %r not in the list)" % field
            elif obj not in ("req", "request", "ctx"):
                cause = "SOURCE OBJECT not recognised (%r)" % obj
            else:
                cause = "NO HIT for another reason"
        else:
            cause = "VERDICT MISMATCH: " + detail
        causes.setdefault(cause, []).append(c["file"])
        unexplained.append((c, cause))

    print("FAILURES: %d / %d" % (len(unexplained), len(manifest)))
    print()
    for cause in sorted(causes, key=lambda k: -len(causes[k])):
        print("  %-62s %d" % (cause, len(causes[cause])))
    print()
    # the SOURCE-NAME ENUMERATION share
    enum = sum(len(v) for k, v in causes.items() if "ENUMERATION" in k)
    print("attributable to the source-name enumeration: %d / %d failures"
          % (enum, len(unexplained)))
    print("attributable to anything else:                  %d / %d failures"
          % (len(unexplained) - enum, len(unexplained)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
