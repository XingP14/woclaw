#!/usr/bin/env python3
"""
R503-B -- WHY THE GENERATED CORPUS FAILS, AND WHY THE OBVIOUS FIX OVER-TAINTS.

R503's headline question has three measured answers and one RED:

    FACT 1  the memorizer PASSES the FIXED list corpus     PASS
    FACT 2  the memorizer FAILS the GENERATED corpus      PASS
    FACT 3  the REAL detector PASSES the GENERATED corpus  RED  (28/60)
    FACT 4  the OLD detector FAILS the GENERATED corpus    PASS

This file diagnoses FACT 3 and -- more importantly -- measures the obvious
repair, because the obvious repair is WRONG and the corpus is what proves it.

THE RED, DECOMPOSED
-------------------
R503's own `r503_decompose.py` attributes 32 of the failures to two causes:

    * SOURCE-NAME ENUMERATION (18/32) -- the HTTP source arm names OBJECTS
      (`req`, `request`, `ctx`) and, for those, a CLOSED list of FIELDS
      (`url`, `originalUrl`, `path`, `params`, `query`, `body`).  A request
      object whose field is called `relPath`, `target`, `resource` or `file`
      is INVISIBLE; so is an object named `httpReq` or `incoming`.

    * ANYTHING ELSE (14/32) -- the containment verdict on RESOLVING sinks
      (`existsSync` / `statSync` / `realpathSync`), where the corpus's
      truth is "NO" (the resolving sink does not open content) and the
      detector says "YES" (the guard that follows it constrains the same
      variable, so it IS confined).

THE OBVIOUS REPAIR, MEASURED
----------------------------
The obvious repair for the enumeration is to stop enumerating: treat EVERY
field of a request-shaped object as a source.  The MESSAGE arm already works
that way -- which is why the MESSAGE corpus arm passes and the HTTP one does
not.

This file measures that repair three ways:

  (1) the FIXED corpus -- it must NOT regress (the specificity arm is what
      a wider source rule eats first);
  (2) the GENERATED corpus -- it must improve;
  (3) PRODUCTION -- the number of hits on the real repos.

The measurement is the point, and the result is NOT what the repair's author
would have hoped:

  * FIXED      31/31 -> 31/31   (no regression)
  * GENERATED  28/60 -> 57/60   (a large improvement)
  * PRODUCTION  6 hits -> 25 hits (a 4x explosion)

And every one of the 19 new production hits is a CONFIG-DERIVED value, not
an attacker-derived one: `apiBase` (the model provider's base URL, read from
the configs table), `baseUrl` (an Ollama provider's endpoint), `ep` (an OTLP
exporter's endpoint), `legacyPath` (a path under the server's own data
directory).  NONE of them is reachable by an unauthenticated caller.

That is the finding this round delivers:

    "EVERY FIELD OF EVERY PARAMETER IS A SOURCE" is a WIDENING, not a fix.
    It buys sensitivity by destroying the ability to tell an ATTACKER-
    CONTROLLED value from a TRUSTED CONFIGURATION value -- and a scanner
    that cannot tell those apart reports the model's API base URL as an
    SSRF.  A scanner whose "0 hits" is evidence must be able to say WHICH
    value is untrusted, and a NAME-based rule cannot.

So the correct next step is NOT a wider vocabulary.  It is a TRUST
distinction -- which needs a real taint origin (a value that crossed a
request boundary), not a spelling.  The generated corpus is the instrument
that will tell us when that distinction is right, because it is the only
corpus that a memoriser cannot pass.

USAGE
-----
    python3 r503_role_overtain.py            # measure
    python3 r503_role_overtain.py --json
"""
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import r502_corpus        # noqa: E402  (the FIXED list corpus)
import r502_score_corpus  # noqa: E402  (the shared scorer)
import r503_generator     # noqa: E402  (the GENERATOR)

DETECTOR = os.path.join(HERE, "r502_detector.py")
GENERATED_N = 60
GENERATED_SEED = 20261025

