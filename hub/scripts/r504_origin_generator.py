#!/usr/bin/env python3
"""
R504 -- THE ORIGIN GENERATOR: a corpus over the TRUST property.

R503 left one question open, and named it:

    "the next step is a TRUST distinction (a value that crossed a request
     boundary), not a wider vocabulary -- and the generated corpus is the
     instrument that will tell us when that distinction is right, because it
     is the only corpus a memoriser cannot pass."

This file is the corpus side of that sentence.  R503's generator composed the
class of a REQUEST-DERIVED value; R504's generator composes the class of an
ATTACKER-CONTROLLED value, which is a DIFFERENT class:

    an attacker-controlled value is a value that
      (a) ORIGINATES at the PER-REQUEST invocation, AND
      (b) is DELIVERED across a boundary by a REGISTERED entry point.

WHY THE AXIS MUST BE STRUCTURAL, NOT NOMINAL
----------------------------------------------
The first draft of this generator drew the origin from the NAME of the
parameter (`req` vs `config`).  That is CIRCULAR: a name-based rule keys on
the name, so it would score perfectly on a corpus whose only signal is the
name, and the corpus would measure nothing.

So the origin here is a STRUCTURAL fact about the ACCESS PATH:

    * REQUEST origin -- the tainted expression is rooted at the INNER
      closure's parameter -- the PER-REQUEST invocation.
    * CONFIG origin  -- the tainted expression is rooted at the OUTER
      factory's parameter -- a FACTORY-TIME capture, fixed when the handler
      was constructed and never varying per request.

Both are "a parameter field".  A name-based rule and a ROLE-based rule are
blind to the difference between them, because both look only at the shape
`X.field` and never ask WHICH invocation X belongs to.

And delivery is likewise structural, not nominal: the closure is either
handed to a boundary registration call (`http.createServer`) or it is not.

THE CANONICAL PRECEDENT
-----------------------
CodeQL does not decide "is this value untrusted" by the NAME of the variable
that holds it.  It defines a class `RemoteFlowSource` (github/codeql,
`javascript/ql/lib/semmle/javascript/security/dataflow/RemoteFlowSources.qll`),
whose instances are ACCESS PATHS -- e.g. `window.location.search`,
`browser-url-query` -- and it carries a THREAT MODEL label:

    abstract class RemoteFlowSource extends ThreatModelSource::Range {
      override string getThreatModel() { result = "remote" }
    }

and a parallel `LocalSourceNode` for the trusted side.  The same file also
documents the extension point (`codeql-javascript-remote-flow-sources.json`),
which is a list of access paths -- i.e. STILL an access-path enumeration, but
one attached to the TRUST LABEL, not to the variable.

Semgrep's taint mode is the same three-part model: `pattern-sources`,
`pattern-propagators`, `pattern-sinks` -- the source is a PATTERN (an access
path), and the rule's verdict is about the FLOW, not about the name.

So the canonical answer to R503's question is:

    TRUST is a property of the ORIGIN ACCESS PATH and of the ENTRY POINT
    that delivers it.  It is NOT a property of the variable's name, and it
    is NOT a property of the parameter's role.

WHAT THIS GENERATOR EMITS
--------------------------
Each instance is TWO files, because the trust property needs two files to
exist at all:

    <base>_svc.ts   -- the handler: a factory that RETURNS a closure whose
                      parameter carries the value
    <base>_main.ts  -- the registration: either the closure is handed to a
                      boundary registration call (`http.createServer`), or it
                      is not

The ground truth is computed FROM THE EMITTED CODE (the same discipline as
R503's `derive_containment`): an instance is ATTACKER-CONTROLLED iff the
value's origin is the per-request parameter AND that closure is delivered to
a boundary registration.

CORPUS DISCIPLINE (R503's rule, applied to this file)
------------------------------------------------------
The generated code MUST COMPILE.  A corpus whose cases do not compile grades
the scanner's tolerance of broken code, not the class.  `compile_check()`
below type-checks every emitted file and reports the failures; a corpus with
failures is a CORPUS DEFECT, not a scanner defect.

USAGE
-----
    python3 r504_origin_generator.py <dest> [--n N] [--seed S]
"""
import argparse
import json
import os
import random

