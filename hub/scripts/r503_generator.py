#!/usr/bin/env python3
"""
R503 -- THE GENERATOR: a corpus that cannot be memorised, because it is not
a list.

THE PROBLEM R503 FOUND
----------------------
R501's rule: "a scanner's sensitivity must be MEASURED against a corpus of
the class, not against the instances you happen to have."  R502-A productised
that corpus -- permanent, versioned, separate from the detector.  R503
measures the thing R502-A left unmeasured:

    DOES THE CORPUS DISTINGUISH A SCANNER THAT KNOWS THE CLASS
    FROM A SCANNER THAT HAS MEMORISED THE CORPUS?

Measured answer: NO.  A scanner with a lookup table from case identity to
expected verdict passes the corpus 31/31 -- while having no notion of taint,
sites, roots, sinks or containment.  "CORPUS PASS: the scanner is MEASURED"
is, on the corpus as it stands, a statement about MEMORISATION, not about
capability.

WHY A BIGGER LIST DOES NOT FIX IT
---------------------------------
A public, finite, published corpus is always memorisable: the adversary reads
the answer key and emits it.  Adding cases does not help; the adversary reads
the new ones too.  Renaming the identifiers inside the cases does not help
either -- the adversary can key on the SHAPE of a case rather than its text.

WHY THE FIX IS A GENERATOR, NOT A LIST
--------------------------------------
The static-analysis community already solved this, and R502's corpus is
missing the piece it solved it with.  Semgrep's rule-testing convention
(Semgrep Docs, "Test rules"; semgrep-rules + Shopify/semgrep-rules-1
CONTRIBUTING.md) requires every rule to ship a test file with at least one
TRUE POSITIVE and one TRUE NEGATIVE, and requires the rule to match a
PATTERN with METAVARIABLES ($X, $VAR) rather than literal identifiers:

    // ruleid: my-rule
    var strdata = "hello";
    // ok: my-rule
    var numdata = 1;

The metavariable is the load-bearing part: **a rule written against the
literal identifiers of its own test file cannot be expressed with a
metavariable** -- that is exactly what makes it general rather than
memorised.  Our corpus has no metavariable analogue, so a scanner IS
expressible that keys on those literals.

THE PROPERTY-BASED GENERALISATION
---------------------------------
The metavariable's generalisation is the property-based-testing one
(Hypothesis / QuickCheck): a corpus that is a GENERATOR over the class
produces instances the adversary has never seen, from a space larger than
any table it can carry.  R503's generator COMPOSES the class:

    a random CHAIN of transformations (alias / destructure / decode /
    replace / split / template / rename)
  x a random SINK shape (fs sink / network sink / resolving sink)
  x a random GUARD placement (none / other-site / after-the-read /
    route-prefix / unrelated-variable / genuinely-guarded)

with randomised identifier names, randomised chain depth and randomised
statement order.  A memoriser -- a finite table, keyed on identity OR on
shape -- cannot cover that space; a pattern-based scanner covers all of it.

So the corpus's unit of truth becomes:

    the CLASS (a generator + its ground-truth predicate),
    not the CASE (a list of files).

This file is the generator.  `r503_overfit_probe.py` measures it.
"""
import argparse
import json
import os
import random
import re

# --- the randomisable vocabulary ------------------------------------------

NAME_POOLS = {
    "base": ["PUBLIC_DIR", "SERVE_ROOT", "assetsDir", "ASSET_ROOT", "webRoot",
             "staticRoot", "docRoot"],
    "guard": ["ROOT", "ALLOWED_ROOT", "baseRoot", "CANON_ROOT", "rootDir",
              "SAFE_ROOT", "rootPath"],
    "req": ["req", "request", "ctx", "httpReq", "incoming"],
    "urlfield": ["url", "target", "pathname", "resource", "file", "relPath"],
    "var": ["p", "candidate", "rel", "targetPath", "resolved", "outPath"],
    "raw": ["raw", "input", "rawPath", "supplied", "untrusted"],
    "msg": ["msg", "message", "envelope", "frame", "payload", "event"],
    "aux": ["aux", "tmp", "step1", "mid", "scratch"],
}

