#!/usr/bin/env python3
"""
R502 — the detector whose CLASS is wider than its TRANSPORT, and whose
containment verdict is scoped to a SITE rather than to a FILE.

WHY THIS FILE EXISTS (R502, 2026-10-25)
-----------------------------------------
R501 replaced `r498c_sweep.py` with `r501_detector.py` and MEASURED it: 13/14
vulnerable spellings detected, 0/3 controls false-fired.  That measurement was
correct, and it was still not enough, because it measured the detector against a
corpus its own author wrote.  Two things were never measured:

  (1) WHERE the containment verdict is allowed to come from.  `r501_detector.py`
      decides "is this site confined?" with

          has_contain = any(PATH_CONTAINMENT.search(l) for l in lines)

      i.e. the WHOLE FILE.  A confinement guard is a fact about a SITE.  Three
      measured consequences (R502 F1):

        * a guard that appears LATER in the file than the vulnerable site
          "confirms" it;
        * a guard for a DIFFERENT variable in the same file "confirms" it
          (F3: the guard certifies ITSELF — the confinement-shaped expression
          guards `real` while the path actually served is `p`);
        * a guard for a DIFFERENT root in the same file "confirms" it.

      All three were measured with clean ground-truth fixtures: the R501
      detector answers `containment=YES` for a site with no guard at all.

      This is R460-3 one level up.  R460-3 said "a census must not read PROSE
      as code" (a comment is not a subject).  R502 says the same thing about
      SPATIAL PROXIMITY: a guard in another function, another root, or later in
      the file is not evidence about this site.  It is R446-5's shape again
      (the evidence window is the whole file, so a fact about one site is read
      as a fact about another) — and R446-5's fix (take the evidence from the
      site's own window) is exactly the fix here.

  (2) WHAT COUNTS AS A SOURCE.  `r501_detector.py`'s source list is
      TRANSPORT-shaped: `req.*`, `request.*`, `ctx.*`, `query.*`, `params[*]`,
      `.pathname`, `decodeURIComponent`.  A file that serves a filesystem path
      built from a WEBSOCKET MESSAGE, a MESSAGE ENVELOPE, or a REQUEST BODY
      FIELD is invisible to it (R502 F2, measured 1/6 on a clean corpus).

      This matters for WoClaw specifically: the hub's dominant untrusted input
      is not an HTTP request at all, it is a PEER MESSAGE over the federation
      WebSocket.  A detector whose sources are HTTP shapes is measuring a
      transport, not a class.

      The sibling class is also missing on the SINK side: `r501_detector.py`
      has no NETWORK sinks, so request-supplied URL -> `fetch()` (SSRF) is
      invisible even though the taint structure is identical.

WHAT THIS FILE DOES
-------------------
  * containment is decided per SITE (the innermost enclosing function/block),
    must appear BEFORE the sink in that site, and must be BOUND to the same
    tainted variable chain that reaches the sink;
  * the source list gains the MESSAGE/ENVELOPE shapes (msg.*, message.*,
    payload.*, event.*, body.*, peer.*) alongside the HTTP ones;
  * the sink list gains NETWORK sinks (fetch/http.get/axios/...) so the
    request->URL class is measurable with the same instrument.

Everything else (taint propagation through ANY assignment, comment stripping
with byte-offset preservation, balanced-paren argument extraction, the
`[HIGH]`/`[LOW ]` output format) is inherited from R501 deliberately, so the
two instruments can be compared on the same corpus.

USAGE
-----
    python3 r502_detector.py <root> [<root> ...]

Exit code 0 always; the output is a CANDIDATE LIST, not a verdict.  A candidate
is adjudicated by reading the site (R497's lesson: read the sink, then MEASURE
over a real socket — never guess exploitability from the shape).
"""
import os
import re
import sys

SKIP_DIRS = {
    "node_modules", ".git", "dist", "build", "coverage", "out", "_tmp",
    ".next", "target", "__pycache__", ".venv", "venv", "site-packages",
}
EXTENSIONS = (".ts", ".tsx", ".js", ".mjs", ".cjs")

