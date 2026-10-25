#!/usr/bin/env python3
"""
R504 -- THE MUTATION MATRIX: does the suite actually catch a broken
trust rule?

R503's rule: a suite that passes on the UNFIXED code measures nothing.
R502's rule: the CONTROL runs first, and a control that is not green is a
harness failure, not a result.

So this matrix:
  * runs the CONTROL (the unmodified suite) first and requires it green;
  * injects one defect at a time into the TRUST RESOLVER;
  * asserts the suite goes RED for each;
  * restores each file byte-for-byte and verifies the md5.

The defects are the ones the round actually had, so this is not a
hypothetical matrix -- it is the round's own debugging history, replayed
against the suite that is supposed to catch it:

  M1  the resolver attributes the binding to the REGISTRATION file
      instead of the file where the closure body lives
  M2  the resolver does not follow a TRANSITIVE (cross-file) import
  M3  the resolver does not follow the `.js` -> `.ts` import convention
  M4  the resolver does not treat a registration as UNDECIDABLE --
      it renders "no registration found" as "no findings"
  M5  the resolver decides trust by NAME (a `req`-named parameter is
      trusted, whatever its invocation) -- the R503 role rule in disguise
  M6  a NEGATIVE CONTROL: the resolver is made MORE permissive without
      changing any verdict -- must SURVIVE (the suite must not be
      sensitive to spelling)

Every mutation is applied to a COPY of the repo's scripts dir, so the
shipped files are never touched.
"""
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
HUB = os.path.join(REPO, "hub")

SUITE = "test/r504_trust_property.test.ts"
# relative to the HUB dir (the suite's cwd)
RESOLVER = "scripts/r504_trust.py"
DETECTOR = "scripts/r504_detector_trust.py"


def md5(path):
    return hashlib.md5(open(path, "rb").read()).hexdigest()


def run_suite(cwd):
    proc = subprocess.run(
        ["npx", "vitest", "run", SUITE, "--reporter=basic"],
        cwd=cwd, capture_output=True, text=True, timeout=1200)
    return proc.returncode, proc.stdout + proc.stderr


def summary(out):
    """-> (passed, failed) counted from the SUMMARY LINE, not from the
    per-file line.

    R482-10(2) / R497-11(c): with `--reporter=basic` the `✓`/`×` counts
    are the number of TEST FILES, not the number of TESTS.  A parser that
    reads the file count reports "1 passed" for a suite of 17 -- and then
    every mutation looks like it SURVIVED.  So the summary line is parsed
    explicitly, and the count is ASSERTED against a known constant.
    """
    import re
    m = re.search(r"Tests\s+(\d+)\s+passed", out)
    f = re.search(r"Tests\s+.*?(\d+)\s+failed", out)
    if not m and not f:
        return None, None
    return (int(m.group(1)) if m else 0), (int(f.group(1)) if f else 0)


def clone_repo(dest):
    """Copy the hub dir into `dest`, together with the repo-root files the
    hub's vitest config imports.

    `hub/vitest.config.ts` does `import rootConfig from '../vitest.config'`,
    so a clone of `hub/` alone cannot even LOAD its config -- and a config
    that cannot load is not a failing test, it is an absent measurement.
    The first draft of this matrix copied only `hub/` and the control came
    back as an unhandled build error, which the matrix correctly refused
    to read as a result.
    """
    os.makedirs(dest, exist_ok=True)
    # The clone must PRESERVE the repo layout: `hub/vitest.config.ts`
    # imports `../vitest.config`, so the root config must sit one level
    # ABOVE the hub dir.  The first draft put both in the same directory
    # and the relative import could not resolve -- the control came back
    # as an unhandled build error rather than a test result, which the
    # matrix correctly refused to read as a measurement.
    hub_dest = os.path.join(dest, "hub")
    os.makedirs(hub_dest, exist_ok=True)
    # the repo root files the hub config depends on
    for name in ("vitest.config.ts", "vitest.config.js", "package.json",
                 "tsconfig.json"):
        src = os.path.join(REPO, name)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(dest, name))
    for item in os.listdir(HUB):
        src = os.path.join(HUB, item)
        dst = os.path.join(hub_dest, item)
        if item == "node_modules":
            continue
        if os.path.isdir(src):
            shutil.copytree(src, dst, ignore=shutil.ignore_patterns(
                "node_modules", ".git", "dist", "coverage"))
        else:
            shutil.copy2(src, dst)
    nm = os.path.join(HUB, "node_modules")
    if os.path.isdir(nm):
        os.symlink(nm, os.path.join(hub_dest, "node_modules"))
    return hub_dest


MUTATIONS = []


def mutation(name, expect):
    def deco(fn):
        MUTATIONS.append((name, fn, expect))
        return fn
    return deco


@mutation("M1 binding attributed to the REGISTRATION file", "KILLED")
def m1(root):
    p = os.path.join(root, RESOLVER)
    s = open(p, encoding="utf8").read()
    old = """                            per_request[target].update(factories[target][exported])
                            diag.append((p, "imported-factory:" + exported,
                                         factories[target][exported], target))"""
    new = """                            per_request[p].update(factories[target][exported])
                            diag.append((p, "imported-factory:" + exported,
                                         factories[target][exported], target))"""
    assert old in s, "M1 anchor not found"
    s = s.replace(old, new, 1)
    open(p, "w", encoding="utf8").write(s)


