#!/usr/bin/env python3
"""
R502 — the PERMANENT SENSITIVITY CORPUS for the request-derived-sink class.

R502-A (queued by R501-12): the 14 spellings and 3 controls that R501 measured
lived INSIDE `r501_detector.py`'s test file.  That is the wrong place for them:

  * a corpus that lives in the suite that tests the detector is rewritten
    whenever the detector changes, so the corpus cannot be used to detect that
    the detector REGRESSED;
  * R501's own corpus was authored by the same author as the detector, so
    "13/14 sensitive" measured the detector against its own imagination.

This file is the corpus as DATA, in the repo, versioned, and NOT derived from
the detector.  Any new scanner for this class must pass it before its "0 hits"
on production code is evidence.

The corpus has three parts:

  SENSITIVITY  -- spellings that ARE the class.  A scanner must FIRE on every
                  one of them.  (True positives.)
  SPECIFICITY  -- shapes that LOOK like the class but are NOT.  A scanner must
                  stay SILENT on every one.  (False positives.)
  SUBJECT      -- the R502 cases: shapes where the CONTAINMENT verdict is the
                  subject, and the ground truth is known exactly.
                  (F1 site scope, F3 guard binding, plus the genuinely
                  guarded controls.)

Each case is a dict: {name, body, expect}.  `expect` is "VULN" or "SAFE",
plus `containment` ("YES"/"NO") for the SUBJECT cases.

A scanner is scored by running it over this corpus and comparing the FIRING
and the CONTAINMENT verdict against `expect`.  The scorer is in
`r502_score_corpus.py`.
"""
import os

PREAMBLE = """import fs from 'fs';
import path from 'path';
const join = path.join, resolve = path.resolve;
const readFileSync = fs.readFileSync;
const PUBLIC_DIR = '/srv/public';
"""

# ---------------------------------------------------------------- sensitivity
# Spellings of "a request-derived string reaches a filesystem or network
# sink".  R501 measured its own detector at 13/14 here; the corpus also
# includes the R502 additions (message-shaped sources, network sinks).
SENSITIVITY = [
    {"name": "named-var",
     "body": "const p = join(PUBLIC_DIR, req.url); readFileSync(p);"},
    {"name": "inline",
     "body": "readFileSync(join(PUBLIC_DIR, req.url));"},
    {"name": "template-literal",
     "body": "const p = join(PUBLIC_DIR, `${req.url}`); readFileSync(p);"},
    {"name": "destructured",
     "body": "const { url } = req; readFileSync(join(PUBLIC_DIR, url));"},
    {"name": "request-alias",
     "body": "const s = req; readFileSync(join(PUBLIC_DIR, s.url));"},
    {"name": "resolve-not-join",
     "body": "const p = resolve(PUBLIC_DIR, req.url); readFileSync(p);"},
    {"name": "query-field",
     "body": "const p = join(PUBLIC_DIR, query.file); readFileSync(p);"},
    {"name": "params-index",
     "body": "const p = join(PUBLIC_DIR, params['f']); readFileSync(p);"},
    {"name": "pathname",
     "body": "const p = join(PUBLIC_DIR, url.parse(x).pathname); readFileSync(p);"},
    {"name": "decoded",
     "body": "const d = decodeURIComponent(req.url); const p = join(PUBLIC_DIR, d); readFileSync(p);"},
    {"name": "non-path-chain",
     "body": ("const raw = req.url;\n"
              "  const stripped = raw.replace(/^\\/+/, '');\n"
              "  const filePath = join(PUBLIC_DIR, stripped);\n"
              "  readFileSync(filePath);")},
    # --- R502 additions: the class is not an HTTP class ---------------
    {"name": "ws-message",
     "body": "const p = join(PUBLIC_DIR, msg.path); readFileSync(p);"},
    {"name": "envelope",
     "body": "const p = join(PUBLIC_DIR, envelope.file); readFileSync(p);"},
    {"name": "body-field",
     "body": "const p = join(PUBLIC_DIR, body.name); readFileSync(p);"},
    {"name": "peer-field",
     "body": "const p = join(PUBLIC_DIR, peer.wsUrl); readFileSync(p);"},
    {"name": "network-sink",
     "body": "const u = req.url; fetch(u);"},
]

# ---------------------------------------------------------------- specificity
# Shapes that are NOT the class.  A scanner must stay silent.
SPECIFICITY = [
    {"name": "non-fs-sink",
     "body": "const v = req.url; console.log(v);"},
    {"name": "static-path",
     "body": "readFileSync(join(PUBLIC_DIR, 'index.html'));"},
    {"name": "config-path",
     "body": "const p = join(PUBLIC_DIR, 'app.js'); readFileSync(p);"},
    {"name": "env-path",
     "body": "const p = join(PUBLIC_DIR, process.env.FILE); readFileSync(p);"},
]