# --- sources ---------------------------------------------------------------
# R501's HTTP transport shapes (kept verbatim, so the two instruments agree on
# the HTTP corpus).
REQ_SOURCE = re.compile(
    r"\b(?:req|request|ctx)\s*\??\.\s*(?:url|originalUrl|path|params|query|body)\b"
    r"|\bparams\s*\[|\bquery\s*\[|\bquery\s*\.\s*[A-Za-z_]\w*"
    r"|\.pathname\b"
    r"|\bdecodeURIComponent\s*\(|\bdecodeURI\s*\("
    r"|\burl\s*\.\s*parse\s*\(",
    re.I)

# R502 F2: the MESSAGE / ENVELOPE shapes.  A WoClaw peer message, a federation
# envelope, a WS frame and a REST body field are attacker-influenced exactly
# like `req.url` is.  A source list that names only one TRANSPORT is measuring
# the transport, not the class.
MSG_SOURCE = re.compile(
    r"\b(?:msg|message|envelope|frame|payload|evt|event|body|peer|agent|"
    r"delegation|notification)\s*\??\.\s*[A-Za-z_$][\w$]*",
    re.I)

SOURCE = re.compile("(?:" + REQ_SOURCE.pattern + ")|(?:" + MSG_SOURCE.pattern + ")", re.I)

# --- sinks -----------------------------------------------------------------
# ONE combined pattern with ONE capturing group.  The first draft combined
# FS_SINK and NET_SINK as two alternates with separate groups, so
# `sm.group(1)` was None for every NETWORK sink and the reported sink name
# came out as the literal string "none" (the suite caught it: "expected
# 'none' to contain 'fetch'").  A named group would have been the safer
# shape, but the two name sets overlap in neither direction, so one flat
# alternation is enough.
_FS_NAMES = (
    r"readFileSync|readFile|createReadStream|writeFileSync|writeFile|"
    r"appendFileSync|appendFile|createWriteStream|unlinkSync|rmSync|"
    r"readdirSync|existsSync|statSync|lstatSync|accessSync|mkdirSync|"
    r"renameSync|copyFileSync|realpathSync|sendFile|sendfile|download")
_NET_NAMES = (
    r"fetch|axios|axios\.\w+|got|superagent|request|"
    r"http\.get|https\.get|http\.request|https\.request|"
    r"http\.post|https\.post|undici\.\w+|nodeFetch|ky")

SINK = re.compile(r"\b((?:" + _FS_NAMES + r")|(?:" + _NET_NAMES + r"))\s*\(")

# A RESOLVING sink does not open content -- it produces a path value that a
# guard compares afterwards (the resolve-then-compare shape).  A SERVING sink
# opens the thing AT the sink line, so its guard has to precede it.
RESOLVING_SINKS = {"realpathSync", "statSync", "lstatSync", "existsSync"}

# --- PATH-CONTAINMENT assertions -------------------------------------------
# Unchanged from R501: a confinement guard must compare a PATH against a ROOT.
# A route prefix test, a header prefix test, a string prefix test and an
# HTML-escape helper are all rejected.
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
MSG_OBJ_ALIAS = re.compile(
    r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*"
    r"(?:msg|message|envelope|frame|payload|event|peer|body)\s*[;,)]")
MSG_DESTRUCT = re.compile(
    r"\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*"
    r"(?:msg|message|envelope|frame|payload|event|peer|body)\b")

# --- scope detection -------------------------------------------------------
# A "site" is the innermost enclosing FUNCTION (arrow function, function
# expression, method).  Module top-level code is its own site.
FUNC_OPEN = re.compile(
    r"(=>\s*\{)"
    r"|(\bfunction\b[^\n]*\{\s*$)"
    r"|(\b(?:async\s+)?(?:get|set)\s+[A-Za-z_$][\w$]*\s*\([^\n]*\{\s*$)"
    r"|(\)\s*:\s*[^\n{;]*\{\s*$)"
    r"|(\b(?:public|private|protected|static|readonly|async|override)\s+"
    r"[A-Za-z_$][\w$]*\s*(?:<[^>]*>)?\s*\([^\n]*\{\s*$)")
# statements that open a block but are NOT a function scope
BLOCK_KEYWORD = re.compile(
    r"\b(if|for|while|switch|catch|try|do|else|finally)\b")