# Each TRANSFORM maps a value expression onto a NEW EXPRESSION.  The
# templates are EXPRESSIONS ONLY -- the declaration is emitted by the
# generator, so a transform can never produce a double `const`.
TRANSFORMS = [
    ("direct", "{src}"),
    ("alias", "{src}"),
    ("decode", "decodeURIComponent({src})"),
    ("strip", "{src}.replace(/^\\/+/, '')"),
    ("split", "{src}.split('?')[0]"),
    ("template", "`${{{src}}}`"),
    ("slice", "{src}.slice(1)"),
    ("encode", "encodeURIComponent({src})"),
]

# The preamble must DECLARE every sink the generator can pick, or the
# generated corpus is a pile of ReferenceErrors and the scanner is being
# graded on its tolerance of code that cannot run.
PREAMBLE = """import fs from 'fs';
import path from 'path';
const join = path.join, resolve = path.resolve;
const readFileSync = fs.readFileSync;
const fetch = globalThis.fetch;
const axios = globalThis.axios;
const http = { get: globalThis.fetch, request: globalThis.fetch };
"""

FS_SINKS = ["readFileSync", "readFile", "createReadStream"]
NET_SINKS = ["fetch", "axios", "http.get"]
RESOLVING_SINKS = ["realpathSync", "existsSync", "statSync"]

# The names of the RESOLVING sinks, as a TUPLE for membership tests.
# A resolving sink produces a VALUE (a canonical path, a stat result); it
# does not OPEN CONTENT.  That distinction is load-bearing for the ORDER
# rule -- see `derive_containment`'s docstring (R503-C).
RESOLVING_SINK_NAMES = ("realpathSync", "statSync", "lstatSync", "existsSync")

GUARDS = [
    # (id, expectation, template) -- template may use {guard}, {var}
    ("none", "NO", None),
    ("route-prefix", "NO", "if ({req}.path.startsWith('/api/')) return null;"),
    ("unrelated-var", "NO",
     "if (!{aux}.startsWith({guard} + path.sep)) return null;"),
    ("other-site", "NO", None),      # rendered specially
    ("after-the-read", "NO", None),  # rendered specially
    ("genuine", "YES",
     "if (!{var}.startsWith({guard} + path.sep)) return null;"),
]

PREAMBLE = """import fs from 'fs';
import path from 'path';
const join = path.join, resolve = path.resolve;
const readFileSync = fs.readFileSync;
const fetch = globalThis.fetch;
const axios = globalThis.axios;
const http = { get: globalThis.fetch, request: globalThis.fetch };
"""


class Draw:
    """A name drawer with per-slot discipline: two different slots must not
    accidentally receive the SAME name, because that would silently change
    the case's semantics (e.g. `raw` and `var` becoming one variable)."""

    def __init__(self, rng):
        self.rng = rng
        self.used = {}

    def take(self, key):
        pool = NAME_POOLS[key]
        for _ in range(80):
            n = self.rng.choice(pool)
            if n not in self.used.setdefault(key, set()):
                self.used[key].add(n)
                return n
        n = self.rng.choice(pool) + str(self.rng.randrange(100000))
        self.used[key].add(n)
        return n


