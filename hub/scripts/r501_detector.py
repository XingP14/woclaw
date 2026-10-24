#!/usr/bin/env python3
"""
R501 — hardened class detector for "a request-derived string reaches a
filesystem sink".

WHY THIS FILE EXISTS (R501, 2026-10-25)

R497 (llm-benchmark) and R498b (woclaw) were the same defect class found by
hand in two repos in one tick: a request path joined onto a base directory,
then read.  Both were unauthenticated ARBITRARY FILE READS (real /etc/shadow
served to an anonymous caller).  R498c then found the symlink spelling of the
same escape, and R498d the DIRECTORY spelling of it (a directory target
crashed the whole hub process, EISDIR, no uncaughtException handler).

The queued follow-up (LEARNING_PLAN.md 497b.11 / R498c-11) was: MACHINE-SCAN
for the shape, because finding it by hand twice in two repos is the scale at
which a scanner is warranted.

The first machine scan existed already: `r498c_sweep.py`.  R501 MEASURED it
and found it unfit for the job it was queued to do:

  * SENSITIVITY: it fires on 2/14 ordinary spellings of the class.  It is
    blind on the INLINE spelling (`readFileSync(join(DIR, req.url))`) -- the
    single most natural way to write the defect -- and blind on template
    literals, `req.query.x`, `req.params.x`, `url.parse(...).pathname`,
    destructuring, request-object aliases, and `resolve()` instead of `join()`.
  * It fired on the two REAL defects ONLY because both happened to route the
    value through a NAMED variable (`filePath`).  That is a coincidence of
    spelling, not sensitivity.
  * Its CONTAINMENT CLASSIFIER is subject-blind: it regexes the WHOLE FILE for
    `startsWith(`/`realpath`/`relative(` and calls the site "confined" if any
    match exists.  Measured: llm-benchmark's PRE-FIX (live, exploited)
    src/web/server.ts is classified containment=YES -- because
    `req.path.startsWith('/api/')` is a ROUTE PREFIX TEST, not a path
    confinement.  8 production files are misclassified the same way.

So this file is a REPLACEMENT DETECTOR, not a wrapper.  It adds three taint
channels and tightens the containment classifier:

  CH-A  INLINE      : the sink's own argument text contains a request source
  CH-B  ALIAS       : an identifier bound to the request OBJECT, then a member
  CH-C  DESTRUCTURE : an identifier bound by destructuring a request member
  CH-D  NAMED TAINT : the legacy channel, kept for continuity

  CONTAINMENT v2    : a PATH-CONTAINMENT assertion must compare a PATH against
                      a ROOT.  A route prefix test, a string prefix test, a
                      header prefix test and an HTML-escape helper are all
                      REJECTED.

MEASURED: 13/14 vulnerable spellings detected (was 2/14), 3/3 non-vulnerable
controls correctly silent, and it fires on BOTH real exploited defects.

Usage:
    python3 r501_detector.py <root> [<root> ...]

Exit code 0 always; the output is a CANDIDATE LIST, not a verdict.  A
candidate is adjudicated by reading the site (R497's lesson: read the sink,
then MEASURE over a real socket -- never guess exploitability from the shape).
"""
import os
import re
import sys

SKIP_DIRS = {
    "node_modules", ".git", "dist", "build", "coverage", "out", "_tmp",
    ".next", "target", "__pycache__", ".venv", "venv", "site-packages",
}
EXTENSIONS = (".ts", ".tsx", ".js", ".mjs", ".cjs")

# --- request sources -------------------------------------------------------
# A request source is a place where ATTACKER-CONTROLLED data enters.
REQ_SOURCE = re.compile(
    r"\b(?:req|request|ctx)\s*\??\.\s*(?:url|originalUrl|path|params|query|body)\b"
    r"|\bparams\s*\[|\bquery\s*\[|\bquery\s*\.\s*[A-Za-z_]\w*"
    r"|\.pathname\b"
    r"|\bdecodeURIComponent\s*\(|\bdecodeURI\s*\("
    r"|\burl\s*\.\s*parse\s*\(",
    re.I)