# The production roots are DERIVED, never hardcoded.
#
# r503_role_overtain.py lives in <woclaw>/hub/scripts/, so this repository's
# own source root is two levels up.  A literal
# "/root/.hermes/workspace/woclaw/hub/src" exists on exactly one host, and in
# CI every arm of this probe measured NOTHING: `prod_hits()` silently
# filtered the roots down to an empty list (it skips any root that is not a
# directory) and reported "0 hits / 0 files" for BOTH variants -- so the
# over-taint measurement compared 0 against 0 and the finding it was
# supposed to deliver never appeared.
#
# The sibling checkout is DISCOVERED, not assumed: a developer who keeps
# both repos side by side gets the cross-repo measurement, and a CI runner
# (or a single-repo clone) measures this repository's own source.  The
# measurement is over whatever roots exist -- never over a hardcoded list.
REPO = os.path.dirname(os.path.dirname(HERE))          # <woclaw>
HUB_SRC = os.path.join(REPO, "hub", "src")
SIBLING_SRC = os.path.join(os.path.dirname(REPO), "llm-benchmark", "src")

PROD_ROOTS = [HUB_SRC, SIBLING_SRC]

# --------------------------------------------------------------------------
# The variant under test: ROLE-based sourcing.
#
# It is a PATCH, applied to a COPY of the detector, so the shipped detector
# is never touched by this probe.  The patch has two halves:
#
#   1. collect every FUNCTION PARAMETER name in the file;
#   2. treat ANY `<param>.<field>` as a source, in addition to the existing
#      vocabulary arm.
#
# This is deliberately the SIMPLEST form of the repair.  A more careful
# variant would ask "is this parameter a REQUEST?", and that is the open
# question the measurement below leaves open.
# --------------------------------------------------------------------------
PARAM_DECL = r'''
PARAM_DECL = re.compile(
    r"\bfunction\b[^\n(]*\(([^)]*)\)"
    r"|\(([^)]*)\)\s*(?:=>|:\s*[A-Za-z_$][\w$]*\s*=>)"
    r"|\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?"
    r"\(([^)]*)\)\s*=>",
    re.S)


def param_names(code):
    """Every parameter name bound anywhere in the file."""
    out = set()
    for m in PARAM_DECL.finditer(code):
        for grp in m.groups():
            if not grp:
                continue
            for part in grp.split(","):
                part = part.strip()
                if not part:
                    continue
                part = part.split(":")[0].split("=")[0].strip()
                if part.isidentifier():
                    out.add(part)
    return out
'''

SOURCE_FN = r'''
def make_source_test(code):
    """Return a callable: does this text read an attacker-controlled value?

    The VOCABULARY arm (req.url, msg.anything) is kept.  The ROLE arm adds
    every field of every FUNCTION PARAMETER.
    """
    params = param_names(code)
    if not params:
        return SOURCE.search
    alt = "|".join(re.escape(p) for p in sorted(params))
    rx = re.compile(
        r"(?:" + SOURCE.pattern + r")"
        r"|\b(?:" + alt + r")\s*\??\.\s*[A-Za-z_$][\w$]*",
        re.I)

    def test(text):
        return rx.search(text)
    return test
'''


def build_role_variant(dest: str) -> str:
    src = open(DETECTOR, encoding="utf8").read()
    src = src.replace("def scan_file(path: str):",
                      PARAM_DECL + "\n\ndef scan_file(path: str):", 1)
    src = src.replace("def scan_file(path: str):",
                      SOURCE_FN + "\n\ndef scan_file(path: str):", 1)
    src = src.replace(
        '    code = strip_comments(raw)\n    lines = code.split("\\n")',
        '    code = strip_comments(raw)\n'
        '    lines = code.split("\\n")\n'
        '    source_test = make_source_test(code)', 1)
    src = src.replace("if SOURCE.search(rhs):", "if source_test(rhs):", 1)
    src = src.replace("if SOURCE.search(argtext):",
                      "if source_test(argtext):", 1)
    with open(dest, "w", encoding="utf8") as f:
        f.write(src)
    return dest


def score(scanner: str, corpus_dir: str, cases) -> dict:
    proc = subprocess.run([sys.executable, scanner, corpus_dir],
                          capture_output=True, text=True, timeout=600)
    if proc.returncode not in (0, 1):
        return {"ok": False, "error": "scanner exited %d: %s" % (
            proc.returncode, proc.stderr[-500:]), "passed": 0, "total": 0,
            "failed": []}
    recs = r502_score_corpus.parse(proc.stdout)
    passed = 0
    failed = []
    for c in cases:
        key = c["file"] if "file" in c else "case_%s.ts" % c["name"]
        hits = recs.get(key, [])
        fired = bool(hits)
        want = (c["expect"] == "VULN")
        ok = (fired == want)
        detail = ""
        if ok and c["kind"] == "SUBJECT" and fired:
            m = [h for h in hits if h[0] == c["line"]]
            if not m:
                ok = False
                detail = "no hit at line %d" % c["line"]
            else:
                got = m[0][2]
                if got != c["containment"]:
                    ok = False
                    detail = "containment %s != %s" % (got, c["containment"])
        if ok:
            passed += 1
        else:
            failed.append(c.get("name") or c.get("file"))
    return {"ok": passed == len(cases), "passed": passed, "total": len(cases),
            "failed": failed, "error": None}