def derive_containment(body: str, marker: str) -> str:
    """Compute the containment verdict FROM THE EMITTED CODE.

    The verdict is a property of the code, not of the label the generator
    happened to attach.  A guard CONFINES the served path when ALL of:

      1. it is a path-confinement SHAPE (a `startsWith(<root> + sep)` test,
         a `path.relative(root, target)` test, or a `realpath` resolution
         compared against a root) -- a route-prefix test is NOT one;
      2. it appears BEFORE the sink in the same site;
      3. it constrains the SAME variable the sink consumes.

    Everything else is "NO": no guard, a guard elsewhere, a guard that runs
    after the bytes were read, or a guard about a different variable.

    RULE 2 IS SCOPED TO THE SINK KIND (R503-C, measured)
    ------------------------------------------------------
    The first version applied rule 2 to EVERY sink kind, and that made the
    corpus's own ground truth WRONG for RESOLVING sinks.

    A SERVING sink (readFileSync, sendFile, fetch) opens content AT the sink
    line, so a guard that runs after it is too late: the bytes are already
    gone.  A RESOLVING sink (realpathSync, statSync, existsSync) does not
    open content -- it PRODUCES A VALUE that a later guard compares.
    Resolve-then-compare is the CORRECT shape, and it is the shape both
    repos actually use (llm-benchmark's `src/web/server.ts` resolves, then
    compares, then serves).

    Measured with `r503_resolving_order_audit.py`: 15 of 200 generated
    verdicts were wrong under the unscoped rule, and ALL 15 were RESOLVING
    sinks.  A corpus whose ground truth contradicts the class it claims to
    encode grades the scanner for a defect the corpus invented -- which is
    worse than no corpus at all.
    """
    lines = body.split("\n")
    sink_idx = None
    for i, l in enumerate(lines):
        if marker in l:
            sink_idx = i
            break
    if sink_idx is None:
        raise KeyError("marker %r not found in body:\n%s" % (marker, body))

    # Is this a RESOLVING sink?  A resolving sink yields a value; a serving
    # sink opens content.  The ORDER rule differs between them.
    resolving = any(r in marker for r in RESOLVING_SINK_NAMES)

    # the variable the SINK consumes
    m = re.search(r"\(([A-Za-z_$][\w$]*)\)", marker)
    if not m:
        raise ValueError("cannot derive the served variable from %r" % marker)
    served = m.group(1)

    # For a RESOLVING sink, the guard may constrain the variable the sink
    # PRODUCED, not only the one it consumed.  `const real =
    # fs.realpathSync(p); if (!real.startsWith(ROOT + sep)) ...` is the
    # canonical resolve-then-compare shape, and the guard is on `real`.
    # The DETECTOR's own RULE 1 accepts a guard on a DESCENDANT for the
    # same reason; the corpus has to encode the same class.
    sink_outputs = set()
    if resolving:
        out = re.search(r"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*"
                        r"(?:fs\.)?" + re.escape(marker.split("(")[0].split(".")[-1])
                        + r"\s*\(", lines[sink_idx])
        if out:
            sink_outputs.add(out.group(1))
        # the marker itself may be an assignment: `const real = fs.realpathSync(p)`
        lhs = re.search(r"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^=]*"
                        + re.escape(marker.split("(")[0].split(".")[-1]),
                        lines[sink_idx])
        if lhs:
            sink_outputs.add(lhs.group(1))

    # the variables a guard may legitimately constrain
    constrainable = {served} | sink_outputs

    for i, l in enumerate(lines):
        if "startsWith(" not in l and "path.relative(" not in l \
                and "realpath" not in l:
            continue
        # (1) the shape must be a PATH-CONFINMENT test: the comparison is
        # against a ROOT-ish identifier plus a separator, or a relative().
        g = re.search(r"!\s*([A-Za-z_$][\w$]*)\.startsWith\(\s*"
                      r"([A-Za-z_$][\w$]*)\s*\+\s*(?:path\s*\.\s*)?sep", l)
        if not g:
            g = re.search(r"([A-Za-z_$][\w$]*)\.startsWith\(\s*"
                          r"([A-Za-z_$][\w$]*)\s*\+\s*(?:path\s*\.\s*)?sep", l)
        if not g:
            g = re.search(r"path\s*\.\s*relative\(\s*([A-Za-z_$][\w$]*)\s*,"
                          r"\s*([A-Za-z_$][\w$]*)", l)
            if g:
                guarded = g.group(2)
                # the ORDER rule, scoped to the sink kind
                if (i < sink_idx or resolving) and guarded in constrainable:
                    return "YES"
            continue
        guarded = g.group(1)
        # (2) the guard must PRECEDE the sink -- UNLESS the sink is a
        # RESOLVING one, in which case the guard legitimately follows it.
        if i >= sink_idx and not resolving:
            continue
        # (3) it must constrain the SERVED variable (or, for a resolving
        # sink, the variable the sink produced)
        if guarded in constrainable:
            return "YES"
    return "NO"


