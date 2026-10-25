#!/usr/bin/env python3
"""
R504 -- THE TRUST RESOLVER: per-request provenance, resolved across files.

THE QUESTION R503 LEFT OPEN
---------------------------
R503 measured the obvious repair -- "every field of every function parameter
is a source" -- and found it WRONG in a specific, measured way:

    GENERATED corpus  28/60 -> 60/60   (sensitivity fixed)
    PRODUCTION         6 hits -> 25 hits (4x explosion)
    and every one of the 19 new hits was a CONFIG-DERIVED value.

The ROLE repair buys sensitivity by destroying the TRUST distinction.  It has
no ORIGIN and no DELIVERY, so it cannot tell a value that arrives with a
per-request invocation from a value captured once at factory time.

THIS FILE ANSWERS THE QUESTION
------------------------------
The canonical answer, taken from CodeQL (github/codeql,
`javascript/ql/lib/semmle/javascript/security/dataflow/RemoteFlowSources.qll`):

    TRUST is a property of the ORIGIN ACCESS PATH and of the ENTRY POINT
    that delivers it -- not of the variable's name, and not of its role.

So this file computes, for a project, the set of PER-REQUEST BINDINGS:

    (file, param_name) -> this parameter receives a value that arrives WITH
                           a per-request invocation.

A binding is per-request iff the handler that owns the parameter is
DELIVERED to a boundary registration.  The delivery may be:

    DIRECT      -- a closure literal handed to the registration call;
    RESULT      -- an identifier bound to a closure / factory RESULT, handed
                   to the registration call;
    TRANSITIVE  -- the factory lives in ANOTHER MODULE, so the registration
                   names an import and the factory's file returns the closure.

That last case is the one the production code actually uses, and it is why
a per-FILE rule cannot decide the property:

    hub/src/index.ts       http.createServer(createUiRequestHandler(publicDir))
    hub/src/ui_static.ts   export function createUiRequestHandler(publicDir) {
                             return (req, res) => { ... req.url ... }
                           }

`req` is per-request.  `publicDir` is not.  A per-file rule sees only
"a parameter field" in both cases.

WHAT THIS FILE DELIBERATELY DOES NOT DO
---------------------------------------
It does not decide trust by NAME.  There is no list of "trusted-looking"
identifiers.  `req`, `ctx` and `incoming` are all in the corpus's request
pool, and `config`/`cfg`/`options` are all in its config pool -- and BOTH
pools produce the same `X.field` syntax.  The ONLY difference is WHICH
invocation X belongs to, and that is what this file computes.

USAGE
-----
    python3 r504_trust.py <project_root>        # print the bindings
"""
import os
import re
import sys

# --- the boundary registration vocabulary ---------------------------------
# A "boundary" is where a handler crosses INTO the process from outside it.
# This is a TRANSPORT vocabulary, not a trust vocabulary: naming
# `createServer` does not say the values it receives are untrusted, it says
# that this is a place where the outside world gets to talk.
REGISTRATION_CALLEE = re.compile(
    r"\b(?:createServer|app\.(?:get|post|put|patch|delete|use|all)|"
    r"router\.(?:get|post|put|patch|delete|use)|server\.(?:on|once)|"
    r"ws\.on|addEventListener|subscribe)\b")

EXTENSIONS = (".ts", ".tsx", ".js", ".mjs", ".cjs")
SKIP_DIRS = {"node_modules", ".git", "dist", "build", "coverage", "out",
             "_tmp", ".next", "target", "__pycache__", ".venv", "venv"}


# --- syntax shapes --------------------------------------------------------
FUNC_DECL = re.compile(
    r"\b(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(([^()]*)\)")
RETURN_ARROW = re.compile(r"return\s*\(([^()]*)\)\s*=>")
RETURN_ARROW_NOARG = re.compile(r"return\s+([A-Za-z_$][\w$]*)\s*=>")
CALL_ASSIGN = re.compile(
    r"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*"
    r"(?:async\s+)?(?:([A-Za-z_$][\w$]*)\s*\()|"
    r"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?"
    r"\(([^()]*)\)\s*=>")