# ------------------------------------------------------------------- subject
# The R502 cases.  Each names a FILE-LEVEL ground truth for the CONTAINMENT
# verdict of a specific SINK LINE.  `line` is 1-based within the emitted file.
SUBJECT = [
    # --- F1: the guard's SCOPE -----------------------------------------
    {"name": "no-guard-at-all",
     "body": ("export function b(req: any) {\n"
              "  const p = path.join('/var/other', req.url);\n"
              "  return fs.readFileSync(p);\n"
              "}"),
     "expect": "VULN", "containment": "NO", "marker": "readFileSync(p)"},
    {"name": "guard-after-site",
     "body": ("const ROOT = '/srv/root';\n"
              "export function b(req: any) {\n"
              "  const p = path.join('/var/other', req.url);\n"
              "  return fs.readFileSync(p);\n"
              "}\n"
              "export function a(req: any) {\n"
              "  const q = path.resolve(ROOT, req.url);\n"
              "  if (!q.startsWith(ROOT + path.sep)) return null;\n"
              "  return q;\n"
              "}"),
     "expect": "VULN", "containment": "NO", "marker": "readFileSync(p)"},
    {"name": "guard-other-root",
     "body": ("const ROOT = '/srv/root';\n"
              "export function b(req: any) {\n"
              "  const p = path.join('/var/other', req.url);\n"
              "  return fs.readFileSync(p);\n"
              "}\n"
              "export function a(req: any) {\n"
              "  const q = path.resolve(ROOT, req.url);\n"
              "  if (!q.startsWith(ROOT + path.sep)) return null;\n"
              "  return q;\n"
              "}\n"
              "export function c(x: string) {\n"
              "  if (!x.startsWith('/api/')) return 0;\n"
              "  return 1;\n"
              "}"),
     "expect": "VULN", "containment": "NO", "marker": "readFileSync(p)"},
    # --- F3: the guard's BINDING ---------------------------------------
    {"name": "guard-self-certifies",
     "body": ("const ROOT = '/srv/root';\n"
              "export function b(req: any) {\n"
              "  const p = path.join('/var/other', req.url);\n"
              "  const real = fs.realpathSync(path.resolve(ROOT, req.url));\n"
              "  if (!real.startsWith(ROOT + path.sep)) return null;\n"
              "  return fs.readFileSync(p);\n"
              "}"),
     "expect": "VULN", "containment": "NO", "marker": "readFileSync(p)"},
    # --- the genuinely guarded controls: containment MUST be YES --------
    {"name": "genuinely-guarded",
     "body": ("const ROOT = '/srv/root';\n"
              "export function b(req: any) {\n"
              "  const p = path.resolve(ROOT, req.url);\n"
              "  if (!p.startsWith(ROOT + path.sep)) return null;\n"
              "  return fs.readFileSync(p);\n"
              "}"),
     "expect": "VULN", "containment": "YES", "marker": "readFileSync(p)"},
    {"name": "guarded-by-helper",
     "body": ("const ROOT = '/srv/root';\n"
              "function insideRoot(candidate: string): string | null {\n"
              "  const real = fs.realpathSync(candidate);\n"
              "  return real.startsWith(ROOT + path.sep) ? real : null;\n"
              "}\n"
              "export function b(req: any) {\n"
              "  const p = insideRoot(path.resolve(ROOT, req.url));\n"
              "  if (p === null) return null;\n"
              "  return fs.readFileSync(p);\n"
              "}"),
     "expect": "VULN", "containment": "YES", "marker": "readFileSync(p)"},
    {"name": "resolve-then-compare",
     "body": ("const ROOT = '/srv/root';\n"
              "export function b(req: any) {\n"
              "  const candidate = path.resolve(ROOT, req.url);\n"
              "  let real: string;\n"
              "  try { real = fs.realpathSync(candidate); } catch { return null; }\n"
              "  if (!real.startsWith(ROOT + path.sep)) return null;\n"
              "  return fs.readFileSync(candidate);\n"
              "}"),
     "expect": "VULN", "containment": "YES", "marker": "readFileSync(candidate)"},
    {"name": "route-prefix-is-not-a-guard",
     "body": ("export function b(req: any) {\n"
              "  if (req.path.startsWith('/api/')) return null;\n"
              "  const p = path.join('/var/other', req.url);\n"
              "  return fs.readFileSync(p);\n"
              "}"),
     "expect": "VULN", "containment": "NO", "marker": "readFileSync(p)"},
    # --- R502-A2: the three gaps the R502-A corpus left OPEN ------------
    # The first R502-A corpus scored 8/8 SUBJECT, but three of the
    # detector's own mutants SURVIVED it.  A corpus that every mutant
    # passes measures nothing -- the same argument R502-A makes about a
    # detector that both detectors pass.  These three cases are the ones
    # that kill M1 (file-wide scope), M3 (order) and M6 (sibling taint).
    #
    # (a) the SAME VARIABLE NAME, guarded in ANOTHER SITE.  The chain
    #     constraint (RULE 1) cannot help here: the guard's subject `p` IS
    #     on the served variable's chain by name, so only the SITE SCOPE
    #     (RULE F1) can reject it.  This is the case that makes the site
    #     scope load-bearing rather than redundant with the chain rule.
    {"name": "guard-other-site-same-name",
     "body": ("const ROOT = '/srv/root';\n"
              "export function a(req: any) {\n"
              "  const p = path.resolve(ROOT, req.url);\n"
              "  if (!p.startsWith(ROOT + path.sep)) return null;\n"
              "  return p;\n"
              "}\n"
              "export function b(req: any) {\n"
              "  const p = path.join('/var/other', req.url);\n"
              "  return fs.readFileSync(p);\n"
              "}"),
     "expect": "VULN", "containment": "NO", "marker": "readFileSync(p)"},
    # (b) the guard comes AFTER the read, in the SAME site.  A confinement
    #     check that runs after the bytes were already read confines
    #     nothing: the read has happened.  Only the ORDER rule (RULE 2)
    #     rejects this.
    {"name": "guard-after-the-read",
     "body": ("const ROOT = '/srv/root';\n"
              "export function b(req: any) {\n"
              "  const p = path.join('/var/other', req.url);\n"
              "  const data = fs.readFileSync(p);\n"
              "  if (!p.startsWith(ROOT + path.sep)) return null;\n"
              "  return data;\n"
              "}"),
     "expect": "VULN", "containment": "NO", "marker": "readFileSync(p)"},
    # (c) the guard constrains an UNRELATED variable that merely appears
    #     in the served path's RIGHT-HAND SIDE.  `base` is a constant
    #     string, not a tainted ancestor, so checking it says nothing
    #     about `req.url` -- which is what can escape the directory.  This
    #     is the case that separates "the chain records ONLY tainted
    #     ancestors" from "the chain records every RHS identifier".
    #
    #     The tainted value reaches the path through an INTERMEDIATE
    #     variable (`raw`), not inline.  That is deliberate: a variable
    #     whose RIGHT-HAND SIDE contains a source expression is currently
    #     classified as a chain ROOT with no recorded parents, so an
    #     inline `path.join(base, req.url)` cannot discriminate the two
    #     parent-recording rules at all.  With the intermediate, `p`'s
    #     parents are observable, and the arm becomes load-bearing.
    {"name": "guard-on-unrelated-base",
     "body": ("const ROOT = '/srv/root';\n"
              "export function b(req: any) {\n"
              "  const base = '/srv/other';\n"
              "  const raw = req.url;\n"
              "  const p = path.join(base, raw);\n"
              "  if (!base.startsWith(ROOT + path.sep)) return null;\n"
              "  return fs.readFileSync(p);\n"
              "}"),
     "expect": "VULN", "containment": "NO", "marker": "readFileSync(p)"},
]