def build_instance(rng: random.Random):
    """Build ONE instance of the class.  Returns a dict describing it.

    The statement order is load-bearing and is the thing the first draft got
    wrong: a value must be DECLARED before it is USED, and the chain steps
    must precede the path construction that consumes the chain's head.  A
    generator that emits a use-before-declaration produces a corpus whose
    ground truth is about code that cannot run -- the corpus would then be
    measuring the SCANNER's tolerance of broken code, not the class.
    """
    d = Draw(rng)

    base = d.take("base")
    guard_root = d.take("guard")
    # The SOURCE OBJECT is the handler's own parameter, so it is always
    # DECLARED.  Whether it is an HTTP-request shape or a MESSAGE shape is
    # decided by the NAME POOL it is drawn from -- `req`/`ctx`/`request` for
    # the HTTP transport, `msg`/`message`/`envelope`/`frame`/`payload`/
    # `event` for the peer-message transport.  A first draft drew a separate
    # message object that was never declared, so the generated code was a
    # ReferenceError and the corpus was grading broken code.
    use_msg = rng.random() < 0.35
    reqobj = d.take("msg" if use_msg else "req")
    msgobj = reqobj
    urlfield = d.take("urlfield")
    var = d.take("var")
    aux = d.take("aux")
    unrelated = d.take("aux")

    # --- the source ------------------------------------------------------
    src_obj = reqobj
    src_expr = "%s.%s" % (src_obj, urlfield)

    # --- the transformation CHAIN --------------------------------------
    # Each step DECLARES a fresh variable and the chain's head advances.
    # The transform templates are EXPRESSIONS ONLY, so the declaration is
    # always emitted here -- a transform can never produce a double `const`.
    chain_len = rng.randrange(0, 4)
    steps = []
    cur = src_expr
    for _ in range(chain_len):
        tname, tmpl = rng.choice(TRANSFORMS)
        if tname == "destructure":
            field = d.take("urlfield")
            steps.append("const { %s } = %s;" % (field, src_obj))
            cur = field
            continue
        aux2 = d.take("aux")
        expr = tmpl.format(src=cur, aux=aux2, field=urlfield, reqobj=src_obj)
        steps.append("const %s = %s;" % (aux2, expr))
        cur = aux2

    # --- the sink --------------------------------------------------------
    sink_kind = rng.choice(["fs", "fs", "fs", "net", "resolving"])
    if sink_kind == "net":
        sink_name = rng.choice(NET_SINKS)
    elif sink_kind == "resolving":
        sink_name = rng.choice(RESOLVING_SINKS)
    else:
        sink_name = rng.choice(FS_SINKS)

    # --- the guard -------------------------------------------------------
    guard_id = rng.choice([g[0] for g in GUARDS])
    guard_expect = dict((g[0], g[1]) for g in GUARDS)[guard_id]
    guard_stmt = None
    other_site = None

    joiner = rng.choice(["join", "resolve"])
    # The SERVED path's base is the guard's root ONLY when the guard is the
    # genuine one; otherwise the served path is rooted elsewhere and the
    # guard cannot confine it.  (Getting this wrong would make the ground
    # truth itself wrong -- the corpus's verdict must be computed from the
    # code, not asserted.)
    path_root = guard_root if guard_id == "genuine" else base

    if guard_id == "route-prefix":
        guard_stmt = "if (%s.path.startsWith('/api/')) return null;" % reqobj
    elif guard_id == "unrelated-var":
        # The guarded variable is a CONSTANT that is NOT the served path --
        # the guard is shaped like a confinement check but constrains the
        # wrong thing.  It must be a DECLARED name, or the case grades a
        # ReferenceError rather than the class.
        guard_stmt = "if (!%s.startsWith(%s + path.sep)) return null;" % (
            unrelated, guard_root)
    elif guard_id == "genuine":
        guard_stmt = "if (!%s.startsWith(%s + path.sep)) return null;" % (
            var, guard_root)
    elif guard_id == "other-site":
        # the other site's guard uses its OWN variable name (not `aux`), so
        # the two sites cannot be confused by a name-aware scanner -- the
        # site scope must be what decides, not the name.
        gvar = d.take("aux")
        other_site = (
            "export function guardFn(%s: any) {\n"
            "  const %s = path.resolve(%s, %s.%s);\n"
            "  if (!%s.startsWith(%s + path.sep)) return null;\n"
            "  return %s;\n"
            "}" % (reqobj, gvar, guard_root, reqobj, urlfield,
                   gvar, guard_root, gvar))
    elif guard_id == "after-the-read":
        guard_stmt = "if (!%s.startsWith(%s + path.sep)) return null;" % (
            var, guard_root)

    # --- assemble -------------------------------------------------------
    # ORDER: chain steps -> path -> [sink] -> [guard].
    #
    # The CONTAINMENT VERDICT IS DERIVED FROM THE EMITTED CODE, not from the
    # guard's label.  A first draft labelled the verdict by the guard's
    # identity, and that produced 17/200 cases whose label contradicted
    # their own code: a "net" sink emitted the "after-the-read" guard BEFORE
    # the sink (so the guard DID precede it and DID confine it), and a
    # "resolving" sink emitted no guard at all while still being labelled
    # "genuine".  A corpus whose ground truth contradicts its own code
    # grades a scanner for defects the corpus invented -- worse than no
    # corpus at all (R503's rule: the verdict must be computed FROM the
    # subject, never asserted about it).
    body_lines = []
    body_lines.append("const %s = '/srv/root';" % guard_root)
    if other_site:
        body_lines.append(other_site)
    body_lines.append("export function handler(%s: any) {" % reqobj)

    # the SERVED path's base must be a DECLARED identifier too -- an
    # undeclared name would make the generated code a ReferenceError and the
    # corpus would be grading broken code.
    body_lines.append("  const %s = '%s';" % (base, base + "/sub"))
    if guard_id == "unrelated-var":
        body_lines.append("  const %s = '%s';" % (unrelated, unrelated + "/x"))

    for s in steps:
        body_lines.append("  " + s)
    body_lines.append("  const %s = path.%s(%s, %s);" % (
        var, joiner, path_root, cur))

    if sink_kind == "resolving":
        # A RESOLVING sink does not open content: it produces a path value a
        # guard compares afterwards.  The read is a SEPARATE statement.
        real = d.take("aux")
        body_lines.append("  const %s = fs.%s(%s);" % (real, sink_name, var))
        marker = "fs.%s(%s)" % (sink_name, var)
        if guard_stmt:
            body_lines.append("  " + guard_stmt)
    elif sink_kind == "net":
        if guard_id == "after-the-read":
            body_lines.append("  const resp = %s(%s);" % (sink_name, var))
            body_lines.append("  " + guard_stmt)
            body_lines.append("  return resp;")
            marker = "%s(%s)" % (sink_name, var)
        else:
            if guard_stmt:
                body_lines.append("  " + guard_stmt)
            body_lines.append("  return %s(%s);" % (sink_name, var))
            marker = "%s(%s)" % (sink_name, var)
    else:
        if guard_id == "after-the-read":
            body_lines.append("  const data = fs.readFileSync(%s);" % var)
            body_lines.append("  if (!%s.startsWith(%s + path.sep)) return null;" % (
                var, guard_root))
            body_lines.append("  return data;")
            marker = "readFileSync(%s)" % var
        else:
            if guard_stmt:
                body_lines.append("  " + guard_stmt)
            body_lines.append("  return fs.readFileSync(%s);" % var)
            marker = "readFileSync(%s)" % var
    body_lines.append("}")
    body = "\n".join(body_lines)

    kind = "SUBJECT"
    expect = "VULN"
    containment = derive_containment(body, marker)

    return {
        "body": body, "kind": kind, "expect": expect,
        "containment": containment, "marker": marker,
        "class": "chain%d-%s-%s" % (chain_len, sink_kind, guard_id),
        "slots": {"base": base, "guard": guard_root, "req": reqobj,
                  "msg": msgobj, "urlfield": urlfield, "var": var, "aux": aux},
    }