IMPORT_NAMED = re.compile(r"import\s*\{([^}]*)\}\s*from\s*['\"]([^'\"]+)['\"]")


def strip_comments_only(text: str) -> str:
    """Blank out COMMENTS only, preserving string literals.

    `strip_comments` also blanks string literals, which is right for the
    code-shape analysis but WRONG for import parsing: an import specifier
    IS a string literal (`from './ui_static.js'`).  Blanking it makes every
    import unresolvable -- and an unresolvable import looks exactly like a
    handler that does not exist.  That is the R497 lesson again: a
    resolution that silently fails reads as a correct negative.
    """
    out = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            j = text.find("\n", i)
            j = n if j == -1 else j
            out.append(" " * (j - i))
            i = j
        elif c == "/" and i + 1 < n and text[i + 1] == "*":
            j = text.find("*/", i + 2)
            j = n if j == -1 else j + 2
            seg = text[i:j]
            out.append("".join(ch if ch == "\n" else " " for ch in seg))
            i = j
        else:
            out.append(c)
            i += 1
    return "".join(out)


def strip_comments(text: str) -> str:
    """Blank out comments and string literals, preserving offsets/newlines.

    R460-3: a census must not read PROSE as code.  A comment that mentions
    `req.url` is not a source; a comment that mentions `createServer` is
    not a registration.
    """
    out = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            j = text.find("\n", i)
            j = n if j == -1 else j
            out.append(" " * (j - i))
            i = j
        elif c == "/" and i + 1 < n and text[i + 1] == "*":
            j = text.find("*/", i + 2)
            j = n if j == -1 else j + 2
            seg = text[i:j]
            out.append("".join(ch if ch == "\n" else " " for ch in seg))
            i = j
        elif c in ("'", '"', "`"):
            q = c
            j = i + 1
            while j < n:
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == q:
                    j += 1
                    break
                j += 1
            seg = text[i:j]
            out.append("".join(ch if ch == "\n" else " " for ch in seg))
            i = j
        else:
            out.append(c)
            i += 1
    return "".join(out)


def param_names(raw_params: str):
    out = []
    for part in raw_params.split(","):
        part = part.strip()
        if not part:
            continue
        part = part.split(":")[0].split("=")[0].strip()
        if part and part.isidentifier():
            out.append(part)
    return out


def split_args(text: str):
    out, depth, cur = [], 0, []
    for ch in text:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        if ch == "," and depth == 0:
            out.append("".join(cur))
            cur = []
            continue
        cur.append(ch)
    if "".join(cur).strip():
        out.append("".join(cur))
    return out


def balanced_args(code: str, open_idx: int):
    """The argument text of the call whose '(' is at `open_idx`."""
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


def _body_of(code: str, from_idx: int):
    i = code.find("{", from_idx)
    if i == -1:
        return None
    depth = 0
    j = i
    n = len(code)
    while j < n:
        if code[j] == "{":
            depth += 1
        elif code[j] == "}":
            depth -= 1
            if depth == 0:
                return code[i:j + 1]
        j += 1
    return None


def _resolve_import(from_path: str, spec: str):
    """Resolve an import specifier to a file on disk, or None.

    TypeScript source files import each other with a `.js` specifier even
    though the file on disk is `.ts` (the `moduleResolution: nodenext`
    convention).  So a `.js` specifier must also try the `.ts` sibling.
    WITHOUT this, the production code's own registration site --
    `http.createServer(createUiRequestHandler(publicDir))` in index.ts,
    where the factory lives in ui_static.ts -- is UNRESOLVED, and the whole
    per-request property collapses.  That is the R497 lesson in a new place:
    a resolution that silently fails looks exactly like a resolution that
    correctly finds nothing.
    """
    if not spec.startswith("."):
        return None
    base = os.path.normpath(os.path.join(os.path.dirname(from_path), spec))
    cands = []
    for e in EXTENSIONS:
        cands.append(base + e)
        # `.js` specifier -> `.ts` source
        if e == ".js":
            cands.append(base[:-3] + ".ts")
            cands.append(base[:-3] + ".tsx")
    cands += [os.path.join(base, "index" + e) for e in EXTENSIONS]
    for c in cands:
        if os.path.isfile(c):
            return c
    return None


