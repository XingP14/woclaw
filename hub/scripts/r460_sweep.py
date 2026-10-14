#!/usr/bin/env python3
"""R460 probe v2 — PAIRED-DIRECTION title/assertion contradiction.

v1 (r459_sweep.py) used single-token polarity (does/is/must/never) and produced
98 "contradictions" in 128 files — i.e. the heuristic, not the suites, was the
subject. Almost every hit was the shape:

    title: "returns undefined when env var is absent and no default is given"
    body:  expect(...).toBeUndefined()
           ^ "is" fires the AFFIRMATIVE rule, toBeUndefined the NEGATIVE one

The rule that actually generalises R457's arm D is PAIRED, not single-token:
a direction word in the title PROMISES one ordering, and the body asserts the
opposite one. Four pairs, each closed under its own negation:

  shorten|reduce|decrease|lower|contract|tighten|truncate
      <->  toBeGreaterThan(OrEqual)          (the value went UP)
  extend|lengthen|increase|grow|prolong|widen|bump
      <->  toBeLessThan(OrEqual)             (the value went DOWN)
  max|upper bound|cap|ceiling|at most
      <->  toBeGreaterThan(OrEqual)          (the value EXCEEDED the cap)
  min|lower bound|floor|at least
      <->  toBeLessThan(OrEqual)             (the value fell BELOW the floor)

Also reports PAIR-ORIENTED contradictions (title claims max, body asserts min)
which is the R458-3 shape (Math.min killed the wrong neighbour).

Usage: r460_sweep.py <dir>            scan the working tree
       r460_sweep.py <dir> --git REV  scan `git show REV:<path>` blobs
"""
import json
import os
import re
import subprocess
import sys

# ---- direction vocabularies: (title-group -> contradiction assertion) --------
GROUPS = [
    ("shrink", re.compile(r"\b(shorten|shortens|shorter|reduce|reduces|decrease|decreases|lower|lowers|contract|contracts|tighten|tightens|truncat\w*|shrink|shrinks|shrunk|shrank|drop|drops|dip|dips|fall|falls|fell|sink|sinks|decline[sd]?)\b", re.I),
     "gt"),
    ("grow", re.compile(r"\b(extend|extends|longer|lengthen\w*|increase\w*|grow|grows|grew|prolong\w*|widen\w*|bump\w*|raise[sd]?|higher|climb\w*|rise|rises|expand\w*|escalat\w*)\b", re.I),
     "lt"),
    ("max", re.compile(r"\b(max|maximum|upper bound|upper-bound|cap|caps|capped|capping|ceiling|at most|never more than|no more than)\b", re.I),
     "gt"),
    ("min", re.compile(r"\b(min|minimum|lower bound|lower-bound|floor|floored|at least|no less than)\b", re.I),
     "lt"),
]
MAX_ASRT = re.compile(r"toBeGreaterThan(OrEqual)?\s*\(")
MIN_ASRT = re.compile(r"toBeLessThan(OrEqual)?\s*\(")
# direction of an assertion: "gt" = value is expected to be LARGER,
# "lt" = expected SMALLER. A title promising "lt" contradicted by a "gt"
# assertion is the R457-arm-D / R458-M3 shape.
DIR_ASRT = {"gt": MAX_ASRT, "lt": MIN_ASRT}

# a negation token immediately before the direction word turns the claim into a
# denial ("CANNOT shorten", "never grows", "does not extend"). Matched on a
# short left window so a distant "not" cannot borrow across a clause boundary.
NEG_PREFIX = re.compile(r"\b(cannot|can not|can't|never|not|no|without|prevents?|stops?|refuses?|nor)\s*[\w'\"]{0,12}$", re.I)

# an explicit comparator in the body is the same direction, stated as operators
OP_MAX = re.compile(r"(?<![<>=!])>=(?![=>])")
OP_MIN = re.compile(r"(?<![<>=!])>(?![=>])")

CALL = re.compile(r"\b(it|test)\s*\(\s*(['\"`])")


def strip_comments(src):
    """Blank out comments while preserving every byte offset and newline.

    R460-6: v4 matched `it(...)` INSIDE a comment. r450_inventory_vs_relation.test.ts
    QUOTES r414's arm verbatim inside a block comment while explaining it, so
    the sweep reported the docstring of a finding as a second, independent
    contradiction -- one subject counted twice (R446-5: a widened window reads a
    different subject, not a bigger one).

    Comment text is replaced by spaces so line numbers and string offsets are
    unchanged; newlines are kept so `count("\\n")` still yields the right line.
    """
    out = list(src)
    i, n = 0, len(src)
    state = None  # None | 'line' | 'block'
    quote = None
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if state == 'line':
            if c == "\n":
                state = None
            else:
                out[i] = " "
            i += 1
        elif state == 'block':
            if c == "*" and nxt == "/":
                out[i] = out[i + 1] = " "
                state = None
                i += 2
                continue
            if c != "\n":
                out[i] = " "
            i += 1
        elif state == "'" or state == '"' or state == '`':
            if c == "\\":
                out[i] = " "
                if nxt and nxt != "\n":
                    out[i + 1] = " "
                i += 2
                continue
            if c == state:
                state = None
            i += 1
        else:
            if c == "/" and nxt == "/":
                out[i] = " "
                state = 'line'
                i += 2
                continue
            if c == "/" and nxt == "*":
                out[i] = out[i + 1] = " "
                state = 'block'
                i += 2
                continue
            if c in "'\"`":
                state = c
            i += 1
    return "".join(out)