def body_line(body: str, marker: str, preamble_lines: int) -> int:
    for i, l in enumerate(body.split("\n"), start=1):
        if marker in l:
            return i + preamble_lines
    raise KeyError("marker %r not found in body:\n%s" % (marker, body))


def generate(dest_dir: str, n: int = 40, seed: int = 20261025, prefix="gen"):
    """Emit n instances; returns the manifest (the ground truth)."""
    rng = random.Random(seed)
    os.makedirs(dest_dir, exist_ok=True)
    preamble_lines = PREAMBLE.count("\n")
    manifest = []
    for i in range(n):
        inst = build_instance(rng)
        fname = "%s_%05d.ts" % (prefix, i)
        p = os.path.join(dest_dir, fname)
        with open(p, "w", encoding="utf8") as f:
            f.write(PREAMBLE)
            f.write(inst["body"] + "\n")
        line = body_line(inst["body"], inst["marker"], preamble_lines)
        manifest.append({
            "file": fname, "kind": inst["kind"], "expect": inst["expect"],
            "containment": inst["containment"], "line": line,
            "marker": inst["marker"], "class": inst["class"],
        })
    return manifest


def compile_check(dest_dir: str, files=None) -> list:
    """Type-check the generated corpus.

    A corpus whose cases do not COMPILE grades the scanner's tolerance of
    broken code, not the class.  This is the corpus-side twin of R501's
    rule for the scanner side: MEASURE the instrument before reading its
    output -- and the instrument here is the CORPUS.

    Returns the list of files that failed to compile (empty == all good).
    Requires `tsc`; if `tsc` is unavailable the check is reported as
    UNAVAILABLE rather than silently passing (R405's rule: an errored leg is
    not a zero).
    """
    import shutil
    import subprocess
    import tempfile

    tsc = shutil.which("tsc") or shutil.which("npx")
    if tsc is None:
        return None
    files = files or sorted(
        os.path.join(dest_dir, f) for f in os.listdir(dest_dir)
        if f.endswith(".ts"))
    with tempfile.TemporaryDirectory() as td:
        cfg = os.path.join(td, "tsconfig.json")
        with open(cfg, "w", encoding="utf8") as f:
            f.write(json.dumps({
                "compilerOptions": {
                    "noEmit": True, "target": "ES2020",
                    "module": "ESNext", "moduleResolution": "bundler",
                    "skipLibCheck": True, "strict": False,
                    "types": [], "lib": ["ES2020", "DOM"],
                },
                "include": files,
            }))
        if tsc.endswith("npx"):
            cmd = ["npx", "--yes", "typescript", "tsc", "-p", cfg]
        else:
            cmd = [tsc, "-p", cfg]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    bad = []
    for line in (proc.stdout + proc.stderr).split("\n"):
        if "(" in line and ":" in line and ".ts(" in line:
            for f in files:
                if f in line:
                    bad.append(f)
                    break
    return sorted(set(bad))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dest")
    ap.add_argument("--n", type=int, default=40)
    ap.add_argument("--seed", type=int, default=20261025)
    ap.add_argument("--prefix", default="gen")
    a = ap.parse_args()
    m = generate(a.dest, a.n, a.seed, a.prefix)
    print(json.dumps(m, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