def project_files(root: str):
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d not in SKIP_DIRS]
        for f in sorted(fn):
            if f.endswith(EXTENSIONS):
                yield os.path.join(dp, f)


def collect(root: str):
    """-> {path: code} for every source file under root.

    TWO views per file:
      * `code`     -- comments AND strings blanked (for shape analysis);
      * `code_imp` -- comments blanked, strings KEPT (for import parsing).
    """
    out, out_imp = {}, {}
    for p in project_files(root):
        try:
            raw = open(p, encoding="utf8", errors="replace").read()
        except OSError:
            continue
        out[p] = strip_comments(raw)
        out_imp[p] = strip_comments_only(raw)
    return out, out_imp


def factories_returning_closures(code: str):
    """-> {factory_name: [param, ...]} for every function whose body RETURNS
    a closure.

    A function that returns a VALUE (`return issues;`) is NOT a factory --
    it is a normal function.  The distinction matters: a factory's OUTER
    parameters are captured once, a normal function's parameters are
    per-call.

    This is the shape both real repos use:
        export function createUiRequestHandler(publicDir) {
          return (req, res) => { ... };
        }
    """
    out = {}
    for m in FUNC_DECL.finditer(code):
        name = m.group(1)
        body = _body_of(code, m.end())
        if body is None:
            continue
        rm = RETURN_ARROW.search(body)
        if rm:
            out[name] = param_names(rm.group(1))
            continue
        rm = RETURN_ARROW_NOARG.search(body)
        if rm:
            out[name] = []
            continue
        # `return someIdent;` -- only a factory if `someIdent` is a LOCAL
        # closure declared in this file.
        rm = re.search(r"return\s+([A-Za-z_$][\w$]*)\s*;", body)
        if rm:
            ident = rm.group(1)
            am = re.search(
                r"(?:const|let|var)\s+" + re.escape(ident) +
                r"\s*=\s*(?:async\s*)?\(([^()]*)\)\s*=>", code)
            if am:
                out[name] = param_names(am.group(1))
    return out


def _arrow_binding_names(code: str):
    """-> {ident: [params]} for `const X = (a, b) => ...` bindings."""
    out = {}
    for m in re.finditer(
            r"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*"
            r"(?:async\s*)?\(([^()]*)\)\s*=>", code):
        out[m.group(1)] = param_names(m.group(2))
    return out


def _registration_sites(code: str):
    """-> [(arg_text)] for every argument at every registration call."""
    out = []
    for m in REGISTRATION_CALLEE.finditer(code):
        op = code.find("(", m.end() - 1)
        if op == -1 or op < m.start():
            continue
        args = balanced_args(code, op)
        for a in split_args(args):
            out.append(a.strip())
    return out


def _classify_arg(arg: str):
    """-> ('closure', params) | ('ident', name) | ('call', callee) | None"""
    a = arg.strip()
    if not a:
        return None
    am = re.match(r"^(?:async\s+)?\(([^()]*)\)\s*=>", a)
    if am:
        return ("closure", param_names(am.group(1)))
    am = re.match(r"^(?:async\s+)?function\b[^()]*\(([^()]*)\)", a)
    if am:
        return ("closure", param_names(am.group(1)))
    am = re.match(r"^([A-Za-z_$][\w$]*)\s*$", a)
    if am:
        return ("ident", am.group(1))
    am = re.match(r"^([A-Za-z_$][\w$]*)\s*\(", a)
    if am:
        return ("call", am.group(1))
    return None