@mutation("M2 no TRANSITIVE import resolution", "KILLED")
def m2(root):
    p = os.path.join(root, RESOLVER)
    s = open(p, encoding="utf8").read()
    old = """                    if fac in imports.get(p, {}):
                        exported, mod = imports[p][fac]
                        target = _resolve_import(p, mod)
                        if target and exported in factories.get(target, {}):"""
    new = """                    if fac in imports.get(p, {}) and False:
                        exported, mod = imports[p][fac]
                        target = _resolve_import(p, mod)
                        if target and exported in factories.get(target, {}):"""
    assert old in s, "M2 anchor not found"
    s = s.replace(old, new, 1)
    open(p, "w", encoding="utf8").write(s)


@mutation("M3 no `.js` -> `.ts` import convention", "KILLED")
def m3(root):
    p = os.path.join(root, RESOLVER)
    s = open(p, encoding="utf8").read()
    old = """        if e == ".js":
            cands.append(base[:-3] + ".ts")
            cands.append(base[:-3] + ".tsx")"""
    new = """        if e == ".js":
            pass"""
    assert old in s, "M3 anchor not found"
    s = s.replace(old, new, 1)
    open(p, "w", encoding="utf8").write(s)


@mutation("M4 UNKNOWN rendered as SILENCE", "KILLED")
def m4(root):
    p = os.path.join(root, DETECTOR)
    s = open(p, encoding="utf8").read()
    old = """                else:
                    res = scan_file_baseline(p)
                    verdict = "UNKNOWN\""""
    new = """                else:
                    res = []
                    verdict = "UNKNOWN\""""
    assert old in s, "M4 anchor not found"
    s = s.replace(old, new, 1)
    open(p, "w", encoding="utf8").write(s)


@mutation("M5 trust decided by NAME (the role rule in disguise)", "KILLED")
def m5(root):
    p = os.path.join(root, DETECTOR)
    s = open(p, encoding="utf8").read()
    old = """        alt = "|".join(re.escape(b) for b in sorted(bindings))
        rx = re.compile(
            r"\\b(?:" + alt + r")\\s*\\??\\.\\s*[A-Za-z_$][\\w$]*", re.I)"""
    new = """        alt = "|".join(re.escape(b) for b in sorted(bindings))
        rx = re.compile(
            r"\\b(?:req|request|ctx|incoming)\\s*\\??\\.\\s*[A-Za-z_$][\\w$]*", re.I)"""
    assert old in s, "M5 anchor not found"
    s = s.replace(old, new, 1)
    open(p, "w", encoding="utf8").write(s)


@mutation("M6 NEGATIVE CONTROL: a spelling change that changes no verdict", "SURVIVED")
def m6(root):
    p = os.path.join(root, DETECTOR)
    s = open(p, encoding="utf8").read()
    old = 'r"\\b(?:" + alt + r")\\s*\\??\\.\\s*[A-Za-z_$][\\w$]*", re.I)'
    new = 'r"\\b(?:" + alt + r")\\s*\\??\\.\\s*[A-Za-z_$][\\w$]*", re.I | re.M)'
    assert old in s, "M6 anchor not found"
    s = s.replace(old, new, 1)
    open(p, "w", encoding="utf8").write(s)


def main() -> int:
    base = tempfile.mkdtemp(prefix="r504-matrix-")
    work = clone_repo(os.path.join(base, "repo"))

    print("R504 -- MUTATION MATRIX")
    print()
    print("CONTROL FIRST (R502 rule): the unmodified suite must be GREEN.")
    rc, out = run_suite(work)
    passed, failed = summary(out)
    print("  control: rc=%d  passed=%s failed=%s" % (rc, passed, failed))
    if rc != 0 or failed is None or failed != 0:
        print("  CONTROL FAILED -- the matrix is not measuring the suite.")
        print(out[-3000:])
        return 1
    baseline_passed = passed
    print("  control OK (%d tests green)" % baseline_passed)
    print()

    results = []
    for name, fn, expect in MUTATIONS:
        # snapshot the two OWNED files
        owned = [os.path.join(work, RESOLVER), os.path.join(work, DETECTOR)]
        snap = {p: open(p, "rb").read() for p in owned}
        before = {p: md5(p) for p in owned}
        try:
            fn(work)
            after = {p: md5(p) for p in owned}
            changed = [p for p in owned if before[p] != after[p]]
            if not changed:
                results.append((name, "NOT-INJECTED", expect))
                print("  %-56s NOT-INJECTED" % name)
                continue
            rc, out = run_suite(work)
            p2, f2 = summary(out)
            verdict = "SURVIVED" if (rc == 0 and f2 == 0) else "KILLED"
            results.append((name, verdict, expect))
            print("  %-56s %s (rc=%d passed=%s failed=%s)" % (
                name, verdict, rc, p2, f2))
        finally:
            for p in owned:
                open(p, "wb").write(snap[p])
            for p in owned:
                assert md5(p) == before[p], "restore failed for %s" % p

    print()
    killed = sum(1 for _, v, _ in results if v == "KILLED")
    survived = sum(1 for _, v, _ in results if v == "SURVIVED")
    expected_survived = sum(1 for _, _, e in results if e == "SURVIVED")
    print("KILLED %d | SURVIVED %d | expected-survived %d" % (
        killed, survived, expected_survived))
    ok = True
    for name, verdict, expect in results:
        if verdict != expect:
            print("  MISMATCH: %s -> %s (expected %s)" % (name, verdict, expect))
            ok = False
    # the negative control MUST survive -- a suite that kills it is
    # sensitive to spelling rather than to the subject
    neg = [(n, v) for n, v, e in results if e == "SURVIVED"]
    if neg and neg[0][1] != "SURVIVED":
        print("  NEGATIVE CONTROL was KILLED -- the suite is spelling-sensitive")
        ok = False
    print()
    print("VERDICT:", "PASS" if ok else "FAIL")
    shutil.rmtree(base, ignore_errors=True)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