def mask_strings(text: str) -> str:
    """Blank out string/template/regex-ish literals so brace counting is sane.

    Same discipline as R501's comment stripping: measure CODE, not prose.
    Byte offsets and newlines are preserved.
    """
    out = []
    in_s = None
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if in_s:
            out.append("\n" if c == "\n" else " ")
            if c == "\\" and in_s != "`" and i + 1 < n:
                out.append(" ")
                i += 2
                continue
            if c == in_s:
                in_s = None
            i += 1
            continue
        if c in "'\"`":
            in_s = c
            out.append(" ")
            i += 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


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


def function_scopes(lines):
    """Return [(start_line, end_line)] for each function-like span.

    A function span starts at a line that opens a function and ends at the
    line where its brace depth returns to zero.
    """
    masked = mask_strings("\n".join(lines)).split("\n")
    spans = []
    i = 0
    n = len(masked)
    while i < n:
        l = masked[i]
        if FUNC_OPEN.search(l) and not BLOCK_KEYWORD.search(l):
            depth = 0
            started = False
            j = i
            while j < n:
                for ch in masked[j]:
                    if ch == "{":
                        depth += 1
                        started = True
                    elif ch == "}":
                        depth -= 1
                if started and depth <= 0:
                    break
                j += 1
            spans.append((i, min(j, n - 1)))
            i = j + 1
            continue
        i += 1
    return spans


def enclosing_scope(spans, line_idx):
    """The innermost function span containing `line_idx`, or None."""
    best = None
    for (s, e) in spans:
        if s <= line_idx <= e:
            if best is None or (e - s) < (best[1] - best[0]):
                best = (s, e)
    return best


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


def guard_subject(line: str):
    """The identifier a path-confinement assertion actually constrains.

    `q.startsWith(ROOT + sep)`      -> q
    `real === ROOT`                  -> real   (equality form)
    `path.relative(ROOT, target)`    -> target
    `realpathSync(x)` alone          -> None (realpath is not a comparison)

    R502 F3: a guard that constrains a DIFFERENT variable constrains nothing
    about the path that is actually served.
    """
    m = re.search(r"([A-Za-z_$][\w$]*)\s*\.\s*startsWith\s*\(", line)
    if m:
        return m.group(1)
    # equality form: `real === ROOT` / `candidate === root`
    m = re.search(r"\b([A-Za-z_$][\w$]*)\s*===\s*[A-Za-z_$][\w$]*"
                  r"(?![A-Za-z_$][\w$]*\s*\()", line)
    if m and not re.search(r"===\s*['\"`]", line):
        return m.group(1)
    m = re.search(r"\bpath\s*\.\s*relative\s*\(\s*[^,]+,\s*([A-Za-z_$][\w$]*)", line)
    if m:
        return m.group(1)
    return None