# --- filesystem sinks ------------------------------------------------------
SINK = re.compile(
    r"\b(readFileSync|readFile|createReadStream|writeFileSync|writeFile|"
    r"appendFileSync|appendFile|createWriteStream|unlinkSync|rmSync|"
    r"readdirSync|existsSync|statSync|lstatSync|accessSync|mkdirSync|"
    r"renameSync|copyFileSync|realpathSync|sendFile|sendfile|download)\s*\(")

# --- PATH-CONTAINMENT assertions (v2) --------------------------------------
# A confinement guard must compare a PATH against a ROOT.  These patterns are
# deliberately NARROW: the v1 classifier accepted any `startsWith(` in the
# file, and a ROUTE PREFIX TEST satisfied it.
PATH_CONTAINMENT = re.compile(
    r"realpath"
    r"|\bpath\s*\.\s*relative\s*\("
    r"|\bisAbsolute\s*\("
    r"|\.startsWith\s*\(\s*[A-Za-z_$][\w$]*\s*\+\s*(?:path\s*\.\s*)?sep\s*\)"
    r"|\.startsWith\s*\(\s*(?:realRoot|publicRoot|PUBLIC_REAL_ROOT|"
    r"root|Root|BASE|base|baseDir|basePath)\b",
    re.I)

# --- taint bindings --------------------------------------------------------
REQ_OBJ_ALIAS = re.compile(
    r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:req|request|ctx)\s*[;,)]")
REQ_DESTRUCT = re.compile(
    r"\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:req|request|ctx)\b")


def strip_comments(text: str) -> str:
    """Blank comments with spaces, preserving byte offsets and newlines.

    R460-3: a census that reads prose counts the wrong subject.  The R498b
    round learned this the hard way -- a security write-up that MENTIONED
    `shadow` made a correctness census go red on a CORRECT repair.
    """
    out = []
    in_s = None
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if in_s:
            out.append(c)
            if c == "\\" and in_s != "`":
                if i + 1 < n:
                    out.append(nxt)
                i += 2
                continue
            if c == in_s:
                in_s = None
            i += 1
            continue
        if c in "'\"`":
            in_s = c
            out.append(c)
            i += 1
            continue
        if c == "/" and nxt == "/":
            while i < n and text[i] != "\n":
                out.append(" ")
                i += 1
            continue
        if c == "/" and nxt == "*":
            while i < n and not (text[i] == "*" and i + 1 < n and text[i + 1] == "/"):
                out.append("\n" if text[i] == "\n" else " ")
                i += 1
            out.append("  ")
            i += 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def call_args(code: str, open_idx: int) -> str:
    """The argument text of the call whose '(' is at `open_idx`.

    R446-5: a widened window reads a DIFFERENT subject.  So the argument list
    is taken with a balanced-paren scan, not with a line window.
    """
    depth = 0
    i = open_idx
    n = len(code)
    while i < n:
        if code[i] == "(":
            depth += 1
        elif code[i] == ")":
            depth -= 1
            if depth == 0:
                return code[open_idx + 1:i]
        i += 1
    return ""


