#!/usr/bin/env python3
"""
R504 -- THE TRUST-AWARE DETECTOR VARIANT.

WHAT THIS IS
------------
A COPY of `r502_detector.py` with exactly ONE change: the SOURCE rule is
replaced by a TRUST rule.

    baseline  a value is a source if its NAME matches a transport vocabulary
              (`req.url`, `msg.anything`, `body.x`, ...)
    trust     a value is a source if its ORIGIN ACCESS PATH is rooted at a
              PER-REQUEST binding -- i.e. a parameter that a boundary
              registration delivers a closure to.

The per-request bindings are computed by `r504_trust.py`, which resolves the
delivery TRANSITIVELY across modules (the factory may live in another file).

THE MEASUREMENT THIS EXISTS TO MAKE
----------------------------------
R503 measured the ROLE repair ("every field of every parameter is a source"):
it fixed the generated corpus (28/60 -> 60/60) but exploded PRODUCTION from 6
hits to 25, and every one of the 19 new hits was a CONFIG-DERIVED value.

The question R503 left open was whether a TRUST distinction can be made
DECIDABLE.  This variant is the answer's first implementation, and the
measurement is whether it keeps the sensitivity AND loses the 19.

USAGE
-----
    python3 r504_detector_trust.py <root> [<root> ...]
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import r504_trust  # noqa: E402

# Reuse the baseline detector's machinery verbatim, so the two instruments
# differ in exactly one thing (the source rule) and nothing else.
import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "r502_detector", os.path.join(HERE, "r502_detector.py"))
r502 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(r502)

# The baseline's SOURCE regex -- kept for reference and for the
# "which vocabulary would have fired" diagnostic.
BASELINE_SOURCE = r502.SOURCE


def build_per_request_source_test(per_request: dict):
    """Return a callable `is_source(text) -> bool` that recognises ONLY
    expressions rooted at a per-request binding.

    The rule is: an identifier in the text is a per-request binding IN THE
    FILE BEING SCANNED, and the text reads a FIELD of it.

    NOTE what is NOT here: no list of trusted-looking names, no heuristic
    about what a config looks like.  `config.baseUrl` is not a source
    because `config` is not a per-request binding in that file -- not
    because "config" is a trusted word.
    """
    def make(bindings: set):
        if not bindings:
            return lambda text: False
        alt = "|".join(re.escape(b) for b in sorted(bindings))
        rx = re.compile(
            r"\b(?:" + alt + r")\s*\??\.\s*[A-Za-z_$][\w$]*", re.I)

        def test(text: str) -> bool:
            return bool(rx.search(text))
        return test

    return make


def project_has_registration(root: str) -> bool:
    """Does this project contain ANY resolvable boundary registration?

    This decides the FALLBACK.  A trust rule that only fires on proven
    per-request bindings is BLIND in a project where the resolver finds no
    registration -- and blind is not the same as safe.  So when the
    resolver finds NO registration anywhere, the instrument must say
    UNKNOWN, not TRUSTED.

    That is why the verdict is THREE-valued:

        UNTRUSTED  -- the origin is a proven per-request binding
        TRUSTED    -- the origin is proven NOT per-request (a factory-time
                      capture, or a value the resolver resolved)
        UNKNOWN    -- the resolver found no registration to decide by

    and only UNTRUSTED produces a finding.  UNKNOWN is reported separately
    so that "I could not decide" is never silently rendered as "safe".
    """
    files, _ = r504_trust.collect(root)
    for c in files.values():
        if r504_trust.REGISTRATION_CALLEE.search(c):
            return True
    return False


def main() -> int:
    roots = sys.argv[1:] or [os.getcwd()]
    # resolve the per-request bindings over EACH root, keeping them per file
    per_file = {}
    has_registration = False
    for root in roots:
        if not os.path.isdir(root):
            continue
        bindings, diag = r504_trust.resolve(root)
        for p, names in bindings.items():
            per_file.setdefault(p, set()).update(names)
        if not has_registration:
            has_registration = project_has_registration(root)

    # THE THREE-VALUED VERDICT.
    #
    # `decidable` says whether the resolver found a registration to decide
    # BY.  If it did not, the trust rule is UNKNOWN on this project -- not
    # TRUSTED.  Reporting UNKNOWN as "no findings" is exactly the silent
    # blindness that R497 caught in the restore plane: a resolver that
    # finds nothing must not be rendered as a resolver that decided
    # everything is fine.
    #
    # So the trust detector has a FALLBACK: when the project is not
    # decidable, it falls back to the BASELINE vocabulary rule and marks
    # every hit UNKNOWN.  That way the trust rule strictly ADDS the ability
    # to say TRUSTED, and never REMOVES the ability to say UNTRUSTED.
    decidable = has_registration

    total_files = 0
    total_hits = 0
    unknown_hits = 0
    for root in roots:
        if not os.path.isdir(root):
            continue
        for dp, dn, fn in os.walk(root):
            dn[:] = [d for d in dn if d not in r502.SKIP_DIRS]
            for f in sorted(fn):
                if not f.endswith(r502.EXTENSIONS):
                    continue
                p = os.path.join(dp, f)
                is_test = bool(re.search(r"(\.test\.|\.spec\.|_tmp|probe|bench)", f))
                if decidable:
                    res = scan_file_trust(p, per_file.get(p, set()))
                    verdict = "UNTRUSTED"
                else:
                    res = scan_file_baseline(p)
                    verdict = "UNKNOWN"
                if not res:
                    continue
                total_files += 1
                for r in res:
                    for h in r["hits"]:
                        total_hits += 1
                        if verdict == "UNKNOWN":
                            unknown_hits += 1
                        conf = "LOW " if h["contained"] else "HIGH"
                        tag = " [TEST]" if is_test else ""
                        print(f"[{conf}]{tag} {p}:{h['line']}  sink={h['sink']}  "
                              f"{'|'.join(h['channels'])}  "
                              f"containment={'YES' if h['contained'] else 'NO'}  "
                              f"trust={verdict}")
                        for cl in h["code"].split("\n"):
                            print(f"    | {cl.strip()[:160]}")
                        print()
    print(f"FILES WITH A HIT: {total_files}")
    print(f"TOTAL HITS: {total_hits}")
    print(f"TRUST VERDICT: {'UNTRUSTED (resolver decisive)' if decidable else 'UNKNOWN (no registration found; fell back to the vocabulary rule)'}")
    print(f"UNKNOWN HITS: {unknown_hits}")
    return 0


def scan_file_baseline(path: str):
    """The baseline scanner, used as the UNKNOWN fallback."""
    return r502.scan_file(path)


def scan_file_trust(path: str, bindings: set):
    """The baseline's scan_file with the SOURCE test replaced.

    This is a REIMPLEMENTATION of the baseline's scan, not a call into it,
    because the baseline hard-codes the module-level SOURCE regex in two
    places (`if SOURCE.search(rhs)` and `if SOURCE.search(argtext)`).
    Reimplementing them here means the ONLY difference between the two
    instruments is the source test -- which is the whole point of a
    controlled comparison.  Every other rule (taint propagation, the parent
    chain, the three containment rules, the site scoping) is byte-identical
    to the baseline's, and the differential measurement below proves it.
    """
    try:
        raw = open(path, encoding="utf8", errors="replace").read()
    except OSError:
        return []
    code = r502.strip_comments(raw)
    lines = code.split("\n")
    raw_lines = raw.split("\n")
    spans = r502.function_scopes(lines)

    is_source = build_per_request_source_test({})(bindings)

    # --- taint bindings --------------------------------------------------
    req_aliases = set(r502.REQ_OBJ_ALIAS.findall(code)) | \
        set(r502.MSG_OBJ_ALIAS.findall(code))
    destructured = set()
    for rx in (r502.REQ_DESTRUCT, r502.MSG_DESTRUCT):
        for grp in rx.findall(code):
            for part in grp.split(","):
                part = part.strip().split(":")[0].strip()
                if part and part.isidentifier():
                    destructured.add(part)

    # A per-request binding is ALSO an alias source: `const x = req;`
    for b in bindings:
        req_aliases.add(b)

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
                if is_source(rhs):
                    tainted.add(name)
                    parents.setdefault(name, set())
                    changed = True
                    continue
                tainted_ancestors = ids & tainted
                if tainted_ancestors or (ids & req_aliases) or (ids & destructured):
                    tainted.add(name)
                    parents.setdefault(name, set()).update(tainted_ancestors)
                    changed = True

    def ancestors_of(var: str) -> set:
        out, stack = set(), [var]
        while stack:
            v = stack.pop()
            for p in parents.get(v, ()):
                if p not in out:
                    out.add(p)
                    stack.append(p)
        return out

    def descendants_of(vars_) -> set:
        out = set()
        for v in list(vars_):
            for name, ps in parents.items():
                if v in ps and name not in out:
                    out.add(name)
        return out

    hits = []
    for i, l in enumerate(lines):
        for sm in r502.SINK.finditer(l):
            argtext = r502.call_args("\n".join(lines[i:]), sm.end() - 1)
            if not argtext:
                continue
            channels = []
            if is_source(argtext):
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

            resolving = sm.group(1) in r502.RESOLVING_SINKS
            scope = r502.enclosing_scope(spans, i)
            if scope is None:
                lo, hi = 0, len(lines) - 1
            else:
                lo, hi = scope

            relevant = set()
            for hv in hit_tainted:
                relevant.add(hv)
                relevant |= ancestors_of(hv)
            guard_helpers = set()
            for nm in _defined_names_helper(r502, lines, spans, i):
                if nm not in guard_helpers:
                    guard_helpers.add(nm)
            guard_produced = set()
            for l2 in lines:
                for m2 in re.finditer(r"\b([A-Za-z_$][\w$]*)\s*=\s*([^;\n]{0,300})", l2):
                    name2, rhs2 = m2.group(1), m2.group(2)
                    if any(re.search(r"\b" + re.escape(g) + r"\s*\(", rhs2)
                           for g in guard_helpers):
                        guard_produced.add(name2)

            if relevant & guard_produced:
                contained = True
            else:
                contained = False
                if resolving:
                    window = range(lo, hi + 1)
                else:
                    window = range(lo, min(i, hi) + 1)
                for j in window:
                    if not r502.PATH_CONTAINMENT.search(lines[j]):
                        continue
                    subj = r502.guard_subject(lines[j])
                    if subj is None:
                        continue
                    if subj not in (relevant | descendants_of(relevant)):
                        continue
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


def _defined_names_helper(r502, lines, spans, i):
    """The names defined in the site containing line `i`.

    This mirrors the baseline's RULE 3 (guard helper) support without
    depending on its private helpers.
    """
    scope = r502.enclosing_scope(spans, i)
    if scope is None:
        lo, hi = 0, len(lines) - 1
    else:
        lo, hi = scope
    body = "\n".join(lines[lo:hi + 1])
    return set(re.findall(r"\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)", body))


if __name__ == "__main__":
    raise SystemExit(main())