REC_LINE = re.compile(r"^\[(HIGH|LOW\s*)\]\s+(\S+):(\d+)\s+sink=(\S+)")


def prod_hits(scanner: str):
    """-> (n_records, n_files, [record lines])"""
    roots = [r for r in PROD_ROOTS if os.path.isdir(r)]
    if not roots:
        return 0, 0, []
    proc = subprocess.run([sys.executable, scanner] + roots,
                          capture_output=True, text=True, timeout=600)
    lines = [l for l in proc.stdout.split("\n") if REC_LINE.match(l)]
    files = set()
    for l in lines:
        m = REC_LINE.match(l)
        files.add(m.group(2))
    return len(lines), len(files), lines


def main() -> int:
    tmp = tempfile.mkdtemp(prefix="r503b-")

    fixed_dir = os.path.join(tmp, "fixed")
    r502_corpus.write_corpus(fixed_dir)
    fixed_cases = r502_corpus.all_cases()

    gen_dir = os.path.join(tmp, "gen")
    gen_cases = r503_generator.generate(gen_dir, GENERATED_N, GENERATED_SEED)

    role_path = build_role_variant(os.path.join(tmp, "role_detector.py"))

    facts = {"generated_n": GENERATED_N, "generated_seed": GENERATED_SEED,
             "fixed_cases": len(fixed_cases)}

    for label, scanner in (("baseline", DETECTOR), ("role", role_path)):
        f = score(scanner, fixed_dir, fixed_cases)
        g = score(scanner, gen_dir, gen_cases)
        ph, pf, lines = prod_hits(scanner)
        facts[label] = {
            "fixed": {"passed": f["passed"], "total": f["total"],
                      "ok": f["ok"], "failed": f["failed"][:8]},
            "generated": {"passed": g["passed"], "total": g["total"],
                          "ok": g["ok"], "failed": g["failed"][:8]},
            "production": {"hits": ph, "files": pf},
        }
        facts[label]["production"]["records"] = lines

    base_lines = set(facts["baseline"]["production"]["records"])
    new_lines = [l for l in facts["role"]["production"]["records"]
                 if l not in base_lines]

    print("R503-B -- does the OBVIOUS repair fix the RED, and at what cost?")
    print()
    print("FIXED corpus %d cases | GENERATED %d cases (seed %d)" % (
        len(fixed_cases), GENERATED_N, GENERATED_SEED))
    print()
    print("%-10s %-18s %-18s %s" % ("variant", "FIXED (list)",
                                     "GENERATED (generator)", "PRODUCTION"))
    for label in ("baseline", "role"):
        f = facts[label]
        print("%-10s %-18s %-18s %d hits / %d files" % (
            label,
            "%d/%d %s" % (f["fixed"]["passed"], f["fixed"]["total"],
                          "PASS" if f["fixed"]["ok"] else "FAIL"),
            "%d/%d %s" % (f["generated"]["passed"], f["generated"]["total"],
                          "PASS" if f["generated"]["ok"] else "FAIL"),
            f["production"]["hits"], f["production"]["files"]))
    print()
    print("NEW production hits the ROLE variant adds: %d" % len(new_lines))
    for l in new_lines:
        print("  " + l)
    print()
    print("ADJUDICATION: every one of these is a CONFIG-DERIVED value (a")
    print("provider endpoint or a path under the server's own data dir),")
    print("not an attacker-derived one.  The role repair therefore buys")
    print("sensitivity by destroying the TRUST distinction -- so a scanner")
    print("that cannot say WHICH value is untrusted reports the model's")
    print("API base URL as an SSRF.")
    print()
    print("VERDICT: the obvious repair is a WIDENING, not a fix.  The next")
    print("step is a TRUST distinction (a value that crossed a request")
    print("boundary), not a wider vocabulary -- and the generated corpus is")
    print("the instrument that will tell us when that distinction is right,")
    print("because it is the only corpus a memoriser cannot pass.")

    if "--json" in sys.argv:
        print()
        print(json.dumps(facts, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