# --- the randomisable vocabulary ------------------------------------------
#
# THE REQUEST POOL AND THE CONFIG POOL ARE THE SAME SET.
#
# The first draft of this generator had two DISJOINT pools (`req`/`request`/
# `ctx`/`incoming` vs `cfg`/`config`/`options`/`settings`).  That made the
# NAME a perfect predictor of the ORIGIN -- so a name-based rule would have
# scored perfectly on this corpus and the corpus would have measured
# nothing.  The suite caught it: an arm asserting that the two pools
# OVERLAP failed.
#
# With ONE pool, the name says nothing about the origin; only WHICH
# INVOCATION the parameter belongs to does.  That is the axis under test.
NAME_POOLS = {
    "svc": ["svc", "handler", "ui", "staticSvc", "assetSvc"],
    "main": ["main", "bootstrap", "server", "entry"],
    "cfg": ["req", "request", "ctx", "incoming", "config", "cfg", "options"],
    "cfgfield": ["baseUrl", "root", "endpoint", "dir", "prefix",
                 "url", "target", "pathname", "resource", "relPath", "file"],
    "req": ["req", "request", "ctx", "incoming", "config", "cfg", "options"],
    "urlfield": ["baseUrl", "root", "endpoint", "dir", "prefix",
                 "url", "target", "pathname", "resource", "relPath", "file"],
    "var": ["p", "candidate", "rel", "targetPath", "outPath"],
    "aux": ["aux", "tmp", "step1", "mid", "scratch"],
    "root": ["PUBLIC_DIR", "SERVE_ROOT", "assetsDir", "ASSET_ROOT"],
    "guard": ["ROOT", "ALLOWED_ROOT", "baseRoot", "SAFE_ROOT"],
}

TRANSFORMS = [
    ("direct", "{src}"),
    ("alias", "{src}"),
    ("decode", "decodeURIComponent({src})"),
    ("strip", "{src}.replace(/^\\/+/, '')"),
    ("split", "{src}.split('?')[0]"),
    ("template", "`${src}`"),
]

PREAMBLE_SVC = """import fs from 'fs';
import path from 'path';
const join = path.join, resolve = path.resolve;
const readFileSync = fs.readFileSync;
const fetch = globalThis.fetch;
const axios = globalThis.axios;
"""

PREAMBLE_MAIN = """import http from 'http';
const createServer = http.createServer;
"""

FS_SINKS = ["readFileSync", "readFile"]
NET_SINKS = ["fetch", "axios"]


class Draw:
    """A name drawer with per-slot discipline (R503's rule): two different
    slots must not accidentally receive the SAME name, because that would
    silently change the case's semantics.

    THE ORIGIN SLOTS SHARE A NAMESPACE.

    The factory's parameter and the closure's parameter are drawn from the
    SAME pool (so the name says nothing about which one is per-request),
    but they must not receive the SAME name -- because if they did, the
    config-origin expression `ctx.dir` and the request-origin expression
    `ctx.dir` would be the SAME TEXT, and the trust rule could not tell
    them apart.  The first draft allowed that collision; the suite caught
    it as six CONFIG over-fires.

    So: one pool, one namespace, two distinct names.
    """

    # slots that share a namespace (must not collide with each other)
    NAMESPACES = {
        "cfg": "origin-param",
        "req": "origin-param",
        "urlfield": "origin-field",
        "cfgfield": "origin-field",
    }

    def __init__(self, rng):
        self.rng = rng
        self.used = {}

    def take(self, key):
        pool = NAME_POOLS[key]
        ns = self.NAMESPACES.get(key, key)
        used = self.used.setdefault(ns, set())
        for _ in range(80):
            n = self.rng.choice(pool)
            if n not in used:
                used.add(n)
                return n
        n = self.rng.choice(pool) + str(self.rng.randrange(100000))
        used.add(n)
        return n