def all_cases():
    """Every case, tagged with its kind.

    SUBJECT cases carry a `marker` (a substring of the sink line) instead of a
    hand-counted line number.  The line is COMPUTED from the marker plus the
    preamble offset, so the ground truth cannot drift when the preamble
    changes (R502's first corpus run: 0/8 SUBJECT cases passed because the
    ground truth was a hand-copy of a line count).
    """
    out = []
    for c in SENSITIVITY:
        out.append(dict(c, kind="SENSITIVITY", expect="VULN"))
    for c in SPECIFICITY:
        out.append(dict(c, kind="SPECIFICITY", expect="SAFE"))
    for c in SUBJECT:
        c = dict(c)
        c["line"] = body_line(c, c["marker"])
        out.append(dict(c, kind="SUBJECT"))
    return out


def preamble_lines() -> int:
    """How many lines the PREAMBLE occupies.

    The corpus's ground-truth LINE numbers are relative to the BODY, so the
    preamble offset has to be added when the file is materialised.  R502's
    first corpus run reported 0/8 SUBJECT cases passing because the ground
    truth was hand-counted against the body while the scanner reported
    absolute file lines -- a HAND-COPY that drifts the moment the preamble
    changes.  The offset is computed, never counted.
    """
    return PREAMBLE.count("\n")


def body_line(case, marker: str) -> int:
    """The 1-based file line of `marker` inside `case`'s body."""
    for i, l in enumerate(case["body"].split("\n"), start=1):
        if marker in l:
            return i + preamble_lines()
    raise KeyError("marker %r not found in case %r" % (marker, case["name"]))


def write_corpus(dest_dir: str) -> list:
    """Materialise the corpus as files; returns the written paths."""
    os.makedirs(dest_dir, exist_ok=True)
    written = []
    for c in all_cases():
        p = os.path.join(dest_dir, f"case_{c['name']}.ts")
        with open(p, "w", encoding="utf8") as f:
            f.write(PREAMBLE)
            f.write(c["body"] + "\n")
        written.append(p)
    return written


if __name__ == "__main__":
    import sys
    dest = sys.argv[1] if len(sys.argv) > 1 else "./r502_corpus"
    for p in write_corpus(dest):
        print(p)