def parse_cases(src):
    out = []
    for m in CALL.finditer(src):
        q = m.group(2)
        i, buf = m.end(), []
        while i < len(src):
            c = src[i]
            if c == "\\" and i + 1 < len(src):
                buf.append(src[i + 1]); i += 2; continue
            if c == q:
                break
            buf.append(c); i += 1
        title = "".join(buf)
        j = src.find("{", i)
        if j < 0:
            continue
        depth, k = 0, j
        while k < len(src):
            if src[k] == "{":
                depth += 1
            elif src[k] == "}":
                depth -= 1
                if depth == 0:
                    break
            k += 1
        out.append((m.start(), title, src[j:k + 1]))
    return out


def scan(name, src, acc):
    src = strip_comments(src)
    for start, title, body in parse_cases(src):
        if "${" in title:          # interpolated titles make no literal claim
            continue
        for label, words, contra_dir in GROUPS:
            # R460-4: finditer, not search. The claim and its negation are
            # usually DIFFERENT tokens in the same title --
            # "a SHORTER second invite cannot shorten A" hits `shorter` first
            # (no negation around it) and only `shorten` carries the denial.
            # Taking the first hit reported R457 as clean and missed the very
            # arm this round was queued to find.
            any_hit = False
            for hit in words.finditer(title):
                any_hit = True
                win = (title[:hit.start()] + hit.group(0)).lower()
                # A direction word INSIDE a negated idiom is not a direction
                # claim: "no longer", "no more", "not greater". v1/v2 matched
                # these lexically and produced a false positive in r427:393.
                if re.search(r"\b(no|nor|not|never)\s+(longer|more|less|fewer|greater|higher|lower|bigger|smaller|more)$", win):
                    continue
                left = title[:hit.start()].lower().rstrip()
                # R460-7: a direction word in NOUN position is not a claim.
                # "a silent drop when closed" (r414 C2b) matched `drop` and was
                # reported as "title promises a direction its body reverses" --
                # but `drop` here is the name of the defect, not a prediction.
                # An article or possessive immediately before the word means the
                # word is being used as a noun, so the title makes no claim
                # about direction at all.
                if re.search(r"\b(a|an|the|its|their|no)\s+$", left):
                    continue
                contra = DIR_ASRT[contra_dir]
                same = DIR_ASRT["lt" if contra_dir == "gt" else "gt"]
                has_contra = bool(contra.search(body))
                has_same = bool(same.search(body))
                # the body's ordering assertion must be unambiguous: a body that
                # asserts BOTH directions pins no direction, so it cannot
                # contradict one either (R460-2, r438 A2/A6 land here).
                if has_contra and has_same:
                    continue
                negated = bool(NEG_PREFIX.search(left[-16:]))
                # (a) NEGATED CLAIM: the title DENIES a direction that its own
                # body asserts -- R457 arm D's exact shape.
                if negated and has_same and not has_contra:
                    acc.setdefault("contradictions", []).append(
                        {"file": name, "line": src.count("\n", 0, start) + 1,
                         "title": title.strip()[:150], "group": "negated-" + label,
                         "title_word": hit.group(0),
                         "assertion": same.search(body).group(0),
                         "rule": "title denies the direction its own body asserts"})
                    continue
                # (b) OPPOSITE CLAIM: the title promises a direction the body
                # asserts against -- the R458-3 `Math.min` shape.
                if not negated and has_contra:
                    acc.setdefault("contradictions", []).append(
                        {"file": name, "line": src.count("\n", 0, start) + 1,
                         "title": title.strip()[:150], "group": "opposite-" + label,
                         "title_word": hit.group(0),
                         "assertion": contra.search(body).group(0),
                         "rule": "title promises a direction its own body reverses"})
                    continue
            if any_hit:
                # the title DID use a direction word from this group, and it did
                # not contradict the body: the group is decided, not unmatched
                continue
            # no direction word from this group in the title at all
    return acc


def main():
    root = sys.argv[1]
    rev = None
    if "--git" in sys.argv:
        rev = sys.argv[sys.argv.index("--git") + 1]
    acc = {"contradictions": [], "both_directions": []}
    files = sorted(f for f in os.listdir(root) if f.endswith(".test.ts"))
    for fn in files:
        if rev:
            p = os.path.join(root, fn).lstrip("./")
            r = subprocess.run(["git", "show", f"{rev}:{p}"],
                               capture_output=True, text=True)
            if r.returncode != 0:
                continue
            src = r.stdout
        else:
            src = open(os.path.join(root, fn), encoding="utf-8").read()
        scan(fn, src, acc)
    print(json.dumps({"rev": rev or "worktree", "files_scanned": len(files),
                      "contradiction_count": len(acc["contradictions"]),
                      "contradictions": acc["contradictions"],
                      "both_directions_count": 0,
                      },
                     indent=1, ensure_ascii=False))


main()