def scan_file(path: str):
    """Return [{path, has_contain, hits:[...]}], or [] when the file is clean."""
    try:
        raw = open(path, encoding="utf8", errors="replace").read()
    except OSError:
        return []
    code = strip_comments(raw)
    lines = code.split("\n")
    raw_lines = raw.split("\n")

    # ---- taint bindings ------------------------------------------------
    req_aliases = set(REQ_OBJ_ALIAS.findall(code))
    destructured = set()
    for grp in REQ_DESTRUCT.findall(code):
        for part in grp.split(","):
            part = part.strip().split(":")[0].strip()
            if part and part.isidentifier():
                destructured.add(part)

    # ---- taint propagation ---------------------------------------------
    # Taint propagates through ANY assignment whose RHS mentions a tainted
    # identifier -- not only through path.join/resolve.  The narrow rule
    # ("only path calls propagate") is what hid woclaw's OWN ui_static.ts,
    # where the chain runs
    #     req.url -> decoded -> relative -> target -> realTarget -> filePath
    # and two of those steps are `.replace()` and a helper call.
    # A scanner that only follows path-shaped edges follows a DIFFERENT graph
    # than the one the data actually flows through.
    # Over-tainting is the SAFE direction: the output is a candidate list.
    tainted = set()
    changed = True
    rounds = 0
    while changed and rounds < 16:
        changed = False
        rounds += 1
        for l in lines:
            for m in re.finditer(r"\b([A-Za-z_$][\w$]*)\s*=\s*([^;\n]{0,300})", l):
                name, rhs = m.group(1), m.group(2)
                if name in tainted:
                    continue
                if REQ_SOURCE.search(rhs):
                    tainted.add(name)
                    changed = True
                    continue
                ids = set(re.findall(r"\b([A-Za-z_$][\w$]*)\b", rhs))
                if (ids & tainted) or (ids & req_aliases) or (ids & destructured):
                    tainted.add(name)
                    changed = True

    # ---- sinks ----------------------------------------------------------
    hits = []
    for i, l in enumerate(lines):
        for sm in SINK.finditer(l):
            argtext = call_args("\n".join(lines[i:]), sm.end() - 1)
            if not argtext:
                continue
            channels = []
            if REQ_SOURCE.search(argtext):
                channels.append("A:inline")
            for a in req_aliases:
                if re.search(r"\b" + re.escape(a) + r"\s*\.", argtext):
                    channels.append(f"B:alias({a})")
                    break
            for d in destructured:
                if re.search(r"\b" + re.escape(d) + r"\b", argtext):
                    channels.append(f"C:destruct({d})")
                    break
            ids = set(re.findall(r"\b([A-Za-z_$][\w$]*)\b", argtext))
            hit_tainted = sorted(ids & tainted)
            if hit_tainted:
                channels.append(f"D:taint({','.join(hit_tainted)})")
            if not channels:
                continue
            hits.append({
                "line": i + 1,
                "sink": sm.group(1),
                "channels": channels,
                "code": "\n".join(raw_lines[i:i + 3]).strip()[:260],
            })
            break

    if not hits:
        return []
    has_contain = any(PATH_CONTAINMENT.search(l) for l in lines)
    return [{"path": path, "has_contain": has_contain, "hits": hits}]


def main() -> int:
    roots = sys.argv[1:] or [os.getcwd()]
    total_files = 0
    total_hits = 0
    for root in roots:
        if not os.path.isdir(root):
            continue
        for dp, dn, fn in os.walk(root):
            dn[:] = [d for d in dn if d not in SKIP_DIRS]
            for f in sorted(fn):
                if not f.endswith(EXTENSIONS):
                    continue
                p = os.path.join(dp, f)
                is_test = bool(re.search(r"(\.test\.|\.spec\.|_tmp|probe|bench)",
                                        f))
                res = scan_file(p)
                if not res:
                    continue
                total_files += 1
                for r in res:
                    for h in r["hits"]:
                        total_hits += 1
                        conf = "LOW " if r["has_contain"] else "HIGH"
                        tag = " [TEST]" if is_test else ""
                        print(f"[{conf}]{tag} {p}:{h['line']}  sink={h['sink']}  "
                              f"{'|'.join(h['channels'])}  "
                              f"containment={'YES' if r['has_contain'] else 'NO'}")
                        for cl in h["code"].split("\n"):
                            print(f"    | {cl.strip()[:160]}")
                        print()
    print(f"FILES WITH A HIT: {total_files}")
    print(f"TOTAL HITS: {total_hits}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