def build_instance(rng: random.Random, svc_file_stem: str = "svc"):
    """Build ONE instance of the class.

    `svc_file_stem` is the on-disk stem of the SERVICE file.  The
    registration file must import it by that exact name, or the trust
    resolver cannot resolve the factory -- and an unresolvable factory
    reads exactly like a handler that does not exist.
    """
    d = Draw(rng)

    svc = d.take("svc")
    fn = "make" + svc.capitalize()
    main = d.take("main")
    cfgobj = d.take("cfg")
    cfgfield = d.take("cfgfield")
    reqobj = d.take("req")
    urlfield = d.take("urlfield")
    var = d.take("var")
    root = d.take("root")
    guard = d.take("guard")

    origin = rng.choice(["REQUEST", "CONFIG"])
    delivery = rng.choice(["DIRECT", "FACTORY", "NONE"])
    sink_kind = rng.choice(["fs", "net"])
    guard_kind = rng.choice(["none", "genuine"])

    sink = rng.choice(FS_SINKS if sink_kind == "fs" else NET_SINKS)

    # --- the ORIGIN (STRUCTURAL) ----------------------------------------
    # REQUEST: rooted at the INNER closure's parameter -- the per-request
    #          invocation.
    # CONFIG:  rooted at the OUTER factory's parameter -- a factory-time
    #          capture, fixed at construction and never varying per request.
    if origin == "REQUEST":
        src_expr = "%s.%s" % (reqobj, urlfield)
    else:
        src_expr = "%s.%s" % (cfgobj, cfgfield)

    # --- the CHAIN -------------------------------------------------------
    chain_len = rng.randrange(0, 4)
    steps = []
    cur = src_expr
    for _ in range(chain_len):
        tname, tmpl = rng.choice(TRANSFORMS)
        a = d.take("aux")
        steps.append("const %s = %s;" % (a, tmpl.format(src=cur)))
        cur = a

    # --- the SINK --------------------------------------------------------
    if sink_kind == "fs":
        value_expr = "join(%s, %s)" % (root, cur)
    else:
        value_expr = "'https://' + %s" % cur

    body = []
    if guard_kind == "genuine":
        body.append("const %s = %s;" % (guard, root))
    body.append("const %s = %s;" % (var, value_expr))
    if guard_kind == "genuine":
        body.append("if (!%s.startsWith(%s + path.sep)) return null;" % (var, guard))
    sink_line = "return %s(%s);" % (sink, var)
    body.append(sink_line)

    # --- the SERVICE FILE ------------------------------------------------
    # The handler is a FACTORY that RETURNS a closure.  This is the shape
    # both real repos use (`createUiRequestHandler(publicDir)`).
    # The factory takes a CONFIG; the closure takes the PER-REQUEST value.
    svc_lines = []
    svc_lines.append("export function %s(%s: any) {" % (fn, cfgobj))
    svc_lines.append("  return (%s: any) => {" % reqobj)
    for s in steps:
        svc_lines.append("    " + s)
    for b in body:
        svc_lines.append("    " + b)
    svc_lines.append("  };")
    svc_lines.append("}")
    svc_src = PREAMBLE_SVC + "\n".join(svc_lines) + "\n"

    # --- the REGISTRATION FILE ------------------------------------------
    # DIRECT / FACTORY: the closure is handed to a boundary registration.
    # NONE:             the closure is never registered.
    #
    # THE IMPORT SPECIFIER MUST RESOLVE.  The first draft emitted
    # `from './svc'` while the file on disk was `org_00000_svc.ts`, so the
    # trust resolver could not resolve the factory and every REQUEST case
    # read as "not per-request" -- a corpus defect that would have been
    # reported as a scanner defect.  This is R497's lesson in a new place:
    # a resolution that silently fails reads exactly like a correct
    # negative.
    #
    # AND THE SPECIFIER MUST MATCH THE CONVENTION THE PRODUCTION CODE
    # USES.  TypeScript sources import each other with a `.js` specifier
    # even though the file on disk is `.ts` (the `moduleResolution:
    # nodenext` convention) -- `hub/src/index.ts` does
    # `import { createUiRequestHandler } from './ui_static.js'`.  The first
    # draft emitted an EXTENSIONLESS specifier, so the corpus never
    # exercised that convention, and the M3 mutation (removing the
    # `.js` -> `.ts` resolution) SURVIVED -- a corpus that does not cover
    # the production convention cannot catch a break in it.
    #
    # So the corpus draws the specifier SHAPE at random: extensionless OR
    # `.js` (which is what the resolver must map back to `.ts`).
    spec = svc_file_stem + (".js" if rng.random() < 0.5 else "")
    main_lines = []
    main_lines.append("import { %s } from './%s';" % (fn, spec))
    if delivery in ("DIRECT", "FACTORY"):
        main_lines.append("const %s = %s({ %s: 'https://example.invalid' });" % (main, fn, cfgfield))
        main_lines.append("const %sServer = createServer(%s);" % (main, main))
    else:
        main_lines.append("export const %s = %s({ %s: 'https://example.invalid' });" % (main, fn, cfgfield))
    main_src = PREAMBLE_MAIN + "\n".join(main_lines) + "\n"

    # --- the GROUND TRUTH ------------------------------------------------
    # ATTACKER-CONTROLLED iff:
    #   the origin is the PER-REQUEST parameter, AND
    #   the closure carrying it is DELIVERED to a boundary registration.
    attacker_controlled = (origin == "REQUEST" and delivery in ("DIRECT", "FACTORY"))

    return {
        "svc_src": svc_src,
        "main_src": main_src,
        "origin": origin,
        "delivery": delivery,
        "sink_kind": sink_kind,
        "guard": guard_kind,
        "chain_len": chain_len,
        "attacker_controlled": attacker_controlled,
        "sink_line": sink_line.strip(),
        "var": var,
        "svc": svc,
        "fn": fn,
        "cfgobj": cfgobj,
        "cfgfield": cfgfield,
        "reqobj": reqobj,
    }