def scan_file(path: str):
    """Return [{path, has_contain, hits:[...]}], or [] when the file is clean."""
    try:
        raw = open(path, encoding="utf8", errors="replace").read()
    except OSError:
        return []
    code = strip_comments(raw)
    lines = code.split("\n")
    raw_lines = raw.split("\n")
    spans = function_scopes(lines)

    # ---- taint bindings ------------------------------------------------
    req_aliases = set(REQ_OBJ_ALIAS.findall(code)) | set(MSG_OBJ_ALIAS.findall(code))
    destructured = set()
    for rx in (REQ_DESTRUCT, MSG_DESTRUCT):
        for grp in rx.findall(code):
            for part in grp.split(","):
                part = part.strip().split(":")[0].strip()
                if part and part.isidentifier():
                    destructured.add(part)

    # ---- taint propagation, WITH the parent chain ----------------------
    # The parent chain is what makes site-scoped containment decidable: a
    # guard counts only if it constrains a variable that is ON THE CHAIN of
    # the variable reaching the sink.
    tainted = set()
    parents = {}
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
                ids = set(re.findall(r"\b([A-Za-z_$][\w$]*)\b", rhs))
                if SOURCE.search(rhs):
                    # a direct source: this variable is a chain ROOT
                    tainted.add(name)
                    parents.setdefault(name, set())
                    changed = True
                    continue
                tainted_ancestors = ids & tainted
                if tainted_ancestors or (ids & req_aliases) or (ids & destructured):
                    tainted.add(name)
                    # ONLY tainted identifiers are recorded as parents.
                    # Recording every identifier in the RHS would make two
                    # SIBLINGS (two variables derived from the same request
                    # source) look like ancestor and descendant -- which would
                    # make a guard on one sibling appear to certify the other.
                    parents.setdefault(name, set()).update(tainted_ancestors)
                    changed = True

    def ancestors_of(var: str) -> set:
        """All ancestors of `var` in the taint chain (transitively)."""
        out, stack = set(), [var]
        while stack:
            v = stack.pop()
            for p in parents.get(v, ()):
                if p not in out:
                    out.add(p)
                    stack.append(p)
        return out

    def descendants_of(vars_) -> set:
        """All descendants of the given variables in the taint chain.

        SIBLINGS ARE NOT DESCENDANTS.  Two variables derived from the same
        request source are siblings; only an ancestor->descendant path makes
        one relevant to the other.  That distinction is what keeps R502 F3
        honest: in the self-certifying-guard fixture, `real` and `p` are
        siblings (both derived from `req.url`), so a guard on `real` says
        nothing about `p`, which is the path actually served.
        """
        if isinstance(vars_, str):
            vars_ = {vars_}
        out = set(vars_)
        stack = list(vars_)
        while stack:
            v = stack.pop()
            for c, ps in parents.items():
                if v in ps and c not in out:
                    out.add(c)
                    stack.append(c)
        return out

    # ---- helper-function guards -----------------------------------------
    # A guard can live in a HELPER: `realPathInsideRoot(target)` returns null
    # unless the resolved path is inside the root.  The confinement is real,
    # but the assertion sits inside another function, so a purely textual
    # same-site rule misses it (and R501's file-wide rule "found" it by
    # accident -- which is exactly the accident F3 is about).
    #
    # The rule: a helper FUNCTION that (a) is defined in this file and (b)
    # contains a path-confinement assertion -- directly or through another
    # guard helper -- is a GUARD HELPER.  A variable produced by calling one
    # is GUARD-PRODUCED.  A site is contained when the sink's taint chain
    # passes through a guard-produced variable.
    #
    # The chain constraint is what keeps this from degenerating back into
    # R501's file-wide rule: the guard has to be ON THE CHAIN, not merely
    # somewhere in the file.
    def body_of(span):
        return "\n".join(lines[span[0]:span[1] + 1])

    def defined_names(body):
        names = set()
        for rx in (
            r"\bfunction\s+([A-Za-z_$][\w$]*)\s*\(",
            r"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b",
            r"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>",
            r"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$]*\s*=>",
        ):
            for m in re.finditer(rx, body):
                names.add(m.group(1))
        return names

    guard_helpers = set()
    changed = True
    while changed:
        changed = False
        for span in spans:
            body = body_of(span)
            if not PATH_CONTAINMENT.search(body):
                # not a guard itself -- but it may CALL one
                called = any(re.search(r"\b" + re.escape(g) + r"\s*\(", body)
                             for g in guard_helpers)
                if not called:
                    continue
            for nm in defined_names(body):
                if nm not in guard_helpers:
                    guard_helpers.add(nm)
                    changed = True

    # variables produced by a call to a guard helper
    guard_produced = set()
    for l in lines:
        for m in re.finditer(r"\b([A-Za-z_$][\w$]*)\s*=\s*([^;\n]{0,300})", l):
            name, rhs = m.group(1), m.group(2)
            if any(re.search(r"\b" + re.escape(g) + r"\s*\(", rhs)
                   for g in guard_helpers):
                guard_produced.add(name)

    # ---- sinks ----------------------------------------------------------
    hits = []
    for i, l in enumerate(lines):
        for sm in SINK.finditer(l):
            argtext = call_args("\n".join(lines[i:]), sm.end() - 1)
            if not argtext:
                continue
            channels = []
            if SOURCE.search(argtext):
                channels.append("A:inline")
            for a in sorted(req_aliases):
                if re.search(r"\b" + re.escape(a) + r"\s*\.", argtext):
                    channels.append(f"B:alias({a})")
                    break
            for d in sorted(destructured):
                if re.search(r"\b" + re.escape(d) + r"\b", argtext):
                    channels.append(f"C:destruct({d})")
                    break
            ids = set(re.findall(r"\b([A-Za-z_$][\w$]*)\b", argtext))
            hit_tainted = sorted(ids & tainted)
            if hit_tainted:
                channels.append(f"D:taint({','.join(hit_tainted)})")
            if not channels:
                continue

            # ---- R502: SITE-SCOPED CONTAINMENT --------------------------
            # Three explicit rules, in order:
            #
            #   RULE 1 (CHAIN): a guard counts only if it constrains a
            #   variable ON THE TAINT CHAIN of the variable that reaches the
            #   sink.  R502 F3: a guard that constrains a DIFFERENT variable
            #   constrains nothing about the path actually served.
            #
            #   RULE 2 (ORDER): for a SERVING sink (one that opens content at
            #   the sink line -- readFileSync, sendFile, fetch) the guard must
            #   PRECEDE the sink.  A guard that comes after the read is not a
            #   guard for that read.  For a RESOLVING sink (one that produces
            #   a value a guard compares afterwards -- realpathSync) the
            #   guard legitimately comes AFTER, because resolve-then-compare
            #   is the correct shape.
            #
            #   RULE 3 (HELPER): a guard may live in a local guard HELPER;
            #   then the chain contains a guard-produced variable and the
            #   site is contained.
            resolving = sm.group(1) in RESOLVING_SINKS
            scope = enclosing_scope(spans, i)
            if scope is None:
                lo, hi = 0, len(lines) - 1
            else:
                lo, hi = scope

            # the chain that reaches this sink: the tainted variables plus
            # all their ancestors
            relevant = set()
            for hv in hit_tainted:
                relevant.add(hv)
                relevant |= ancestors_of(hv)
            # RULE 3: a guard-produced variable on the chain
            if relevant & guard_produced:
                contained = True
            else:
                contained = False
                # For a SERVING sink the guard must precede the sink; for a
                # RESOLVING sink the guard legitimately comes AFTER it
                # (resolve-then-compare is the correct shape).  So the
                # window differs by sink kind -- but it is ALWAYS the SITE's
                # window, never the file's.
                if resolving:
                    window = range(lo, hi + 1)
                else:
                    window = range(lo, min(i, hi) + 1)
                for j in window:
                    if not PATH_CONTAINMENT.search(lines[j]):
                        continue
                    subj = guard_subject(lines[j])
                    if subj is None:
                        continue
                    # RULE 1
                    # RULE 1: the guard's subject must be ON THE TAINT
                    # CHAIN of the served variable -- either the variable
                    # itself or one of its ANCESTORS (a guard on an
                    # ancestor constrains the derived value), or one of its
                    # DESCENDANTS (the resolve-then-compare shape, where
                    # `real` is derived from `candidate` and the guard
                    # refuses the read when `real` escapes -- a descendant
                    # guard protects its ancestor).
                    #
                    # SIBLINGS DO NOT COUNT.  In the self-certifying
                    # fixture, `real` and `p` both derive from `req.url`
                    # -- they are siblings, so a guard on `real` says
                    # nothing about the path actually served.  That
                    # distinction is exactly R502 F3, and it is why the
                    # taint chain records ONLY tainted ancestors: if
                    # every RHS identifier were recorded as a parent,
                    # siblings would look like ancestor and descendant.
                    if subj not in (relevant | descendants_of(relevant)):
                        continue
                    # RULE 2
                    if not resolving and j > i:
                        continue
                    contained = True
                    break
            hits.append({
                "line": i + 1,
                "sink": sm.group(1),
                "channels": channels,
                "contained": contained,
                "code": "\n".join(raw_lines[i:i + 3]).strip()[:260],
            })
            break

    if not hits:
        return []
    has_contain = any(h["contained"] for h in hits)
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
                        conf = "LOW " if h["contained"] else "HIGH"
                        tag = " [TEST]" if is_test else ""
                        print(f"[{conf}]{tag} {p}:{h['line']}  sink={h['sink']}  "
                              f"{'|'.join(h['channels'])}  "
                              f"containment={'YES' if h['contained'] else 'NO'}")
                        for cl in h["code"].split("\n"):
                            print(f"    | {cl.strip()[:160]}")
                        print()
    print(f"FILES WITH A HIT: {total_files}")
    print(f"TOTAL HITS: {total_hits}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