def resolve(root: str):
    """-> (per_request_bindings, diagnostics)

    per_request_bindings: {path: set(param_name)}
    """
    files, files_imp = collect(root)
    factories = {p: factories_returning_closures(c) for p, c in files.items()}
    arrows = {p: _arrow_binding_names(c) for p, c in files.items()}

    imports = {}
    for p, c in files_imp.items():
        m = {}
        for im in IMPORT_NAMED.finditer(c):
            mod = im.group(2)
            for part in im.group(1).split(","):
                part = part.strip()
                if not part:
                    continue
                bits = part.split(" as ")
                local = bits[-1].strip()
                exported = bits[0].strip()
                m[local] = (exported, mod)
        imports[p] = m

    # `const X = fac(args);`  -> the result binding of a factory call
    result_of = {}
    for p, c in files.items():
        for m in re.finditer(
                r"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*"
                r"(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(", c):
            result_of.setdefault(p, {})[m.group(1)] = m.group(2)

    per_request = {p: set() for p in files}
    diag = []

    for p, c in files.items():
        for arg in _registration_sites(c):
            kind = _classify_arg(arg)
            if kind is None:
                continue
            if kind[0] == "closure":
                per_request[p].update(kind[1])
                diag.append((p, "direct-closure", kind[1]))
                continue
            if kind[0] == "ident":
                ident = kind[1]
                # (a) the identifier is bound to an arrow closure
                if ident in arrows.get(p, {}):
                    per_request[p].update(arrows[p][ident])
                    diag.append((p, "ident-arrow:" + ident, arrows[p][ident]))
                    continue
                # (b) the identifier is the RESULT of a factory call
                fac = result_of.get(p, {}).get(ident)
                if fac:
                    # (b1) the factory is local
                    if fac in factories.get(p, {}):
                        per_request[p].update(factories[p][fac])
                        diag.append((p, "local-factory:" + fac, factories[p][fac]))
                        continue
                    # (b2) the factory is IMPORTED -- TRANSITIVE
                    if fac in imports.get(p, {}):
                        exported, mod = imports[p][fac]
                        target = _resolve_import(p, mod)
                        if target and exported in factories.get(target, {}):
                            # ATTRIBUTION: the binding belongs to the file
                            # where the CLOSURE BODY lives -- the file that
                            # DEFINES the factory -- not the file that
                            # registers it.  The registration file never
                            # reads `req.url`; the factory's file does.  If
                            # the binding were attributed to the registration
                            # file, the scanner would look for `req` in a file
                            # that does not contain it, and the real sink
                            # would stay invisible.
                            per_request[target].update(factories[target][exported])
                            diag.append((p, "imported-factory:" + exported,
                                         factories[target][exported], target))
                            continue
                        diag.append((p, "imported-factory-UNRESOLVED:" + exported, []))
                        continue
                diag.append((p, "ident-not-a-handler:" + ident, []))
                continue
            if kind[0] == "call":
                fac = kind[1]
                # the call is passed DIRECTLY to the registration
                if fac in factories.get(p, {}):
                    per_request[p].update(factories[p][fac])
                    diag.append((p, "direct-call-factory:" + fac, factories[p][fac]))
                    continue
                if fac in imports.get(p, {}):
                    exported, mod = imports[p][fac]
                    target = _resolve_import(p, mod)
                    if target and exported in factories.get(target, {}):
                        per_request[target].update(factories[target][exported])
                        diag.append((p, "direct-call-imported:" + exported,
                                     factories[target][exported], target))
                        continue
                diag.append((p, "direct-call-unresolved:" + fac, []))

    return {p: v for p, v in per_request.items() if v}, diag


def main() -> int:
    root = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
    bindings, diag = resolve(root)
    print("PER-REQUEST BINDINGS (by file)")
    for p in sorted(bindings):
        print("  %s -> %s" % (os.path.relpath(p, root), sorted(bindings[p])))
    print()
    print("DELIVERY SITES")
    for row in diag:
        p, how, params = row[0], row[1], row[2]
        where = ""
        if len(row) > 3 and row[3]:
            where = "  (body in %s)" % os.path.relpath(row[3], root)
        print("  %-40s %-36s %s%s" % (os.path.relpath(p, root), how, params, where))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