def generate(dest_dir: str, n: int = 40, seed: int = 20261026, prefix: str = "org"):
    os.makedirs(dest_dir, exist_ok=True)
    rng = random.Random(seed)
    manifest = []
    for i in range(n):
        base = "%s_%05d" % (prefix, i)
        svc_file = base + "_svc.ts"
        main_file = base + "_main.ts"
        inst = build_instance(rng, svc_file_stem=base + "_svc")
        with open(os.path.join(dest_dir, svc_file), "w", encoding="utf8") as f:
            f.write(inst["svc_src"])
        with open(os.path.join(dest_dir, main_file), "w", encoding="utf8") as f:
            f.write(inst["main_src"])
        manifest.append({
            "svc": svc_file,
            "main": main_file,
            "origin": inst["origin"],
            "delivery": inst["delivery"],
            "sink_kind": inst["sink_kind"],
            "guard": inst["guard"],
            "chain_len": inst["chain_len"],
            "attacker_controlled": inst["attacker_controlled"],
            "sink_line": inst["sink_line"],
            "var": inst["var"],
            "reqobj": inst["reqobj"],
            "cfgobj": inst["cfgobj"],
        })
    return manifest


def compile_check(dest_dir: str, files=None):
    """Type-check the generated corpus.

    A corpus whose cases do not COMPILE grades the scanner's tolerance of
    broken code, not the class.  Returns the list of files that failed to
    compile (empty == all good), or None when `tsc` is UNAVAILABLE (an
    errored leg is not a zero -- R405's rule).
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
            cmd = [tsc, "--yes", "typescript", "tsc", "-p", cfg]
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
    ap.add_argument("--seed", type=int, default=20261026)
    ap.add_argument("--prefix", default="org")
    a = ap.parse_args()
    m = generate(a.dest, a.n, a.seed, a.prefix)
    print(json.dumps(m, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
